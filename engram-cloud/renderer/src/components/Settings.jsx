import { useState } from 'react'

// Settings panel - modal overlay for API keys, model selection, context path.
// Uses local form state so changes don't affect the app until Save is clicked.
// Clicking outside the panel (the overlay div) closes without saving.

export default function Settings({ config, onClose, onSave }) {
  // Initialize form from current config. Falls back to empty strings
  // so inputs are never uncontrolled even on first launch.
  const [form, setForm] = useState({
    activeModel: config?.activeModel || 'claude',
    claudeKey:   config?.apiKeys?.claude  || '',
    openaiKey:   config?.apiKeys?.openai  || '',
    geminiKey:   config?.apiKeys?.gemini  || '',
    contextDir:  config?.contextDir       || ''
  })

  function update(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  // Build the new config object preserving all existing fields
  // (models, etc.) and only updating what the form controls.
  function handleSave() {
    const newConfig = {
      ...config,
      activeModel: form.activeModel,
      contextDir:  form.contextDir,
      apiKeys: {
        claude: form.claudeKey,
        openai: form.openaiKey,
        gemini: form.geminiKey
      }
    }
    onSave(newConfig)
  }

  // Close on overlay click (not on panel click - stopPropagation handles this)
  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  const models = [
    { id: 'claude', label: 'Claude' },
    { id: 'openai', label: 'GPT'    },
    { id: 'gemini', label: 'Gemini' },
    { id: 'multi',  label: 'Multi'  }
  ]

  return (
    <div className="settings-overlay" onClick={handleOverlayClick}>
      <div className="settings-panel" onClick={e => e.stopPropagation()}>

        <div className="settings-header">
          <h2>Settings</h2>
          <button onClick={onClose} className="close-btn">✕</button>
        </div>

        {/* Model selection */}
        <div className="settings-section">
          <label>Active Model</label>
          <div className="model-options">
            {models.map(m => (
              <button
                key={m.id}
                className={`model-option ${form.activeModel === m.id ? 'active' : ''}`}
                onClick={() => update('activeModel', m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* API Keys - type="password" hides chars, shows dots */}
        <div className="settings-section">
          <label>Anthropic API Key</label>
          <input
            type="password"
            value={form.claudeKey}
            onChange={e => update('claudeKey', e.target.value)}
            placeholder="sk-ant-..."
          />
        </div>

        <div className="settings-section">
          <label>OpenAI API Key</label>
          <input
            type="password"
            value={form.openaiKey}
            onChange={e => update('openaiKey', e.target.value)}
            placeholder="sk-..."
          />
        </div>

        <div className="settings-section">
          <label>Gemini API Key</label>
          <input
            type="password"
            value={form.geminiKey}
            onChange={e => update('geminiKey', e.target.value)}
            placeholder="AIza..."
          />
        </div>

        {/* Context directory - where all domain folders and txt files live */}
        <div className="settings-section">
          <label>Context Directory</label>
          <input
            type="text"
            value={form.contextDir}
            onChange={e => update('contextDir', e.target.value)}
            placeholder="/path/to/context"
          />
        </div>

        <button className="save-settings-btn" onClick={handleSave}>
          Save
        </button>

      </div>
    </div>
  )
}
