// The only module that uses the Claude Agent SDK. The renderer and preload never import it.
import { randomUUID } from 'crypto'
import type { WebContents } from 'electron'
import type {
  CanUseTool,
  Options,
  PermissionResult,
  SDKAssistantMessageError
} from '@anthropic-ai/claude-agent-sdk'
import {
  IpcChannel,
  type AgentError,
  type AgentErrorCode,
  type AgentEvent,
  type AgentSendResult,
  type PermissionDecision,
  type ToolInput
} from '../shared/ipc'

// Reading never asks. Editing, writing, and shell commands wait for the user's
// Approve or Deny through canUseTool. `tools` limits which built-ins exist at all.
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob']
const TOOLS = [...READ_ONLY_TOOLS, 'Edit', 'Write', 'Bash']

const DENY_MESSAGE = 'The user denied this action.'

// Longest string field sent to the renderer in a tool input.
const MAX_IPC_STRING = 20_000

type Run = {
  requestId: string
  cwd: string
  sender: WebContents
  abortController: AbortController
  // Set when we abort the run ourselves for a reason that is an error, not a user stop.
  failure: AgentError | null
  // Tool calls the user denied, so their results end as 'denied' rather than 'failed'.
  deniedToolIds: Set<string>
}

type PendingPermission = {
  run: Run
  toolId: string
  input: Record<string, unknown>
  resolve: (result: PermissionResult) => void
}

let activeRun: Run | null = null

// Permission requests waiting for the user, by permissionId. More than one can wait.
const pendingPermissions = new Map<string, PendingPermission>()

// Session for the open project, in memory only. Cleared when the project changes.
let session: { id: string; cwd: string } | null = null

// The SDK is an ES module and the main bundle is CommonJS, so it is loaded
// with a dynamic import on first use and kept external to the bundle.
type Sdk = typeof import('@anthropic-ai/claude-agent-sdk')
let sdkPromise: Promise<Sdk> | null = null

function loadSdk(): Promise<Sdk> {
  sdkPromise ??= import('@anthropic-ai/claude-agent-sdk').catch((err) => {
    sdkPromise = null
    throw err
  })
  return sdkPromise
}

const ASSISTANT_ERROR_CODES: Partial<Record<SDKAssistantMessageError, AgentErrorCode>> = {
  // The CLI reports a missing, expired, or revoked Claude Code login this way.
  authentication_failed: 'not_signed_in',
  billing_error: 'billing',
  rate_limit: 'rate_limit',
  overloaded: 'overloaded'
}

function fromAssistantError(error: SDKAssistantMessageError): AgentError {
  return { code: ASSISTANT_ERROR_CODES[error] ?? 'sdk_error', message: error }
}

// Fallback for an error result without an assistant `error`: the CLI's login
// failures all tell the user to run /login ("Not logged in · Please run /login").
function fromResultText(text: string): AgentError {
  return { code: /\/login\b/.test(text) ? 'not_signed_in' : 'sdk_error', message: text }
}

// The app runs on the Claude Code login, never on an API key. `env` replaces the
// child environment entirely, so pass a full copy minus the variables that would
// switch Claude Code to API billing.
function childEnv(): Record<string, string | undefined> {
  const env = { ...process.env }
  delete env['ANTHROPIC_API_KEY']
  delete env['ANTHROPIC_AUTH_TOKEN']
  return env
}

// apiKeySource on the init message is 'none' for a Claude account login. Every other
// value ('ANTHROPIC_API_KEY', 'apiKeyHelper', '/login managed key') means an API key.
const ACCOUNT_LOGIN_SOURCE = 'none'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// Copy of a tool input for IPC, with any string longer than MAX_IPC_STRING cut.
function forIpc(input: Record<string, unknown>): { input: ToolInput; truncated: boolean } {
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

function emit(run: Run, event: AgentEvent): void {
  if (!run.sender.isDestroyed()) {
    run.sender.send(IpcChannel.AgentEvent, event)
  }
}

// Answers one pending request. Returns false for an unknown or already answered id.
function settlePermission(permissionId: string, decision: PermissionDecision): boolean {
  const pending = pendingPermissions.get(permissionId)
  if (!pending) return false
  pendingPermissions.delete(permissionId)

  if (decision === 'approve') {
    pending.resolve({ behavior: 'allow', updatedInput: pending.input })
  } else {
    pending.run.deniedToolIds.add(pending.toolId)
    pending.resolve({ behavior: 'deny', message: DENY_MESSAGE })
  }
  emit(pending.run, {
    requestId: pending.run.requestId,
    type: 'permission_resolved',
    permissionId,
    decision
  })
  return true
}

function denyAllPending(): void {
  for (const permissionId of [...pendingPermissions.keys()]) {
    settlePermission(permissionId, 'deny')
  }
}

export function isRunning(): boolean {
  return activeRun !== null
}

export function clearSession(): void {
  session = null
}

export function answerPermission(permissionId: string, decision: PermissionDecision): boolean {
  return settlePermission(permissionId, decision)
}

// STOP, window close, and app quit. Abort first so the agent does not act on the
// denials, then answer every waiting request with Deny.
export function stopRun(): void {
  activeRun?.abortController.abort()
  denyAllPending()
}

export function startRun(prompt: string, cwd: string, sender: WebContents): AgentSendResult {
  if (activeRun) {
    return { ok: false, error: { code: 'busy', message: 'A run is already in progress.' } }
  }
  const run: Run = {
    requestId: randomUUID(),
    cwd,
    sender,
    abortController: new AbortController(),
    failure: null,
    deniedToolIds: new Set()
  }
  activeRun = run
  void execute(run, prompt)
  return { ok: true, requestId: run.requestId }
}

// Called by the SDK when a tool call needs the user's decision. Stays pending until
// the user answers or the run ends. Nothing is approved automatically.
function permissionHandler(run: Run): CanUseTool {
  return (toolName, input, { signal, toolUseID }) =>
    new Promise<PermissionResult>((resolve) => {
      if (signal.aborted || run.abortController.signal.aborted) {
        resolve({ behavior: 'deny', message: DENY_MESSAGE })
        return
      }

      const permissionId = randomUUID()
      pendingPermissions.set(permissionId, { run, toolId: toolUseID, input, resolve })
      // The SDK gave up on this call while it was still waiting: deny it and end the run.
      signal.addEventListener(
        'abort',
        () => {
          if (pendingPermissions.has(permissionId)) stopRun()
        },
        { once: true }
      )

      const shown = forIpc(input)
      emit(run, {
        requestId: run.requestId,
        type: 'permission_request',
        permissionId,
        toolId: toolUseID,
        name: toolName,
        input: shown.input,
        truncated: shown.truncated
      })
    })
}

async function execute(run: Run, prompt: string): Promise<void> {
  // An `error` on an assistant message is held and reported when the run ends,
  // so each run ends with exactly one terminal event.
  let assistantError: AgentError | null = null
  let outcome: AgentError | 'done' | null = null

  try {
    const { query } = await loadSdk()

    const options: Options = {
      cwd: run.cwd,
      includePartialMessages: true,
      tools: TOOLS,
      allowedTools: READ_ONLY_TOOLS,
      permissionMode: 'default',
      canUseTool: permissionHandler(run),
      // Ignore MCP servers from user and project config, so no tools beyond the
      // built-ins above are available.
      strictMcpConfig: true,
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      settingSources: ['user', 'project', 'local'],
      abortController: run.abortController,
      env: childEnv(),
      ...(session && session.cwd === run.cwd ? { resume: session.id } : {})
    }

    for await (const message of query({ prompt, options })) {
      // Stopped by the user, or aborted below for an auth problem. The SDK can still
      // yield messages that were already in flight, so forward nothing more.
      if (run.abortController.signal.aborted) break

      switch (message.type) {
        case 'system':
          if (message.subtype === 'init') {
            // Not a secret: it names where the credential came from, not the credential.
            console.log(`[agent] apiKeySource: ${message.apiKeySource}`)
            if (message.apiKeySource !== ACCOUNT_LOGIN_SOURCE) {
              run.failure = {
                code: 'api_key_in_use',
                message: `apiKeySource is ${message.apiKeySource}`
              }
              run.abortController.abort()
              break
            }
            session = { id: message.session_id, cwd: run.cwd }
          }
          break

        case 'stream_event': {
          // Only the main conversation. There are no subagents yet.
          if (message.parent_tool_use_id !== null) break
          const { event } = message
          if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
            emit(run, {
              requestId: run.requestId,
              type: 'tool_start',
              toolId: event.content_block.id,
              name: event.content_block.name
            })
          } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            emit(run, { requestId: run.requestId, type: 'text', text: event.delta.text })
          }
          break
        }

        case 'assistant':
          if (message.error) {
            assistantError ??= fromAssistantError(message.error)
          }
          if (message.parent_tool_use_id !== null) break
          // The text deltas already covered this message's text. The complete
          // message carries each tool call's full input.
          for (const block of message.message.content) {
            if (block.type === 'tool_use') {
              const shown = forIpc(block.input as Record<string, unknown>)
              emit(run, {
                requestId: run.requestId,
                type: 'tool_input',
                toolId: block.id,
                input: shown.input,
                truncated: shown.truncated
              })
            }
          }
          break

        case 'user': {
          // Tool outcomes come back as tool_result blocks in a user message.
          if ('isReplay' in message && message.isReplay) break
          if (message.parent_tool_use_id !== null) break
          const { content } = message.message
          if (typeof content === 'string') break
          for (const block of content) {
            if (block.type !== 'tool_result') continue
            const state = run.deniedToolIds.has(block.tool_use_id)
              ? 'denied'
              : block.is_error
                ? 'failed'
                : 'done'
            emit(run, {
              requestId: run.requestId,
              type: 'tool_end',
              toolId: block.tool_use_id,
              state
            })
          }
          break
        }

        case 'result':
          if (assistantError) {
            outcome = assistantError
          } else if (message.subtype === 'success') {
            outcome = message.is_error
              ? fromResultText(message.result || 'The run ended with an error.')
              : 'done'
          } else {
            outcome = fromResultText(message.errors.join('\n') || message.subtype)
          }
          break
      }
    }
  } catch (err) {
    if (!run.abortController.signal.aborted) {
      outcome = assistantError ?? { code: 'sdk_error', message: errorMessage(err) }
    }
  } finally {
    // Nothing may stay waiting after its run ends.
    denyAllPending()
    if (activeRun === run) {
      activeRun = null
    }

    if (run.failure) {
      emit(run, { requestId: run.requestId, type: 'error', ...run.failure })
    } else if (run.abortController.signal.aborted) {
      emit(run, { requestId: run.requestId, type: 'stopped' })
    } else if (outcome === 'done') {
      emit(run, { requestId: run.requestId, type: 'done' })
    } else {
      const error = outcome ??
        assistantError ?? { code: 'sdk_error', message: 'The agent ended without a result.' }
      emit(run, { requestId: run.requestId, type: 'error', ...error })
    }
  }
}
