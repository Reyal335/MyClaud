import { useCallback, useRef, useState } from 'react'
import AppShell from './components/AppShell'
import Sidebar from './components/Sidebar'
import InboxScreen from './screens/InboxScreen'
import AgentsScreen from './screens/AgentsScreen'
import MascotsScreen from './screens/MascotsScreen'
import { useConversation } from './hooks/useConversation'
import { useProject } from './hooks/useProject'
import type { LeaveGuard, Screen } from './screens/types'

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

  // A screen with unsaved changes asks before the app navigates or switches project.
  const leaveGuard = useRef<LeaveGuard | null>(null)
  const setLeaveGuard = useCallback((guard: LeaveGuard | null): void => {
    leaveGuard.current = guard
  }, [])
  const confirmLeave = useCallback((proceed: () => void): void => {
    if (leaveGuard.current) leaveGuard.current(proceed)
    else proceed()
  }, [])

  const handleNavigate = useCallback(
    (next: Screen): void => {
      if (next !== screen) confirmLeave(() => setScreen(next))
    },
    [screen, confirmLeave]
  )

  const handleSidebarOpenProject = useCallback((): void => {
    confirmLeave(() => void handleOpenProject())
  }, [confirmLeave, handleOpenProject])

  return (
    <AppShell
      sidebar={
        <Sidebar
          screen={screen}
          onNavigate={handleNavigate}
          project={project}
          canOpenProject={!conversation.running}
          onOpenProject={handleSidebarOpenProject}
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
      {screen === 'agents' && <AgentsScreen project={project} setLeaveGuard={setLeaveGuard} />}
      {screen === 'mascots' && <MascotsScreen setLeaveGuard={setLeaveGuard} />}
    </AppShell>
  )
}

export default App
