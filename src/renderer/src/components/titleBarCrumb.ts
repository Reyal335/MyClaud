import type { ProjectInfo, TaskSummary } from '../../../shared/ipc'
import type { Screen } from '../screens/types'

export type Crumb = {
  // The screen's name in capitals.
  screen: string
  // The item in view, or null for the screen alone. `rest` is the quieter tail, like the
  // project after a chat title.
  item: { main: string; rest: string | null } | null
}

const SCREEN_NAMES: Record<Screen, string> = {
  chat: 'CHAT',
  inbox: 'INBOX',
  agents: 'AGENTS',
  mascots: 'MASCOTS',
  account: 'ACCOUNT'
}

// What the title bar's breadcrumb shows. On CHAT it is the title and project the CHAT
// header shows; on INBOX with a thread open it is that thread's title (the heading its
// detail shows); anywhere else the screen name alone.
export function titleBarCrumb(
  screen: Screen,
  chatTitle: string,
  project: ProjectInfo | null,
  openTask: TaskSummary | null
): Crumb {
  const name = SCREEN_NAMES[screen]
  if (screen === 'chat' && project) {
    return { screen: name, item: { main: chatTitle, rest: `in ${project.name}` } }
  }
  if (screen === 'inbox' && openTask) {
    return { screen: name, item: { main: openTask.agent.name, rest: null } }
  }
  return { screen: name, item: null }
}
