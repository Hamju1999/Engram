import { useState, useEffect } from 'react'
import { platform } from './platform'
import Sidebar from './components/Sidebar'
import ChatWindow from './components/ChatWindow'
import DomainBadge from './components/DomainBadge'
import SavePulse from './components/SavePulse'
import Settings from './components/Settings'

// ─── STATE SHAPE ──────────────────────────────────────────────────────────────
// config          → full config object from config.json (API keys, model, path)
// messages        → [{role:'user'|'assistant', content:string}] for current session
// filePath        → absolute path to the active session txt file (null = not started)
// domain          → active domain string e.g. 'medai'
// sessionFilename → active session filename without extension e.g. 'adversarial_council'
// isFirstMessage  → true until first message sent. Controls domain classification.
// domains         → array of domain folder names for sidebar
// lastSaved       → Date of last writeTurn call. Drives SavePulse.
// isLoading       → true while waiting for AI response
// settingsOpen    → controls Settings overlay visibility
// error           → string error message, null if none

export default function App() {
  const [config, setConfig]                   = useState(null)
  const [messages, setMessages]               = useState([])
  const [filePath, setFilePath]               = useState(null)
  const [domain, setDomain]                   = useState(null)
  const [sessionFilename, setSessionFilename] = useState(null)
  const [isFirstMessage, setIsFirstMessage]   = useState(true)
  const [domains, setDomains]                 = useState([])
  const [lastSaved, setLastSaved]             = useState(null)
  const [isLoading, setIsLoading]             = useState(false)
  const [settingsOpen, setSettingsOpen]       = useState(false)
  const [error, setError]                     = useState(null)
  const [pipelineStep, setPipelineStep]       = useState(null)
  // pipelineStep: null | 'reasoning' | 'auditing' | 'synthesizing'
  // Set by the main process during the multi-agent pipeline via IPC event.

  // ── Initialization ─────────────────────────────────────────────────────────
  // Runs once on mount. Loads config and populates domain list in sidebar.
  useEffect(() => {
    async function init() {
      const cfg = await platform.loadConfig()
      setConfig(cfg)
      const domainList = await platform.listDomains()
      setDomains(domainList)
    }
    init()

    // Subscribe to pipeline step events from main process.
    // Only fires when activeModel === 'multi'. Returns cleanup fn.
    if (platform.onPipelineStep) {
      const cleanup = platform.onPipelineStep(function(step) {
        setPipelineStep(step)
      })
      return cleanup
    }
  }, [])

  // ── Parse txt back to messages ─────────────────────────────────────────────
  // When loading a past session, the txt file is raw text.
  // This regex extracts [USER | HH:MM:SS] and [ASSISTANT | HH:MM:SS] blocks
  // and converts them back to the {role, content} format the UI needs.
  // No information is added or removed - pure structural conversion.
  function parseTxtToMessages(content) {
    const result = []
    const turnRegex = /\[(USER|ASSISTANT) \| \d{2}:\d{2}:\d{2}\]\n([\s\S]*?)(?=\n\[(?:USER|ASSISTANT) \| \d{2}:\d{2}:\d{2}\]|$)/g
    let match
    while ((match = turnRegex.exec(content)) !== null) {
      const role = match[1] === 'USER' ? 'user' : 'assistant'
      const text = match[2].trim()
      if (text) result.push({ role, content: text })
    }
    return result
  }

  // ── Load a past session ────────────────────────────────────────────────────
  // Called from Sidebar when user clicks a session entry.
  // Reads the txt file, parses it, and restores the full conversation state.
  // filePath is passed to writeTurn if the user continues chatting from this session.
  async function loadSession(fp, dom, fname) {
    try {
      const content = await platform.readSession(fp)
      const parsed  = parseTxtToMessages(content)
      setMessages(parsed)
      setFilePath(fp)
      setDomain(dom)
      // Strip date and extension from filename for display
      setSessionFilename(fname.replace(/\.txt$/, '').replace(/_\d{4}-\d{2}-\d{2}(_\d+)?$/, ''))
      setIsFirstMessage(false)
      // isFirstMessage = false means if user continues this session,
      // we skip domain classification and write directly to the existing file.
      setError(null)
    } catch (err) {
      setError(`Failed to load session: ${err.message}`)
    }
  }

  // ── New chat ───────────────────────────────────────────────────────────────
  // Resets all session state. Next message triggers domain classification again.
  function newChat() {
    setMessages([])
    setFilePath(null)
    setDomain(null)
    setSessionFilename(null)
    setIsFirstMessage(true)
    setError(null)
  }

  // ── MAIN SEND HANDLER ──────────────────────────────────────────────────────
  // This is the core of the app. The exact sequence is non-negotiable:
  //
  //   1. If first message → classify domain → create session file
  //   2. Add user message to UI state
  //   3. writeTurn(user)  ← disk write before AI call
  //   4. Build system context from all domains (cross-domain long-term context)
  //   5. sendMessage → AI response
  //   6. writeTurn(assistant) ← disk write before rendering
  //   7. Add AI response to UI state
  //
  // Steps 3 and 6 are the anti-summarization guarantee.
  // The file always leads the UI state - never lags behind.

  async function handleSend(content, attachments = []) {
    // attachments = [{name, text}] - already extracted plain text from files
    if (!content.trim() && !attachments.length) return
    if (isLoading) return

    // Build the full message: file contents first, then user message.
    // Format: === File: name.py ===\ncontent\n=== End ===\n\n...\nUser message
    // Plain text. Every model reads it identically with no special handling.
    // Build the full message: text file contents first, then user message.
    // Images excluded here - they have no .text property (only .data base64).
    // Images are passed separately via sendMessage as imageAttachments.
    let fullContent = content
    const textAttachments = attachments.filter(a => !a.isImage)
    if (textAttachments.length > 0) {
      const fileParts = textAttachments.map(a =>
        `=== File: ${a.name} ===\n${a.text}\n=== End: ${a.name} ===`
      ).join('\n\n')
      fullContent = `${fileParts}\n\n${content}`.trim()
    }
    setIsLoading(true)
    setError(null)

    // Capture current filePath and domain into locals.
    // State updates (setFilePath, setDomain) are async - local vars
    // are needed so the rest of this function sees the new values immediately.
    let activeFilePath = filePath
    let activeDomain   = domain

    try {

      // ── Step 1: first message setup ──────────────────────────────────────
      if (isFirstMessage) {
        // AI classifies domain and suggests filename from the first message alone.
        const { domain: d, filename: f } = await platform.classifyDomain(content)

        // Model string for the session header in the txt file.
        const modelName = config?.models?.[config.activeModel]?.default
          || config?.activeModel
          || 'unknown'

        // createSession creates the domain folder + txt file with header.
        // Returns the absolute file path for this session.
        const fp = await platform.createSession({ domain: d, filename: f, model: modelName })

        activeFilePath = fp
        activeDomain   = d

        setFilePath(fp)
        setDomain(d)
        setSessionFilename(f)
        setIsFirstMessage(false)

        // Refresh domain list so sidebar shows the new domain immediately
        const dl = await platform.listDomains()
        setDomains(dl)
      }

      // ── Step 2: add user message to UI ───────────────────────────────────
      // userMessage uses fullContent (files + message text combined)
      // attachmentNames stored for display chip under the message
      const userMessage = {
        role: 'user',
        content: fullContent,
        attachmentNames: attachments.map(a => a.name)
      }
      setMessages(prev => [...prev, userMessage])

      // ── Step 3: write user turn to disk immediately ───────────────────────
      // fullContent = file texts + user message. Written verbatim to txt.
      await platform.writeTurn({ filePath: activeFilePath, role: 'user', content: fullContent })
      setLastSaved(new Date())

      // ── Step 4: build system context from ALL domains ───────────────────────
      // Token budget management - the root cause of the 30K/min rate limit error.
      //
      // Problem: full session files can be 500KB+ (the MedAI.py session was 576KB
      // = ~144K tokens). Injecting that as system context on every message, then
      // multiplying by 3 for multi-agent, instantly blows Claude's rate limit.
      //
      // Fix:
      //   TAIL_CHARS  - only use the last N chars of each session (most recent
      //                 turns are most relevant; old turns have diminishing value)
      //   MAX_CONTEXT - hard cap on total system context string length
      //   Multi-agent uses 1/3 the cap since it makes 3 sequential API calls
      //   ~4 chars per token is a conservative approximation
      //
      // These limits leave ~18K tokens of headroom for the conversation + files.

      const isMulti = config?.activeModel === 'multi'
      const TAIL_CHARS = 8000        // ~2,000 tokens per session tail
      const MAX_CONTEXT = isMulti
        ? 24000                      // ~6,000 tokens total - safe for 3 pipeline calls
        : 60000                      // ~15,000 tokens total - safe for single model

      let systemContext = ''
      try {
        const allDomains = await platform.listDomains()
        const contextParts = []

        for (const dom of allDomains.slice(0, 6)) {
          const sessions = await platform.listSessions(dom)
          const pick = sessions.find(s => s.path !== activeFilePath)
          if (!pick) continue
          const fullTxt = await platform.readSession(pick.path)
          // Take only the tail - most recent exchanges are more relevant than
          // the full history, and this prevents single large sessions from
          // consuming the entire context budget.
          const tail = fullTxt.length > TAIL_CHARS
            ? '...[earlier content truncated]...\n' + fullTxt.slice(-TAIL_CHARS)
            : fullTxt
          contextParts.push(`=== Domain: ${dom} | File: ${pick.name} ===\n\n${tail}`)
        }

        if (contextParts.length > 0) {
          let joined = [
            'The following are recent sessions across all domains (tails only for token efficiency).',
            'Use them as long-term context for this conversation.',
            '---',
            ...contextParts
          ].join('\n\n')

          // Hard cap - truncate from the front if still over budget.
          // Front truncation preserves the most recent content (at the end).
          if (joined.length > MAX_CONTEXT) {
            joined = '...[truncated for token budget]...\n' + joined.slice(-MAX_CONTEXT)
          }

          systemContext = joined
        }
      } catch (err) {
        console.warn('Context load failed:', err.message)
      }

      // ── Step 5: build message history and call AI ─────────────────────────
      // allMessages includes everything in this session including the new user turn.
      // The AI receives the full conversation - no summarization, no truncation.
      const allMessages = [...messages, userMessage].map(m => ({
        role: m.role,
        content: m.content
      }))

      // Text file contents are already embedded in allMessages via fullContent.
      // Image attachments are passed separately so callAPI can add base64 content blocks.
      const imageAttachments = attachments.filter(a => a.isImage)
      const response = await platform.sendMessage({
        messages: allMessages,
        systemContext,
        attachments: imageAttachments
      })

      // ── Step 6: write AI response to disk immediately ─────────────────────
      await platform.writeTurn({ filePath: activeFilePath, role: 'assistant', content: response })
      setLastSaved(new Date())

      // ── Step 7: render AI response ────────────────────────────────────────
      // Render happens AFTER the disk write, never before.
      setMessages(prev => [...prev, { role: 'assistant', content: response }])

    } catch (err) {
      setError(err.message)
    } finally {
      setIsLoading(false)
      setPipelineStep(null)
    }
  }

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="app">

      <Sidebar
        domains={domains}
        onSelectSession={loadSession}
        onNewChat={newChat}
        onSettingsOpen={() => setSettingsOpen(true)}
      />

      <div className="main">
        <div className="header">
          <DomainBadge domain={domain} filename={sessionFilename} />
          <div className="header-right">
            <SavePulse lastSaved={lastSaved} />
            <span className="model-tag">
              {config?.activeModel === 'multi' ? 'MULTI-AGENT' : config?.activeModel || '—'}
            </span>
          </div>
        </div>

        <ChatWindow
          messages={messages}
          isLoading={isLoading}
          error={error}
          onSend={handleSend}
          pipelineStep={pipelineStep}
        />
      </div>

      {settingsOpen && (
        <Settings
          config={config}
          onClose={() => setSettingsOpen(false)}
          onSave={async (newConfig) => {
            await platform.saveConfig(newConfig)
            setConfig(newConfig)
            setSettingsOpen(false)
          }}
        />
      )}

    </div>
  )
}
