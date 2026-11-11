// Shared IPC contract between main, preload, and renderer.
// Our own small types only: never raw Agent SDK messages.

export const IpcChannel = {
  ProjectGet: 'project:get',
  ProjectOpen: 'project:open',
  AgentSend: 'agent:send',
  AgentStop: 'agent:stop',
  AgentEvent: 'agent:event'
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

// Main to renderer, on IpcChannel.AgentEvent. Every event carries the requestId.
// Step 3 adds tool and permission events to this union.
export type AgentEvent =
  | { requestId: string; type: 'text'; text: string }
  | { requestId: string; type: 'done' }
  | { requestId: string; type: 'stopped' }
  | { requestId: string; type: 'error'; code: AgentErrorCode; message: string }

// The API the preload exposes as window.myclaud.
export type MyClaudApi = {
  project: {
    get: () => Promise<ProjectInfo | null>
    open: () => Promise<ProjectInfo | null>
  }
  agent: {
    send: (prompt: string) => Promise<AgentSendResult>
    stop: () => Promise<void>
    onEvent: (callback: (event: AgentEvent) => void) => () => void
  }
}
