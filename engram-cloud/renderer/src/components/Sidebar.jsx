import { useState } from 'react'
import { platform } from '../platform'

// Sidebar owns its own session cache per domain.
// Sessions are fetched lazily - only when a domain is expanded.
// This avoids loading all session metadata on startup.

export default function Sidebar({ domains, onSelectSession, onNewChat, onSettingsOpen }) {
  const [expandedDomain, setExpandedDomain] = useState(null)
  const [sessionCache, setSessionCache]     = useState({})
  // sessionCache = { 'medai': [{name, path, modified}], 'job_search': [...] }
  // Populated on first expand of each domain. Never re-fetched unless forced.

  async function toggleDomain(domain) {
    if (expandedDomain === domain) {
      // Clicking an already-open domain collapses it
      setExpandedDomain(null)
      return
    }
    setExpandedDomain(domain)
    // Only fetch if not already in cache
    if (!sessionCache[domain]) {
      const list = await platform.listSessions(domain)
      setSessionCache(prev => ({ ...prev, [domain]: list }))
    }
  }

  // Converts a raw filename to a readable label.
  // 'adversarial_council_architecture_2026-06-01.txt'
  //   → 'adversarial council architecture'
  function sessionLabel(name) {
    return name
      .replace(/\.txt$/, '')
      // Remove trailing date stamp (with optional collision counter)
      .replace(/_\d{4}-\d{2}-\d{2}(_\d+)?$/, '')
      .replace(/_/g, ' ')
  }

  // Same for domain names - 'job_search' → 'job search'
  function domainLabel(name) {
    return name.replace(/_/g, ' ')
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-logo">Engram</span>
        <button className="new-chat-btn" onClick={onNewChat} title="New chat">+</button>
      </div>

      <div className="domain-list">
        {domains.length === 0 && (
          <p className="sidebar-empty">No sessions yet</p>
        )}

        {domains.map(domain => (
          <div key={domain} className="domain-group">
            <button
              className={`domain-btn ${expandedDomain === domain ? 'active' : ''}`}
              onClick={() => toggleDomain(domain)}
            >
              <span className="domain-icon">▸</span>
              {domainLabel(domain)}
            </button>

            {expandedDomain === domain && sessionCache[domain] && (
              <div className="session-list">
                {sessionCache[domain].length === 0 && (
                  <span className="session-btn" style={{ fontStyle: 'italic' }}>
                    No sessions
                  </span>
                )}
                {sessionCache[domain].map(session => (
                  <button
                    key={session.path}
                    className="session-btn"
                    onClick={() => onSelectSession(session.path, domain, session.name)}
                    title={session.name}
                  >
                    {sessionLabel(session.name)}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <button className="settings-btn" onClick={onSettingsOpen}>
        ⚙ Settings
      </button>
    </div>
  )
}
