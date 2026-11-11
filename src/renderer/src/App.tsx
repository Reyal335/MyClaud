import { useCallback, useState } from 'react'
import AppShell from './components/AppShell'
import Sidebar from './components/Sidebar'
import InboxScreen from './screens/InboxScreen'
import AgentsScreen from './screens/AgentsScreen'
import MascotsScreen from './screens/MascotsScreen'
import { useConversation } from './hooks/useConversation'
import { useProject } from './hooks/useProject'
import type { Screen } from './screens/types'

function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('inbox')
  const { project, loaded, openProject } = useProject()
  const conversation = useConversation()
  const { reset } = conversation

  const handleOpenProject = useCallback(async (): Promise<void> => {
    const previousPath = project?.path
    try {
      const opened = await openProject()
      // A different project starts a new session, so clear the old reply.
      if (opened && opened.path !== previousPath) reset()
    } catch (err) {
      console.error('Could not open the project:', err)
    }
  }, [project, openProject, reset])

  return (
    <AppShell
      sidebar={
        <Sidebar
          screen={screen}
          onNavigate={setScreen}
          project={project}
          canOpenProject={!conversation.running}
          onOpenProject={handleOpenProject}
          inboxCount={conversation.status === 'waiting' ? 1 : 0}
        />
      }
    >
      {screen === 'inbox' && (
        <InboxScreen
          project={project}
          projectLoaded={loaded}
          onOpenProject={handleOpenProject}
          conversation={conversation}
        />
      )}
      {screen === 'agents' && <AgentsScreen />}
      {screen === 'mascots' && <MascotsScreen />}
    </AppShell>
  )
}

export default App
