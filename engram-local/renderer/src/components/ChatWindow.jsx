import { useState, useRef, useEffect } from 'react'
import { platform } from '../platform'

export default function ChatWindow({ messages, isLoading, error, onSend, pipelineStep }) {
  const [input, setInput]           = useState('')
  const [attachments, setAttachments] = useState([])
  // attachments = [{name, isImage, text?, mimeType?, data?}]
  const bottomRef   = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  function send() {
    const trimmed = input.trim()
    if ((!trimmed && !attachments.length) || isLoading) return
    onSend(trimmed || '[Files attached]', attachments)
    setInput('')
    setAttachments([])
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  function handleInputChange(e) {
    setInput(e.target.value)
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
    }
  }

  // Opens native file picker, allows multiple selection.
  // Reads each selected file and appends to attachments array.
  async function handleAttach() {
    const filePaths = await platform.pickFiles()
    if (!filePaths || !filePaths.length) return
    const results = await Promise.all(
      filePaths.map(fp => platform.readAttachment(fp))
    )
    // Deduplicate by name - prevent adding the same file twice
    setAttachments(prev => {
      const existing = new Set(prev.map(a => a.name))
      const fresh = results.filter(r => !existing.has(r.name))
      return [...prev, ...fresh]
    })
  }

  function removeAttachment(name) {
    setAttachments(prev => prev.filter(a => a.name !== name))
  }

  function badgeColor(a) {
    if (a.isImage) return '#5b8dd9'
    const ext = a.name.split('.').pop().toLowerCase()
    if (ext === 'pdf' || ext === 'docx') return '#c44a3a'
    if (['py','js','ts','jsx','tsx','r','go','java','cs','cpp','c','rb','php','swift','kt','rs'].includes(ext)) return '#6db885'
    if (ext === 'zip') return '#a06abf'
    return '#888'
  }

  function badgeLabel(a) {
    return a.name.split('.').pop().toUpperCase() || 'FILE'
  }

  return (
    <div className="chat-window">
      <div className="messages">
        {messages.length === 0 && !isLoading && (
          <div className="empty-state">
            <p>Start a conversation. Domain is classified automatically from your first message.</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`message message-${msg.role}`}>
            <div className="message-label">
              {msg.role === 'user' ? 'YOU' : 'AI'}
            </div>
            <div className="message-content">{msg.content}</div>
            {msg.attachmentNames?.length > 0 && (
              <div className="message-attachment-chips">
                {msg.attachmentNames.map(n => (
                  <span key={n} className="message-attachment-chip">📎 {n}</span>
                ))}
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="message message-assistant">
            <div className="message-label">
              {pipelineStep === 'reasoning'    ? 'CLAUDE · REASONING'    :
               pipelineStep === 'auditing'     ? 'GPT · AUDITING'        :
               pipelineStep === 'synthesizing' ? 'GEMINI · SYNTHESIZING' :
               'AI'}
            </div>
            <div className="message-content thinking">
              <span className="dot" /><span className="dot" /><span className="dot" />
            </div>
          </div>
        )}

        {error && <div className="error-banner">{error}</div>}
        <div ref={bottomRef} />
      </div>

      {/* Attachment chips - shown when files are selected */}
      {attachments.length > 0 && (
        <div className="attachment-preview">
          {attachments.map(a => (
            <div key={a.name} className="attachment-chip-row">
              <span className="attachment-badge" style={{ background: badgeColor(a) }}>
                {badgeLabel(a)}
              </span>
              <span className="attachment-name" title={a.name}>{a.name}</span>
              <button className="attachment-remove" onClick={() => removeAttachment(a.name)}>✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="input-area">
        <button
          className="attach-btn"
          onClick={handleAttach}
          disabled={isLoading}
          title="Attach files (multiple)"
        >
          📎
        </button>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={attachments.length ? 'Add a message (optional)...' : 'Type a message - Shift+Enter for new line'}
          rows={1}
          disabled={isLoading}
        />
        <button
          onClick={send}
          disabled={isLoading || (!input.trim() && !attachments.length)}
          className="send-btn"
          title="Send (Enter)"
        >
          ↑
        </button>
      </div>
    </div>
  )
}
