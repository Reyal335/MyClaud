import '../screens/Screen.css'

type NoProjectProps = {
  title: string
  onOpenProject: () => void
}

// Step 2's "open a project" state, used by CHAT and INBOX.
function NoProject({ title, onOpenProject }: NoProjectProps): React.JSX.Element {
  return (
    <section className="screen no-project" aria-labelledby="no-project-title">
      <h1 id="no-project-title" className="screen__title">
        {title}
      </h1>
      <p className="screen__note">Open a project folder to start a conversation.</p>
      <div>
        <button
          type="button"
          className="button button--primary no-project__open"
          onClick={onOpenProject}
        >
          OPEN PROJECT
        </button>
      </div>
    </section>
  )
}

export default NoProject
