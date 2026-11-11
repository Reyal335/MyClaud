import type { ProjectInfo } from '../../../shared/ipc'
import type { Conversation } from '../hooks/useConversation'
import ConversationScreen from './ConversationScreen'
import './Screen.css'
import './InboxScreen.css'

type InboxScreenProps = {
  project: ProjectInfo | null
  projectLoaded: boolean
  onOpenProject: () => void
  conversation: Conversation
}

// With no project open, asks for one. Otherwise shows the one conversation.
// Step 7 turns this into the thread list.
function InboxScreen({
  project,
  projectLoaded,
  onOpenProject,
  conversation
}: InboxScreenProps): React.JSX.Element {
  if (!projectLoaded) {
    return <section className="screen inbox" aria-label="Inbox" />
  }

  if (!project) {
    return (
      <section className="screen inbox" aria-labelledby="inbox-title">
        <h1 id="inbox-title" className="screen__title">
          INBOX
        </h1>
        <p className="screen__note">Open a project folder to start a conversation.</p>
        <div>
          <button
            type="button"
            className="button button--primary inbox__open"
            onClick={onOpenProject}
          >
            OPEN PROJECT
          </button>
        </div>
      </section>
    )
  }

  return <ConversationScreen project={project} conversation={conversation} />
}

export default InboxScreen
