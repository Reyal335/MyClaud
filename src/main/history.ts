import type { HistoryItem, TaskAgent, TaskStatus, ToolState } from '../shared/ipc'
import { parseCall } from '../shared/callAgent'
import { DENY_MESSAGE, forIpc, isAgentTool } from './ipcInput'

// Turns the main conversation's saved messages (from the SDK's getSessionMessages)
// into the items the conversation shows. Pure: no file access. Anything that is
// not my text, reply text, a tool call, or an agent call is left out.

// The part of an SDK SessionMessage this needs.
export type RecordedMessage = {
  type: 'user' | 'assistant' | 'system'
  message: unknown
  parent_tool_use_id: string | null
}

export type SavedTask = {
  agent: TaskAgent
  description: string
  status: TaskStatus
  report: string | null
}

export type HistoryContext = {
  // Tasks main still has in tasks.json, by tool call id.
  tasks: Map<string, SavedTask>
  // How an agent named in a call sentence or an Agent call looks.
  agentFor: (name: string) => TaskAgent
}

type Block = Record<string, unknown>

// Text Claude Code itself puts into the conversation, not typed by me.
const INJECTED =
  /^\s*(<(system-reminder|command-[a-z-]+|local-command-[a-z-]+|user-prompt-submit-hook|task-notification|bash-[a-z-]+)>|\[Request interrupted)/

function blocksOf(message: unknown): Block[] | string | null {
  if (typeof message !== 'object' || message === null) return null
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  return content.filter((block): block is Block => typeof block === 'object' && block !== null)
}

function resultText(block: Block): string {
  const content = block.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === 'object' && part !== null && typeof (part as Block).text === 'string'
          ? (part as Block).text
          : ''
      )
      .join('\n')
  }
  return ''
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function historyItems(messages: RecordedMessage[], context: HistoryContext): HistoryItem[] {
  const items: HistoryItem[] = []

  const addUserText = (text: string): void => {
    if (text.trim() === '' || INJECTED.test(text)) return
    const call = parseCall(text)
    items.push(
      call
        ? { kind: 'user', text: call.text, call: context.agentFor(call.agentName) }
        : { kind: 'user', text, call: null }
    )
  }

  // `model` is the exact model that wrote the reply. Text Claude Code writes itself
  // is marked '<synthetic>': no model.
  const addReplyText = (text: string, model: string | null): void => {
    if (text === '') return
    const last = items[items.length - 1]
    if (last?.kind === 'text') items[items.length - 1] = { ...last, text: last.text + text }
    else items.push({ kind: 'text', text, model })
  }

  const settle = (block: Block): void => {
    const id = str(block.tool_use_id)
    const index = items.findIndex(
      (item) =>
        (item.kind === 'tool' && item.toolId === id) || (item.kind === 'task' && item.taskId === id)
    )
    if (index < 0) return
    const item = items[index]
    const failed = block.is_error === true
    if (item.kind === 'tool') {
      const text = resultText(block)
      const state: ToolState = !failed ? 'done' : text.includes(DENY_MESSAGE) ? 'denied' : 'failed'
      items[index] = { ...item, state }
    } else if (item.kind === 'task' && !context.tasks.has(id)) {
      items[index] = { ...item, status: failed ? 'error' : 'done' }
    }
  }

  for (const recorded of messages) {
    if (recorded.parent_tool_use_id !== null) continue
    const blocks = blocksOf(recorded.message)
    if (blocks === null) continue

    if (recorded.type === 'user') {
      if (typeof blocks === 'string') {
        addUserText(blocks)
        continue
      }
      const text = blocks
        .filter((block) => block.type === 'text')
        .map((block) => str(block.text))
        .join('\n')
      addUserText(text)
      for (const block of blocks) if (block.type === 'tool_result') settle(block)
      continue
    }

    if (recorded.type !== 'assistant' || typeof blocks === 'string') continue
    const written = str((recorded.message as { model?: unknown } | null)?.model)
    const model = written === '' || written.startsWith('<') ? null : written
    for (const block of blocks) {
      if (block.type === 'text') {
        addReplyText(str(block.text), model)
      } else if (block.type === 'tool_use') {
        const id = str(block.id)
        const name = str(block.name)
        const input = (
          typeof block.input === 'object' && block.input !== null ? block.input : {}
        ) as Record<string, unknown>
        if (isAgentTool(name)) {
          const saved = context.tasks.get(id)
          items.push({
            kind: 'task',
            taskId: id,
            agent: saved?.agent ?? context.agentFor(str(input.subagent_type) || 'general-purpose'),
            description: saved?.description ?? str(input.description),
            // No result yet means the run ended first.
            status: saved?.status ?? 'stopped',
            activity: null,
            report: saved?.report ?? null
          })
        } else {
          const shown = forIpc(input)
          items.push({
            kind: 'tool',
            toolId: id,
            name,
            input: shown.input,
            truncated: shown.truncated,
            state: 'stopped'
          })
        }
      }
    }
  }
  return items
}
