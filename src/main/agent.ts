// The only module that uses the Claude Agent SDK. The renderer and preload never import it.
import { randomUUID } from 'crypto'
import type { WebContents } from 'electron'
import type { Options, SDKAssistantMessageError } from '@anthropic-ai/claude-agent-sdk'
import {
  IpcChannel,
  type AgentError,
  type AgentErrorCode,
  type AgentEvent,
  type AgentSendResult
} from '../shared/ipc'

// Read-only built-in tools for this step. `tools` limits what exists,
// `allowedTools` lets those run without asking.
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob']

type Run = {
  requestId: string
  cwd: string
  sender: WebContents
  abortController: AbortController
  // Set when we abort the run ourselves for a reason that is an error, not a user stop.
  failure: AgentError | null
}

let activeRun: Run | null = null

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

function emit(run: Run, event: AgentEvent): void {
  if (!run.sender.isDestroyed()) {
    run.sender.send(IpcChannel.AgentEvent, event)
  }
}

export function isRunning(): boolean {
  return activeRun !== null
}

export function clearSession(): void {
  session = null
}

export function stopRun(): void {
  activeRun?.abortController.abort()
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
    failure: null
  }
  activeRun = run
  void execute(run, prompt)
  return { ok: true, requestId: run.requestId }
}

async function execute(run: Run, prompt: string): Promise<void> {
  // An `error` on an assistant message is held and reported when the run ends,
  // so each run ends with exactly one terminal event.
  let assistantError: AgentError | null = null
  let outcome: AgentError | 'done' | null = null
  let forwardedText = false

  try {
    const { query } = await loadSdk()

    const options: Options = {
      cwd: run.cwd,
      includePartialMessages: true,
      tools: READ_ONLY_TOOLS,
      allowedTools: READ_ONLY_TOOLS,
      permissionMode: 'dontAsk',
      // Ignore MCP servers from user and project config, so no tools beyond the
      // read-only built-ins are available in this step.
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
          const { event } = message
          if (event.type === 'message_start' && forwardedText) {
            // Keep text before and after a tool call from running together.
            emit(run, { requestId: run.requestId, type: 'text', text: '\n\n' })
          } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            forwardedText = true
            emit(run, { requestId: run.requestId, type: 'text', text: event.delta.text })
          }
          break
        }

        case 'assistant':
          // The text deltas already covered this message's text. Only check for errors.
          if (message.error) {
            assistantError ??= fromAssistantError(message.error)
          }
          break

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
