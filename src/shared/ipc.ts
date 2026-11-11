// Shared IPC contract between main, preload, and renderer.
// Our own small types only: never raw Agent SDK messages.

import type { MascotStateName } from './mascotRules'

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
  AgentsDiscardIcon: 'agents:discard-icon',
  MascotsList: 'mascots:list',
  MascotsGetActive: 'mascots:get-active',
  MascotsPickSheet: 'mascots:pick-sheet',
  MascotsDiscardSheet: 'mascots:discard-sheet',
  MascotsSliceSheet: 'mascots:slice-sheet',
  MascotsDropSources: 'mascots:drop-sources',
  MascotsCreate: 'mascots:create',
  MascotsUpdate: 'mascots:update',
  MascotsRemove: 'mascots:remove',
  MascotsResetDefault: 'mascots:reset-default',
  MascotsSetActive: 'mascots:set-active',
  // Main to every window: the active mascot or its sheets changed.
  MascotsChanged: 'mascots:changed'
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

// Mascots: the built-in default (id "default", bundled with the renderer) and
// uploaded ones in userData/mascots/<uuid>/.

// One spritesheet: a horizontal strip of 64x64 frames, played at `fps`. `src`
// is a data URL. The frame count always comes from the image width.
export type MascotLoop = {
  src: string
  frames: number
  fps: number
}

export type MascotLoops = { idle: MascotLoop } & Partial<
  Record<Exclude<MascotStateName, 'idle'>, MascotLoop>
>

export type MascotSummary =
  | { id: string; name: string; loops: MascotLoops; problem: null }
  // Can be deleted, not edited or set active. `name` is the folder id when
  // the manifest has no usable name.
  | { id: string; name: string; loops: Partial<MascotLoops>; problem: string }

// The user's changes to the built-in default, kept in userData/mascots/default/
// and laid over the bundled mascot. The bundled files are never changed.
export type DefaultMascotEdits = {
  // True when the folder exists, even if it is broken.
  edited: boolean
  // null means the built-in name.
  name: string | null
  // Uploaded loops only. idle falls back to the bundled sheet, other states to idle.
  loops: Partial<MascotLoops>
  // Set when the folder is broken. The bundled mascot is then used as it is.
  problem: string | null
}

// The mascot to show. For the default, `name` may be null and `loops` may lack
// idle: the renderer fills both in from the bundled mascot.
export type ActiveMascotData = {
  id: string
  name: string | null
  loops: Partial<MascotLoops>
}

export type MascotSheetChange =
  { type: 'keep' } | { type: 'remove' } | { type: 'token'; token: string }

export type MascotDraft = {
  name: string
  // Every state, in any order. `keep` on a state without a sheet leaves it empty.
  // For the default, an empty idle means the bundled idle sheet.
  states: Record<MascotStateName, { fps: number; sheet: MascotSheetChange }>
}

export type MascotsErrorCode = 'invalid' | 'invalid_slice' | 'not_found' | 'no_idle' | 'io_error'

export type MascotsError = { code: MascotsErrorCode; message: string }

export type MascotsResult<T extends object = object> =
  ({ ok: true } & T) | { ok: false; error: MascotsError }

// A picked file that is already a legal strip, waiting behind `token` until SAVE.
export type PickedStrip = {
  kind: 'strip'
  token: string
  preview: string
  frames: number
  width: number
  fileName: string
}

// A picked file in any other layout. It waits behind `sourceToken` until the
// dialog closes, so it can be sliced for several states. `bytes` is the file,
// for the window to show from a blob: URL: a data: URL of a sheet over about
// 1.5 MB is longer than Chromium allows, and the image would not load.
export type PickedSource = {
  kind: 'needs_slice'
  sourceToken: string
  fileName: string
  width: number
  height: number
  bytes: Uint8Array
}

export type PickSheetResult =
  | { ok: true; canceled: true }
  | ({ ok: true; canceled: false } & (PickedStrip | PickedSource))
  | { ok: false; error: MascotsError }

// A slice is a new strip, waiting behind `token` like a picked one.
export type SliceSheetResult =
  { ok: true; token: string; frames: number; preview: string } | { ok: false; error: MascotsError }

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
  mascots: {
    // Uploaded mascots, plus the user's edits to the built-in default. `activeId`
    // is "default" when the chosen mascot is missing or has a problem.
    list: () => Promise<
      MascotsResult<{
        mascots: MascotSummary[]
        defaultMascot: DefaultMascotEdits
        activeId: string
      }>
    >
    getActive: () => Promise<MascotsResult<{ mascot: ActiveMascotData }>>
    pickSheet: () => Promise<PickSheetResult>
    // Drops a picked sheet that will not be saved.
    discardSheet: (token: string) => Promise<void>
    // Cuts picked cells (reading-order indexes, in play order) out of a source
    // into a strip of 64x64 frames.
    sliceSheet: (
      sourceToken: string,
      columns: number,
      rows: number,
      cells: number[]
    ) => Promise<SliceSheetResult>
    // Drops every loaded source sheet. Called when the dialog closes.
    dropSources: () => Promise<void>
    create: (draft: MascotDraft) => Promise<MascotsResult<{ id: string }>>
    // id "default" edits the built-in mascot's name and loops.
    update: (id: string, draft: MascotDraft) => Promise<MascotsResult<{ id: string }>>
    remove: (id: string) => Promise<MascotsResult>
    // Moves the default's edits to the trash, back to the bundled mascot.
    resetDefault: () => Promise<MascotsResult>
    setActive: (id: string) => Promise<MascotsResult>
    onChanged: (callback: () => void) => () => void
  }
}
