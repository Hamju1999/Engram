import { useState } from 'react'

const SERVER_PRESETS = [
  { id: 'ollama',   label: 'Ollama',    url: 'http://localhost:11434/v1' },
  { id: 'lmstudio', label: 'LM Studio', url: 'http://localhost:1234/v1'  },
  { id: 'custom',   label: 'Custom',    url: ''                           }
]

export default function Settings({ config, onClose, onSave }) {
  const [form, setForm] = useState({
    serverType:  config?.serverType  || 'ollama',
    serverUrl:   config?.serverUrl   || 'http://localhost:11434/v1',
    activeMode:  config?.activeMode  || 'single',
    primary:     config?.models?.primary     || 'llama3.2',
    auditor:     config?.models?.auditor     || 'mistral',
    synthesizer: config?.models?.synthesizer || 'gemma2',
    contextDir:  config?.contextDir  || ''
  })

  function update(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function selectPreset(preset) {
    update('serverType', preset.id)
    if (preset.url) update('serverUrl', preset.url)
  }

  function handleSave() {
    onSave({
      ...config,
      serverType:  form.serverType,
      serverUrl:   form.serverUrl,
      activeMode:  form.activeMode,
      contextDir:  form.contextDir,
      models: {
        primary:     form.primary,
        auditor:     form.auditor,
        synthesizer: form.synthesizer
      }
    })
  }

  return (
    <div className="settings-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="settings-panel">
        <div className="settings-header">
          <h2>Settings · Local</h2>
          <button onClick={onClose} className="close-btn">✕</button>
        </div>

        {/* Server */}
        <div className="settings-section">
          <label>Local Server</label>
          <div className="server-presets">
            {SERVER_PRESETS.map(p => (
              <button key={p.id}
                className={`preset-btn ${form.serverType === p.id ? 'active' : ''}`}
                onClick={() => selectPreset(p)}>
                {p.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={form.serverUrl}
            onChange={e => { update('serverUrl', e.target.value); update('serverType', 'custom') }}
            placeholder="http://localhost:11434/v1"
          />
        </div>

        {/* Mode */}
        <div className="settings-section">
          <label>Mode</label>
          <div className="mode-options">
            <button className={`mode-option ${form.activeMode === 'single' ? 'active' : ''}`}
              onClick={() => update('activeMode', 'single')}>Single Model</button>
            <button className={`mode-option ${form.activeMode === 'multi' ? 'active' : ''}`}
              onClick={() => update('activeMode', 'multi')}>Multi-Agent</button>
          </div>
        </div>

        {/* Models */}
        <div className="settings-section">
          <label>Models</label>
          <div className="model-grid">
            <div className="model-row">
              <span>{form.activeMode === 'multi' ? 'Reasoner' : 'Primary'}</span>
              <input type="text" value={form.primary}
                onChange={e => update('primary', e.target.value)}
                placeholder="llama3.2" />
            </div>
            {form.activeMode === 'multi' && <>
              <div className="model-row">
                <span>Auditor</span>
                <input type="text" value={form.auditor}
                  onChange={e => update('auditor', e.target.value)}
                  placeholder="mistral" />
              </div>
              <div className="model-row">
                <span>Synthesizer</span>
                <input type="text" value={form.synthesizer}
                  onChange={e => update('synthesizer', e.target.value)}
                  placeholder="gemma2" />
              </div>
            </>}
          </div>
        </div>

        {/* Context dir */}
        <div className="settings-section">
          <label>Context Directory</label>
          <input type="text" value={form.contextDir}
            onChange={e => update('contextDir', e.target.value)}
            placeholder="/path/to/context" />
        </div>

        <button className="save-settings-btn" onClick={handleSave}>Save</button>
      </div>
    </div>
  )
}
