import { useCallback, useRef, useState } from 'react'
import AppShell from './components/AppShell'
import NoProject from './components/NoProject'
import Sidebar from './components/Sidebar'
import ConversationScreen from './screens/ConversationScreen'
import InboxScreen from './screens/InboxScreen'
import AgentsScreen from './screens/AgentsScreen'
import MascotsScreen from './screens/MascotsScreen'
import { useConversation, type CallTarget } from './hooks/useConversation'
import { useProject } from './hooks/useProject'
import { useTasks } from './hooks/useTasks'
import type { LeaveGuard, Screen } from './screens/types'

function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('chat')
  const { project, loaded, openProject } = useProject()
  // The conversation and the tasks live above the screens, fed by the same agent
  // events, so CHAT and INBOX always agree and leaving CHAT loses nothing.
  const conversation = useConversation()
  const tasks = useTasks(project?.path ?? null)
  const { clear } = conversation
  // The agent called for my next message, and the task open in INBOX.
  const [call, setCall] = useState<CallTarget | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState(0)

  const handleOpenProject = useCallback(async (): Promise<void> => {
    const previousPath = project?.path
    try {
      const opened = await openProject()
      // A different project has its own conversation and tasks.
      if (opened && opened.path !== previousPath) {
        clear()
        setCall(null)
        setSelectedTaskId(null)
      }
    } catch (err) {
      console.error('Could not open the project:', err)
    }
  }, [project, openProject, clear])

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

  // CALL on an agent card and ASK AGAIN in INBOX open CHAT with the agent called.
  const callAgent = useCallback(
    (target: CallTarget): void => {
      confirmLeave(() => {
        setCall(target)
        setScreen('chat')
        setFocusRequest((n) => n + 1)
      })
    },
    [confirmLeave]
  )

  const openTask = useCallback((taskId: string): void => {
    setSelectedTaskId(taskId)
    setScreen('inbox')
  }, [])

  const mainWaiting = conversation.items.some(
    (item) => item.kind === 'tool' && item.permission !== null && item.taskId === null
  )

  return (
    <AppShell
      sidebar={
        <Sidebar
          screen={screen}
          onNavigate={handleNavigate}
          project={project}
          canOpenProject={!conversation.running}
          onOpenProject={handleSidebarOpenProject}
          chatCount={mainWaiting ? 1 : 0}
          inboxCount={tasks.waitingCount}
        />
      }
    >
      {screen === 'chat' &&
        (!loaded ? (
          <section className="screen" aria-label="Chat" />
        ) : project ? (
          <ConversationScreen
            project={project}
            conversation={conversation}
            call={call}
            onCallChange={setCall}
            focusRequest={focusRequest}
            onOpenTask={openTask}
          />
        ) : (
          <NoProject title="CHAT" onOpenProject={() => void handleOpenProject()} />
        ))}
      {screen === 'inbox' && (
        <InboxScreen
          project={project}
          projectLoaded={loaded}
          onOpenProject={() => void handleOpenProject()}
          conversation={conversation}
          tasks={tasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={setSelectedTaskId}
          onAskAgain={callAgent}
        />
      )}
      {screen === 'agents' && (
        <AgentsScreen project={project} setLeaveGuard={setLeaveGuard} onCall={callAgent} />
      )}
      {screen === 'mascots' && <MascotsScreen setLeaveGuard={setLeaveGuard} />}
    </AppShell>
  )
}

export default App
