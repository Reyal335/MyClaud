import './Screen.css'

function AgentsScreen(): React.JSX.Element {
  return (
    <section className="screen" aria-labelledby="agents-title">
      <h1 id="agents-title" className="screen__title">
        AGENTS
      </h1>
      <p className="screen__note">
        Project and global agents will be listed here to create, edit, and delete.
      </p>
    </section>
  )
}

export default AgentsScreen
