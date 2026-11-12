// The only module that uses the Claude Agent SDK. The renderer and preload never import it.
import { randomUUID } from 'crypto'
import type { WebContents } from 'electron'
import type {
  CanUseTool,
  HookCallback,
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
  type AgentSummary,
  type ChatHistory,
  type PermissionDecision,
  type TaskAgent,
  type TaskEndStatus,
  type ToolInput
} from '../shared/ipc'
import { callBlock, hookBlock, winningAgent } from '../shared/agentGate'
import { withCall } from '../shared/callAgent'
import { labelText, toolLabel } from '../shared/toolLabel'
import { listAgents } from './agents'
import { getChatSession, setChatSession } from './chats'
import { historyItems, type RecordedMessage, type SavedTask } from './history'
import { DENY_MESSAGE, forIpc, isAgentTool } from './ipcInput'
import {
  endTask,
  savedTasks,
  startTask,
  taskActivity,
  taskRequestClosed,
  taskRequestOpened
} from './tasks'

// Reading never asks. Editing, writing, and shell commands wait for the user's
// Approve or Deny through canUseTool. `tools` limits which built-ins exist at all.
// Agent lets Claude bring in my agents. It is not in allowedTools, and the agent
// gate below decides which ones may run.
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob']
const TOOLS = [...READ_ONLY_TOOLS, 'Edit', 'Write', 'Bash', 'Agent']

const NOT_FOUND_NOTICE =
  'The saved conversation was not found. This reply starts from a fresh context.'
const BACKGROUND_REPORT = 'This agent went to the background, which MyClaud does not support yet.'
const HISTORY_LIMIT = 200

type Run = {
  requestId: string
  cwd: string
  sender: WebContents
  abortController: AbortController
  // Set when we abort the run ourselves for a reason that is an error, not a user stop.
  failure: AgentError | null
  // Tool calls the user denied, so their results end as 'denied' rather than 'failed'.
  deniedToolIds: Set<string>
  // The agent list at the start of the run, for the gate and for task looks.
  agents: AgentSummary[]
  sessionId: string | null
  // Tasks of this run that have not ended: agent name by Agent tool call id.
  openTasks: Map<string, string>
  // Tool calls made inside a task, and agent ids, to their task.
  toolTask: Map<string, string>
  agentTask: Map<string, string>
  // The text of Claude's latest reply in the main conversation, for the finished popup.
  reply: string
}

type PendingPermission = {
  run: Run
  toolId: string
  taskId: string | null
  input: Record<string, unknown>
  resolve: (result: PermissionResult) => void
}

let activeRun: Run | null = null

// What the popup needs to know about runs. Our own small shapes, never SDK messages.
export type RunWatcher = {
  requestOpened: (request: {
    permissionId: string
    runId: string
    name: string
    input: ToolInput
    truncated: boolean
    // The agent asking, or null when Claude itself asks.
    agent: TaskAgent | null
    cwd: string
  }) => void
  requestClosed: (permissionId: string) => void
  taskEnded: (task: {
    runId: string
    taskId: string
    status: TaskEndStatus
    report: string
    agent: TaskAgent
  }) => void
  runEnded: (run: {
    runId: string
    outcome: 'done' | 'stopped' | AgentError
    reply: string
  }) => void
}

let watcher: RunWatcher | null = null

export function watchRuns(next: RunWatcher | null): void {
  watcher = next
}

// A watcher's failure never touches the run.
function notify(call: (watcher: RunWatcher) => void): void {
  if (!watcher) return
  try {
    call(watcher)
  } catch (err) {
    console.error('[agent] A run watcher failed:', err)
  }
}

// Permission requests waiting for the user, by permissionId. More than one can wait.
const pendingPermissions = new Map<string, PendingPermission>()

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
// switch Claude Code to API billing. Agents run in the foreground, one level deep,
// at most three at once, and never as forks of the conversation.
function childEnv(): Record<string, string | undefined> {
  const env = { ...process.env }
  delete env['ANTHROPIC_API_KEY']
  delete env['ANTHROPIC_AUTH_TOKEN']
  env['CLAUDE_CODE_DISABLE_BACKGROUND_TASKS'] = '1'
  env['CLAUDE_CODE_FORK_SUBAGENT'] = '0'
  env['CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH'] = '1'
  env['CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS'] = '3'
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

// How an agent named `name` looks: from my agent files, or as a built-in agent.
function lookOf(agents: AgentSummary[], name: string): TaskAgent {
  const file = winningAgent(agents, name)
  return file
    ? { name, scope: file.scope, filePath: file.filePath, icon: file.icon, role: file.role }
    : { name, scope: null, filePath: null, icon: null, role: null }
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
  if (pending.taskId) {
    taskRequestClosed(pending.taskId, pending.toolId)
    taskActivity(pending.taskId, pending.toolId, null, 'running')
  }
  emit(pending.run, {
    requestId: pending.run.requestId,
    type: 'permission_resolved',
    permissionId,
    decision
  })
  notify((w) => w.requestClosed(permissionId))
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

export function answerPermission(permissionId: string, decision: PermissionDecision): boolean {
  return settlePermission(permissionId, decision)
}

// STOP, window close, and app quit. Abort first so the agent does not act on the
// denials, then answer every waiting request with Deny.
export function stopRun(): void {
  activeRun?.abortController.abort()
  denyAllPending()
}

function unavailable(message: string): AgentSendResult {
  return { ok: false, error: { code: 'agent_unavailable', message } }
}

function readCall(raw: unknown): { scope: string; filePath: string } | null | 'invalid' {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object') return 'invalid'
  const { scope, filePath } = raw as Record<string, unknown>
  if ((scope !== 'project' && scope !== 'global') || typeof filePath !== 'string') return 'invalid'
  return { scope, filePath }
}

export async function startRun(
  prompt: string,
  rawCall: unknown,
  cwd: string,
  sender: WebContents
): Promise<AgentSendResult> {
  if (activeRun) {
    return { ok: false, error: { code: 'busy', message: 'A run is already in progress.' } }
  }
  const call = readCall(rawCall)
  if (call === 'invalid') return unavailable('That is not an agent from the list.')

  // Claim the run before anything async, so a second send is refused as busy.
  const run: Run = {
    requestId: randomUUID(),
    cwd,
    sender,
    abortController: new AbortController(),
    failure: null,
    deniedToolIds: new Set(),
    agents: [],
    sessionId: null,
    openTasks: new Map(),
    toolTask: new Map(),
    agentTask: new Map(),
    reply: ''
  }
  activeRun = run

  let text = prompt
  try {
    const listed = await listAgents()
    run.agents = listed.ok ? listed.agents : []
    if (call) {
      if (!listed.ok) {
        activeRun = null
        return unavailable(listed.error.message)
      }
      const agent = run.agents.find(
        (entry) => entry.filePath === call.filePath && entry.scope === call.scope
      )
      if (!agent) {
        activeRun = null
        return unavailable('This agent no longer exists.')
      }
      const block = callBlock(agent, run.agents)
      if (block) {
        activeRun = null
        return unavailable(block.message)
      }
      text = withCall(agent.name, prompt)
    }
  } catch (err) {
    activeRun = null
    return { ok: false, error: { code: 'sdk_error', message: errorMessage(err) } }
  }

  void execute(run, text)
  return { ok: true, requestId: run.requestId }
}

// The task a tool call or permission request belongs to: by its tool call id, by
// the agent's id, or the only open task. null means the main conversation.
function taskFor(run: Run, toolUseID: string, agentID: string | undefined): string | null {
  const byTool = run.toolTask.get(toolUseID)
  if (byTool) return byTool
  if (agentID) {
    const byAgent = run.agentTask.get(agentID)
    if (byAgent) return byAgent
    if (run.openTasks.size === 1) {
      const [only] = run.openTasks.keys()
      run.agentTask.set(agentID, only)
      return only
    }
  }
  return null
}

// Called by the SDK when a tool call needs the user's decision. Stays pending until
// the user answers or the run ends. Nothing is approved automatically.
function permissionHandler(run: Run): CanUseTool {
  return (toolName, input, { signal, toolUseID, agentID }) =>
    new Promise<PermissionResult>((resolve) => {
      if (signal.aborted || run.abortController.signal.aborted) {
        resolve({ behavior: 'deny', message: DENY_MESSAGE })
        return
      }

      const taskId = taskFor(run, toolUseID, agentID)
      if (taskId) {
        run.toolTask.set(toolUseID, taskId)
        if (agentID) run.agentTask.set(agentID, taskId)
      }
      const permissionId = randomUUID()
      pendingPermissions.set(permissionId, { run, toolId: toolUseID, taskId, input, resolve })
      // The SDK gave up on this call while it was still waiting: deny it and end the run.
      signal.addEventListener(
        'abort',
        () => {
          if (pendingPermissions.has(permissionId)) stopRun()
        },
        { once: true }
      )

      if (taskId) {
        const label = toolLabel(toolName, input, run.cwd)
        taskActivity(taskId, toolUseID, label, 'waiting')
        taskRequestOpened(taskId, toolUseID, labelText(label))
      }
      const shown = forIpc(input)
      emit(run, {
        requestId: run.requestId,
        type: 'permission_request',
        permissionId,
        toolId: toolUseID,
        name: toolName,
        input: shown.input,
        truncated: shown.truncated,
        taskId
      })
      const agentName = taskId ? run.openTasks.get(taskId) : undefined
      notify((w) =>
        w.requestOpened({
          permissionId,
          runId: run.requestId,
          name: toolName,
          input: shown.input,
          truncated: shown.truncated,
          agent: agentName ? lookOf(run.agents, agentName) : null,
          cwd: run.cwd
        })
      )
    })
}

// The agent gate: one PreToolUse hook on the Agent tool. It never asks me. It
// refuses agents that would run without approvals or in the background, and keeps
// every agent in the foreground.
function agentGate(run: Run): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {}
    const toolInput = (input.tool_input ?? {}) as Record<string, unknown>
    const name = typeof toolInput.subagent_type === 'string' ? toolInput.subagent_type : ''
    const block = name ? hookBlock(run.agents, name) : null
    if (block) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: block.message
        }
      }
    }
    if (toolInput.run_in_background === true) {
      // No permissionDecision: the changed call still goes through the normal checks.
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          updatedInput: { ...toolInput, run_in_background: false }
        }
      }
    }
    return {}
  }
}

type ResultBlock = { tool_use_id: string; is_error?: boolean; content?: unknown }

function resultText(block: ResultBlock): string {
  const { content } = block
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) =>
      typeof part === 'object' &&
      part !== null &&
      typeof (part as { text?: unknown }).text === 'string'
        ? (part as { text: string }).text
        : ''
    )
    .join('\n')
}

const TOOLS_USED = /^\s*<tools-used-before-summary>[\s\S]*?<\/tools-used-before-summary>\s*/

// The agent's final text. Claude Code puts it, clean, in tool_use_result.content
// after a "tools used" block.
function taskOutcome(
  block: ResultBlock,
  toolUseResult: unknown
): { status: TaskEndStatus; report: string } {
  const result = (
    typeof toolUseResult === 'object' && toolUseResult !== null ? toolUseResult : {}
  ) as Record<string, unknown>
  if (result.status === 'async_launched' || result.status === 'remote_launched') {
    return { status: 'error', report: BACKGROUND_REPORT }
  }
  if (block.is_error) return { status: 'error', report: resultText(block).trim() }
  if (result.status === 'completed' && Array.isArray(result.content)) {
    const report = result.content
      .map((part) =>
        typeof part === 'object' &&
        part !== null &&
        typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : ''
      )
      .map((text) => text.replace(TOOLS_USED, ''))
      .filter((text) => text.trim() !== '')
      .join('\n')
      .trim()
    return { status: 'done', report }
  }
  return { status: 'done', report: resultText(block).replace(TOOLS_USED, '').trim() }
}

async function endRunTask(
  run: Run,
  taskId: string,
  status: TaskEndStatus,
  report: string
): Promise<void> {
  const agentName = run.openTasks.get(taskId)
  if (agentName === undefined) return
  run.openTasks.delete(taskId)
  const shown = report.length > 20_000
  emit(run, {
    requestId: run.requestId,
    type: 'task_end',
    taskId,
    status,
    report: shown ? report.slice(0, 20_000) : report,
    truncated: shown
  })
  await endTask(taskId, status, status === 'stopped' ? null : report)
  notify((w) =>
    w.taskEnded({
      runId: run.requestId,
      taskId,
      status,
      report,
      agent: lookOf(run.agents, agentName)
    })
  )
}

// The saved session to resume, or null. A saved id whose session is gone is
// forgotten, with a notice in the conversation.
async function sessionToResume(sdk: Sdk, run: Run): Promise<string | null> {
  const saved = await getChatSession(run.cwd)
  if (!saved) return null
  const info = await sdk.getSessionInfo(saved, { dir: run.cwd }).catch(() => undefined)
  if (info) return saved
  // getSessionInfo is also undefined for a session it cannot summarize.
  const messages = await sdk.getSessionMessages(saved, { dir: run.cwd, limit: 1 }).catch(() => [])
  if (messages.length > 0) return saved
  await setChatSession(run.cwd, null)
  emit(run, { requestId: run.requestId, type: 'notice', text: NOT_FOUND_NOTICE })
  return null
}

async function execute(run: Run, prompt: string): Promise<void> {
  // An `error` on an assistant message is held and reported when the run ends,
  // so each run ends with exactly one terminal event.
  let assistantError: AgentError | null = null
  let outcome: AgentError | 'done' | null = null
  let resumed: string | null = null

  try {
    const sdk = await loadSdk()
    resumed = await sessionToResume(sdk, run)

    const options: Options = {
      cwd: run.cwd,
      includePartialMessages: true,
      tools: TOOLS,
      allowedTools: READ_ONLY_TOOLS,
      permissionMode: 'default',
      canUseTool: permissionHandler(run),
      hooks: { PreToolUse: [{ matcher: 'Agent|Task', hooks: [agentGate(run)] }] },
      // Ignore MCP servers from user and project config, so no tools beyond the
      // built-ins above are available.
      strictMcpConfig: true,
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      settingSources: ['user', 'project', 'local'],
      abortController: run.abortController,
      env: childEnv(),
      ...(resumed ? { resume: resumed } : {})
    }

    for await (const message of sdk.query({ prompt, options })) {
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
            run.sessionId = message.session_id
            if (resumed && message.session_id !== resumed) {
              emit(run, { requestId: run.requestId, type: 'notice', text: NOT_FOUND_NOTICE })
            }
            await setChatSession(run.cwd, message.session_id)
          }
          break

        case 'stream_event': {
          // Only the main conversation. Agents' messages come whole, below.
          if (message.parent_tool_use_id !== null) break
          const { event } = message
          if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
            // An agent call becomes a task once its input is known.
            if (isAgentTool(event.content_block.name)) break
            emit(run, {
              requestId: run.requestId,
              type: 'tool_start',
              toolId: event.content_block.id,
              name: event.content_block.name,
              taskId: null
            })
          } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            // While an agent works, the main conversation waits for its result, so
            // no text here can be Claude's reply. Never mix an agent's text into it.
            if (run.openTasks.size > 0) break
            emit(run, { requestId: run.requestId, type: 'text', text: event.delta.text })
          }
          break
        }

        case 'assistant': {
          if (message.error) {
            assistantError ??= fromAssistantError(message.error)
          }
          const parent = message.parent_tool_use_id
          if (parent !== null) {
            // Inside an agent: its tool calls are the task's activity. Its text is not shown.
            const taskId = run.openTasks.has(parent) ? parent : null
            if (!taskId) break
            for (const block of message.message.content) {
              if (block.type !== 'tool_use') continue
              run.toolTask.set(block.id, taskId)
              const input = block.input as Record<string, unknown>
              const shown = forIpc(input)
              emit(run, {
                requestId: run.requestId,
                type: 'tool_start',
                toolId: block.id,
                name: block.name,
                taskId
              })
              emit(run, {
                requestId: run.requestId,
                type: 'tool_input',
                toolId: block.id,
                input: shown.input,
                truncated: shown.truncated,
                taskId
              })
              taskActivity(taskId, block.id, toolLabel(block.name, input, run.cwd), 'running')
            }
            break
          }
          // The text deltas already covered this message's text. The complete
          // message carries each tool call's full input. Text followed by a tool
          // call is not the final reply.
          const said = message.message.content
            .map((block) => (block.type === 'text' ? block.text : ''))
            .join('')
          if (said.trim() !== '') run.reply = said
          if (message.message.content.some((block) => block.type === 'tool_use')) run.reply = ''
          for (const block of message.message.content) {
            if (block.type !== 'tool_use') continue
            const input = block.input as Record<string, unknown>
            if (isAgentTool(block.name)) {
              const name =
                typeof input.subagent_type === 'string' && input.subagent_type !== ''
                  ? input.subagent_type
                  : 'general-purpose'
              const description = typeof input.description === 'string' ? input.description : ''
              const agent = lookOf(run.agents, name)
              run.openTasks.set(block.id, name)
              emit(run, {
                requestId: run.requestId,
                type: 'task_start',
                taskId: block.id,
                agent,
                description
              })
              await startTask({
                id: block.id,
                projectPath: run.cwd,
                sessionId: run.sessionId,
                agent: { name, scope: agent.scope, filePath: agent.filePath },
                description,
                prompt: typeof input.prompt === 'string' ? input.prompt : ''
              })
              continue
            }
            const shown = forIpc(input)
            emit(run, {
              requestId: run.requestId,
              type: 'tool_input',
              toolId: block.id,
              input: shown.input,
              truncated: shown.truncated,
              taskId: null
            })
          }
          break
        }

        case 'user': {
          // Tool outcomes come back as tool_result blocks in a user message.
          if ('isReplay' in message && message.isReplay) break
          const { content } = message.message
          if (typeof content === 'string') break
          const parent = message.parent_tool_use_id
          for (const block of content) {
            if (block.type !== 'tool_result') continue
            if (parent === null && run.openTasks.has(block.tool_use_id)) {
              const result = taskOutcome(
                block,
                (message as { tool_use_result?: unknown }).tool_use_result
              )
              await endRunTask(run, block.tool_use_id, result.status, result.report)
              continue
            }
            const taskId = parent !== null && run.openTasks.has(parent) ? parent : null
            if (parent !== null && !taskId) continue
            const state = run.deniedToolIds.has(block.tool_use_id)
              ? 'denied'
              : block.is_error
                ? 'failed'
                : 'done'
            emit(run, {
              requestId: run.requestId,
              type: 'tool_end',
              toolId: block.tool_use_id,
              state,
              taskId
            })
            if (taskId) taskActivity(taskId, block.tool_use_id, null, state)
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
    for (const taskId of [...run.openTasks.keys()]) {
      await endRunTask(run, taskId, 'stopped', '').catch((err: unknown) =>
        console.error('[agent] Could not stop a task:', err)
      )
    }
    // A resumed session that Claude Code could not find: start fresh next time.
    if (resumed && outcome !== 'done' && outcome?.message.includes('No conversation found')) {
      await setChatSession(run.cwd, null).catch(() => {})
    }
    if (activeRun === run) {
      activeRun = null
    }

    let ended: 'done' | 'stopped' | AgentError
    if (run.failure) {
      ended = run.failure
    } else if (run.abortController.signal.aborted) {
      ended = 'stopped'
    } else if (outcome === 'done') {
      ended = 'done'
    } else {
      ended = outcome ??
        assistantError ?? { code: 'sdk_error', message: 'The agent ended without a result.' }
    }
    if (ended === 'done' || ended === 'stopped') {
      emit(run, { requestId: run.requestId, type: ended })
    } else {
      emit(run, { requestId: run.requestId, type: 'error', ...ended })
    }
    notify((w) => w.runEnded({ runId: run.requestId, outcome: ended, reply: run.reply }))
  }
}

// --- The main conversation's saved history ---------------------------------

// NEW CHAT: forget the project's session id. The session file stays where it is.
export async function resetChat(
  cwd: string
): Promise<{ ok: true } | { ok: false; error: AgentError }> {
  if (activeRun) {
    return { ok: false, error: { code: 'busy', message: 'A run is already in progress.' } }
  }
  await setChatSession(cwd, null)
  return { ok: true }
}

// The last 200 messages of the project's saved conversation, as items. Only the
// SDK reads the session file.
export async function loadChatHistory(cwd: string): Promise<ChatHistory> {
  const empty: ChatHistory = { items: [], truncated: false, unavailable: false }
  const saved = await getChatSession(cwd)
  if (!saved) return empty
  try {
    const sdk = await loadSdk()
    const messages = await sdk.getSessionMessages(saved, { dir: cwd })
    if (messages.length === 0) return { ...empty, unavailable: true }
    const shown = messages.slice(-HISTORY_LIMIT)
    const listed = await listAgents()
    const agents = listed.ok ? listed.agents : []
    const ids: string[] = []
    for (const message of shown) {
      const content = (message.message as { content?: unknown } | null)?.content
      if (message.type !== 'assistant' || !Array.isArray(content)) continue
      for (const block of content as { type?: string; name?: string; id?: string }[]) {
        if (block.type === 'tool_use' && block.id && isAgentTool(block.name ?? ''))
          ids.push(block.id)
      }
    }
    const found = await savedTasks(ids)
    const tasks = new Map<string, SavedTask>()
    for (const [id, task] of found) tasks.set(id, task)
    const items = historyItems(shown as RecordedMessage[], {
      tasks,
      agentFor: (name) => lookOf(agents, name)
    })
    return { items, truncated: messages.length > HISTORY_LIMIT, unavailable: false }
  } catch (err) {
    console.error('[agent] Could not load the conversation history:', errorMessage(err))
    return { ...empty, unavailable: true }
  }
}
