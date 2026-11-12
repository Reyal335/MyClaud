import type { TaskAgent } from '../../../shared/ipc'
import { labelText, toolLabel } from '../../../shared/toolLabel'
import type { ConversationItem, TaskItem } from '../hooks/useConversation'

// What each agent in the conversation is doing, from the conversation items: a
// task's tool calls carry its taskId, and a pending request makes it wait.

export type TaskView = {
  item: TaskItem
  // working and waiting only while the task runs.
  state: 'working' | 'waiting' | 'ended'
  // The latest tool call, as one line ("Reading src/auth.js"), or null.
  activity: string | null
}

export function taskViews(
  items: ConversationItem[],
  projectPath: string | null
): Map<string, TaskView> {
  const views = new Map<string, TaskView>()
  for (const item of items) {
    if (item.kind !== 'task') continue
    const calls = items.filter(
      (entry): entry is Extract<ConversationItem, { kind: 'tool' }> =>
        entry.kind === 'tool' && entry.taskId === item.taskId
    )
    const latest = calls[calls.length - 1]
    const open = item.status === 'running' || item.status === 'waiting'
    views.set(item.taskId, {
      item,
      state: !open
        ? 'ended'
        : calls.some((call) => call.permission !== null)
          ? 'waiting'
          : 'working',
      activity: latest ? labelText(toolLabel(latest.name, latest.input, projectPath)) : null
    })
  }
  return views
}

// One key per agent: its file, or its name for a built-in agent.
export function agentKey(agent: Pick<TaskAgent, 'name' | 'filePath'>): string {
  return agent.filePath ?? `built-in:${agent.name}`
}

export type PartyWork = {
  state: 'working' | 'waiting'
  activity: string | null
  taskId: string
  agent: TaskAgent
}

// Per agent, the task to show in its party row: the newest one, but a task that
// waits for me wins over one that works.
export function partyWork(views: Map<string, TaskView>): Map<string, PartyWork> {
  const work = new Map<string, PartyWork>()
  for (const view of views.values()) {
    if (view.state === 'ended') continue
    const key = agentKey(view.item.agent)
    const current = work.get(key)
    if (current?.state === 'waiting' && view.state !== 'waiting') continue
    work.set(key, {
      state: view.state,
      activity: view.activity,
      taskId: view.item.taskId,
      agent: view.item.agent
    })
  }
  return work
}
