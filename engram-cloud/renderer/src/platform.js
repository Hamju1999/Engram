// ─── PLATFORM DETECTION ───────────────────────────────────────────────────────
// window.api is injected exclusively by Electron's preload script.
// On mobile (Capacitor), window.api is undefined.
const IS_ELECTRON = typeof window !== 'undefined' && !!window.api

// ─── MOBILE: CONSTANTS ────────────────────────────────────────────────────────
const MOBILE_CONTEXT_BASE = 'Engram/context'
const CONFIG_PREFS_KEY    = 'context_vault_config'

const MOBILE_DEFAULT_CONFIG = {
  contextDir:  MOBILE_CONTEXT_BASE,
  activeModel: 'claude',
  apiKeys: { claude: '', openai: '', gemini: '' },
  models: {
    claude: { default: 'claude-sonnet-4-6' },
    openai: { default: 'gpt-5.5-2026-04-23', fallback: 'gpt-5.4-2026-03-05' },
    gemini: { default: 'gemini-flash-latest', pinned: 'gemini-3.5-flash' }
  }
}

// ─── DYNAMIC CAPACITOR IMPORTS ────────────────────────────────────────────────
// Capacitor modules are imported dynamically ONLY when a mobile function
// is actually called. Static imports at the top of the file would execute
// in Electron too and crash the renderer since Capacitor plugins don't
// exist in an Electron/Node environment.

async function getFS() {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
  return { Filesystem, Directory, Encoding }
}

async function getPrefs() {
  const { Preferences } = await import('@capacitor/preferences')
  return { Preferences }
}

// ─── MOBILE: HELPERS ──────────────────────────────────────────────────────────
async function loadMobileConfig() {
  const { Preferences } = await getPrefs()
  const { value } = await Preferences.get({ key: CONFIG_PREFS_KEY })
  if (!value) return MOBILE_DEFAULT_CONFIG
  return JSON.parse(value)
}

async function mobileFileExists(path) {
  const { Filesystem, Directory } = await getFS()
  try {
    await Filesystem.stat({ path, directory: Directory.Documents })
    return true
  } catch {
    return false
  }
}

async function mobileAppend(path, content) {
  const { Filesystem, Directory, Encoding } = await getFS()
  const exists = await mobileFileExists(path)
  if (exists) {
    const { data } = await Filesystem.readFile({
      path, directory: Directory.Documents, encoding: Encoding.UTF8
    })
    await Filesystem.writeFile({
      path, data: data + content,
      directory: Directory.Documents, encoding: Encoding.UTF8
    })
  } else {
    await Filesystem.writeFile({
      path, data: content,
      directory: Directory.Documents,
      encoding: Encoding.UTF8, recursive: true
    })
  }
}

function buildSessionPath(domain, filename, date, counter = null) {
  const dateStr = date.toISOString().slice(0, 10)
  const suffix  = counter ? `_${counter}` : ''
  return `${MOBILE_CONTEXT_BASE}/${domain}/${filename}_${dateStr}${suffix}.txt`
}

// ─── MOBILE: DIRECT AI API CALLER ────────────────────────────────────────────
async function mobileCallAPI(messages, systemPrompt, config) {
  const { activeModel, apiKeys, models } = config

  if (activeModel === 'claude') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKeys.claude,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: models.claude.default,
        max_tokens: 16000,
        system: systemPrompt || '',
        messages,
        thinking: { type: 'enabled', budget_tokens: 10000 },
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    })
    const data = await res.json()
    if (data.error) throw new Error(`Claude API error: ${data.error.message}`)
    return data.content.filter(b => b.type === 'text').map(b => b.text).join('\n')

  } else if (activeModel === 'openai') {
    const allMessages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKeys.openai}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: models.openai.default,
        messages: allMessages,
        reasoning_effort: 'high',
        tools: [{ type: 'web_search_preview' }]
      })
    })
    const data = await res.json()
    if (data.error) throw new Error(`OpenAI API error: ${data.error.message}`)
    return data.choices[0].message.content

  } else if (activeModel === 'gemini') {
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }))
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${models.gemini.default}:generateContent?key=${apiKeys.gemini}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents,
          system_instruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
          generationConfig: { thinking_config: { thinking_budget: 8192 } },
          tools: [{ google_search: {} }]
        })
      }
    )
    const data = await res.json()
    if (data.error) throw new Error(`Gemini API error: ${data.error.message}`)
    return data.candidates[0].content.parts[0].text
  }

  throw new Error(`Unknown model: ${activeModel}`)
}

// ─── MOBILE API IMPLEMENTATION ────────────────────────────────────────────────
const mobileApi = {

  loadConfig: async () => loadMobileConfig(),

  saveConfig: async (newConfig) => {
    const { Preferences } = await getPrefs()
    await Preferences.set({ key: CONFIG_PREFS_KEY, value: JSON.stringify(newConfig) })
    return { success: true }
  },

  classifyDomain: async (firstMessage) => {
    const config = await loadMobileConfig()
    const prompt = `You are a domain classifier for a personal long-term context storage system.

Based on the user's first message, determine:
1. domain  - a short snake_case category label. Examples: medai, job_search, hamju_core, cooking, finance
2. filename - a descriptive snake_case name, max 5 words, no date, no extension.

Return ONLY valid JSON. No markdown. No explanation. No backticks.
{"domain":"medai","filename":"adversarial_council_architecture"}

User's first message:
${firstMessage}`

    const result = await mobileCallAPI([{ role: 'user', content: prompt }], null, config)
    return JSON.parse(result.replace(/```json|```/g, '').trim())
  },

  createSession: async ({ domain, filename, model }) => {
    const { Filesystem, Directory, Encoding } = await getFS()
    const domainPath = `${MOBILE_CONTEXT_BASE}/${domain}`
    try {
      await Filesystem.mkdir({ path: domainPath, directory: Directory.Documents, recursive: true })
    } catch { /* already exists */ }

    const now = new Date()
    let filePath = buildSessionPath(domain, filename, now)
    let counter  = 2
    while (await mobileFileExists(filePath)) {
      filePath = buildSessionPath(domain, filename, now, counter++)
    }

    const pad = n => String(n).padStart(2, '0')
    const header = [
      '=== SESSION HEADER ===',
      `Date     : ${now.toISOString().slice(0, 10)}`,
      `Time     : ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
      `Model    : ${model}`,
      `Domain   : ${domain}`,
      `File     : ${filePath.split('/').pop()}`,
      '======================', ''
    ].join('\n')

    await Filesystem.writeFile({
      path: filePath, data: header,
      directory: Directory.Documents,
      encoding: Encoding.UTF8, recursive: true
    })
    return filePath
  },

  writeTurn: async ({ filePath, role, content }) => {
    const now  = new Date()
    const pad  = n => String(n).padStart(2, '0')
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    await mobileAppend(filePath, `[${role === 'user' ? 'USER' : 'ASSISTANT'} | ${time}]\n${content}\n\n`)
    return { success: true }
  },

  sendMessage: async ({ messages, systemContext }) => {
    const config = await loadMobileConfig()
    return mobileCallAPI(messages, systemContext, config)
  },

  listDomains: async () => {
    const { Filesystem, Directory } = await getFS()
    try {
      await Filesystem.mkdir({ path: MOBILE_CONTEXT_BASE, directory: Directory.Documents, recursive: true })
      const { files } = await Filesystem.readdir({ path: MOBILE_CONTEXT_BASE, directory: Directory.Documents })
      return files.filter(f => f.type === 'directory').map(f => f.name).sort()
    } catch { return [] }
  },

  listSessions: async (domain) => {
    const { Filesystem, Directory } = await getFS()
    try {
      const { files } = await Filesystem.readdir({
        path: `${MOBILE_CONTEXT_BASE}/${domain}`,
        directory: Directory.Documents
      })
      return files
        .filter(f => f.name.endsWith('.txt'))
        .map(f => ({
          name: f.name,
          path: `${MOBILE_CONTEXT_BASE}/${domain}/${f.name}`,
          modified: new Date(f.mtime)
        }))
        .sort((a, b) => b.modified - a.modified)
    } catch { return [] }
  },

  readSession: async (filePath) => {
    const { Filesystem, Directory, Encoding } = await getFS()
    const { data } = await Filesystem.readFile({
      path: filePath, directory: Directory.Documents, encoding: Encoding.UTF8
    })
    return data
  }
}

// ─── EXPORT ───────────────────────────────────────────────────────────────────
// Electron → window.api (preload handles everything, no Capacitor needed)
// Mobile   → mobileApi (Capacitor, loaded lazily above)
export const platform = IS_ELECTRON ? window.api : mobileApi