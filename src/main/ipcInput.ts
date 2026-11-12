import type { ToolInput } from '../shared/ipc'

// Longest string field sent to the renderer in a tool input.
const MAX_IPC_STRING = 20_000

// Copy of a tool input for IPC, with any string longer than MAX_IPC_STRING cut.
export function forIpc(input: Record<string, unknown>): { input: ToolInput; truncated: boolean } {
  let truncated = false
  const cut = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (value.length <= MAX_IPC_STRING) return value
      truncated = true
      return value.slice(0, MAX_IPC_STRING)
    }
    if (Array.isArray(value)) return value.map(cut)
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cut(item)]))
    }
    return value
  }
  return { input: cut(input) as ToolInput, truncated }
}

export const DENY_MESSAGE = 'The user denied this action.'

// The Agent tool. Older Claude Code versions call it Task.
export function isAgentTool(name: string): boolean {
  return name === 'Agent' || name === 'Task'
}
