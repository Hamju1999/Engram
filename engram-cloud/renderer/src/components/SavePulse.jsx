import { useState, useEffect } from 'react'

// SavePulse gives visual confirmation that a turn was written to disk.
// It watches the `lastSaved` Date prop from App.jsx.
// Every time lastSaved changes (a new Date is set after each writeTurn call),
// the dot flashes amber for 800ms, then settles into a dim steady green.
//
// The timestamp beside the dot shows exactly when the last write happened.
// Users can verify their data was saved without opening the txt file.

export default function SavePulse({ lastSaved }) {
  const [pulsing, setPulsing] = useState(false)

  // Watch for lastSaved changes.
  // setTimeout clears the pulse class after 800ms.
  // Cleanup (clearTimeout) prevents memory leaks if component unmounts
  // or lastSaved changes again before the timeout fires.
  useEffect(() => {
    if (!lastSaved) return
    setPulsing(true)
    const t = setTimeout(() => setPulsing(false), 800)
    return () => clearTimeout(t)
  }, [lastSaved])

  // Format: HH:MM:SS
  function formatTime(date) {
    if (!date) return ''
    const h = String(date.getHours()).padStart(2, '0')
    const m = String(date.getMinutes()).padStart(2, '0')
    const s = String(date.getSeconds()).padStart(2, '0')
    return `${h}:${m}:${s}`
  }

  return (
    <div className="save-pulse" title={lastSaved ? `Last saved ${formatTime(lastSaved)}` : 'Not saved yet'}>
      <span className={[
        'pulse-dot',
        lastSaved ? 'saved' : '',
        pulsing   ? 'active' : ''
      ].filter(Boolean).join(' ')} />
      {lastSaved && (
        <span className="pulse-time">{formatTime(lastSaved)}</span>
      )}
    </div>
  )
}
