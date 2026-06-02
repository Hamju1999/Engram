// DomainBadge shows the active session's domain and filename in the header.
// Pure display component - no state, no logic.
// Renders differently based on whether a session is active.

export default function DomainBadge({ domain, filename }) {

  // No active session - show placeholder
  if (!domain) {
    return (
      <div className="domain-badge empty">
        <span>New Session</span>
      </div>
    )
  }

  // Strip any remaining underscores for display
  const domainLabel   = domain.replace(/_/g, ' ')
  const filenameLabel = filename ? filename.replace(/_/g, ' ') : ''

  return (
    <div className="domain-badge">
      {/* Domain in amber */}
      <span className="domain-badge-domain">{domainLabel}</span>

      {/* Separator and filename only if filename exists */}
      {filenameLabel && (
        <>
          <span className="domain-badge-sep">/</span>
          <span className="domain-badge-filename">{filenameLabel}</span>
        </>
      )}
    </div>
  )
}
