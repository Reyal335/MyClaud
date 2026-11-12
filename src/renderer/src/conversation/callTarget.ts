import type { AgentSummary, TaskStatus } from '../../../shared/ipc'
import type { CallTarget } from '../hooks/useConversation'

// An agent from the step 5 list, as something to call for my next message.
export function callTargetOf(agent: AgentSummary): CallTarget {
  return {
    ref: { scope: agent.scope, filePath: agent.filePath },
    agent: {
      name: agent.name,
      scope: agent.scope,
      filePath: agent.filePath,
      icon: agent.icon,
      role: agent.role
    }
  }
}

// A task's status as a word, never color alone.
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  running: 'RUNNING',
  waiting: 'WAITING',
  done: 'DONE',
  error: 'ERROR',
  stopped: 'STOPPED'
}
