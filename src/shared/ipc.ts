// Shared IPC contract between main, preload, and renderer.
// Our own small types only: never raw Agent SDK messages.

export const IpcChannel = {
  ProjectGet: 'project:get',
  ProjectOpen: 'project:open',
  AgentSend: 'agent:send',
  AgentStop: 'agent:stop',
  AgentPermission: 'agent:permission',
  AgentEvent: 'agent:event',
  AgentsList: 'agents:list',
  AgentsRead: 'agents:read',
  AgentsCreate: 'agents:create',
  AgentsUpdate: 'agents:update',
  AgentsRemove: 'agents:remove',
  AgentsPickIcon: 'agents:pick-icon',
  AgentsDiscardIcon: 'agents:discard-icon'
} as const

export type ProjectInfo = {
  path: string
  name: string
}

export type AgentErrorCode =
  | 'no_project'
  | 'busy'
  | 'invalid_prompt'
  | 'not_signed_in'
  | 'api_key_in_use'
  | 'rate_limit'
  | 'overloaded'
  | 'billing'
  | 'sdk_error'

export type AgentError = {
  code: AgentErrorCode
  message: string
}

export type AgentSendResult = { ok: true; requestId: string } | { ok: false; error: AgentError }

// A tool call's input as the SDK gives it. String fields over the IPC size limit
// are cut, and the event says so with `truncated`.
export type ToolInput = Record<string, unknown>

export type ToolEndState = 'done' | 'failed' | 'denied'

export type PermissionDecision = 'approve' | 'deny'

// Main to renderer, on IpcChannel.AgentEvent. Every event carries the requestId.
export type AgentEvent =
  | { requestId: string; type: 'text'; text: string }
  | { requestId: string; type: 'tool_start'; toolId: string; name: string }
  | { requestId: string; type: 'tool_input'; toolId: string; input: ToolInput; truncated: boolean }
  | { requestId: string; type: 'tool_end'; toolId: string; state: ToolEndState }
  | {
      requestId: string
      type: 'permission_request'
      permissionId: string
      toolId: string
      name: string
      input: ToolInput
      truncated: boolean
    }
  | {
      requestId: string
      type: 'permission_resolved'
      permissionId: string
      decision: PermissionDecision
    }
  | { requestId: string; type: 'done' }
  | { requestId: string; type: 'stopped' }
  | { requestId: string; type: 'error'; code: AgentErrorCode; message: string }

// Agent files: Claude Code subagents in <project>/.claude/agents/ and the global folder.

export type AgentScope = 'project' | 'global'

export type AgentSummary = {
  scope: AgentScope
  filePath: string
  // The name field, or the filename when the file has a problem and no name.
  name: string
  description: string
  // null means the tools key is left out, so the agent inherits every tool.
  tools: string[] | null
  // null means the model key is left out, so Claude Code picks the default.
  model: string | null
  otherFields: string[]
  icon: string | null
  // A MyClaud label such as "code-reader", kept in userData, not in the file.
  role: string | null
  problem: string | null
}

export type AgentDetail = AgentSummary & {
  body: string
  modifiedTime: number
}

export type AgentFolders = {
  project: string | null
  global: string
}

export type AgentIconChange =
  { type: 'keep' } | { type: 'remove' } | { type: 'token'; token: string }

export type AgentDraft = {
  scope: AgentScope
  name: string
  description: string
  body: string
  tools: string[] | null
  model: string | null
  icon: AgentIconChange
  // null means no role.
  role: string | null
}

export type AgentsErrorCode =
  'invalid' | 'exists' | 'conflict' | 'not_found' | 'outside_folder' | 'no_project' | 'io_error'

export type AgentsError = { code: AgentsErrorCode; message: string }

export type AgentsResult<T extends object = object> =
  ({ ok: true } & T) | { ok: false; error: AgentsError }

export type PickIconResult =
  | { ok: true; canceled: true }
  | { ok: true; canceled: false; token: string; preview: string }
  | { ok: false; error: AgentsError }

// The API the preload exposes as window.myclaud.
export type MyClaudApi = {
  project: {
    get: () => Promise<ProjectInfo | null>
    open: () => Promise<ProjectInfo | null>
  }
  agent: {
    send: (prompt: string) => Promise<AgentSendResult>
    stop: () => Promise<void>
    answerPermission: (
      permissionId: string,
      decision: PermissionDecision
    ) => Promise<{ ok: boolean }>
    onEvent: (callback: (event: AgentEvent) => void) => () => void
  }
  agents: {
    list: () => Promise<AgentsResult<{ agents: AgentSummary[]; folders: AgentFolders }>>
    read: (filePath: string) => Promise<AgentsResult<{ agent: AgentDetail }>>
    create: (draft: AgentDraft) => Promise<AgentsResult<{ filePath: string }>>
    update: (
      filePath: string,
      draft: AgentDraft,
      modifiedTime: number
    ) => Promise<AgentsResult<{ filePath: string }>>
    remove: (filePath: string) => Promise<AgentsResult>
    pickIcon: () => Promise<PickIconResult>
    // Drops a picked icon that will not be saved.
    discardIcon: (token: string) => Promise<void>
  }
}
