import './AgentIcon.css'

type AgentIconProps = {
  // A 16x16 PNG data URL, or null for the default question-mark icon.
  src: string | null
  // Whole-number scales of 16 only.
  size: 16 | 32 | 48 | 64
  label: string
}

function AgentIcon({ src, size, label }: AgentIconProps): React.JSX.Element {
  if (src) {
    return <img className="agent-icon" src={src} width={size} height={size} alt={label} />
  }
  // The default icon from designs/3-agent-manager.html.
  return (
    <svg
      className="agent-icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
    >
      <rect className="agent-icon__frame" x=".5" y=".5" width="15" height="15" />
      <path className="agent-icon__mark" d="M6 3h4v2H6zM10 5h2v2h-2zM8 7h2v2H8zM8 11h2v2H8z" />
    </svg>
  )
}

export default AgentIcon
