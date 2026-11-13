// Runs the conversation on the Claude Agent SDK. The renderer and preload never import it.
import { randomUUID, type UUID } from 'crypto'
import type { WebContents } from 'electron'
import type {
  CanUseTool,
  HookCallback,
  Options,
  PermissionResult,
  Query,
  SDKAssistantMessageError,
  SDKUserMessage
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
import { noteRateLimit, readAccountFromRun } from './account'
import { listAgents } from './agents'
import { getChatSession, setChatChoice, setChatSession, setChatTheme } from './chats'
import { historyItems, type RecordedMessage, type SavedTask } from './history'
import { DENY_MESSAGE, forIpc, isAgentTool } from './ipcInput'
import { getActiveVoice } from './mascots'
import { choiceForRun } from './modelChoice'
import { childEnv, claudeExecutable, loadSdk, type Sdk } from './sdk'
import { getDefaultChoice } from './settings'
import { voiceAppend } from './voice'
import { AUTO, AUTO_CHOICE, isEffortLevel, type ModelChoice } from '../shared/models'
import {
  createInputQueue,
  createMessageTracker,
  pushToRun,
  settleResult,
  type InputQueue,
  type MessageTracker
} from './runInput'
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
const BACKGROUND_REPORT = 'This agent went to the background, which Mya does not support yet.'
const HISTORY_LIMIT = 200
// The most agents working at once. Claude Code's own limit is set to the same in childEnv.
const MAX_AGENTS = 3
const FULL_MESSAGE = 'Three agents are already working.'
// The window makes up each message's id. Lowercase, so the id Claude Code echoes
// back is the same string.
const MESSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

type Run = {
  requestId: string
  cwd: string
  sender: WebContents
  // The messages into Claude Code. The run ends when main closes it.
  input: InputQueue<SDKUserMessage>
  // Messages sent into this run after its first, until Claude has taken them in.
  messages: MessageTracker
  // Settles true once the run's first message is queued, or false when the run
  // could not start. A message sent while the run starts waits for this.
  ready: Promise<boolean>
  settleReady: (started: boolean) => void
  // Settles once the run is over and its last event is sent.
  done: Promise<void>
  settleDone: () => void
  // The model and thinking choice in force, as the run started with it or as the
  // picker changed it since. Replies name the level from here.
  choice: ModelChoice
  // The live query, once it exists: a pick during the run is applied through it.
  query: Query | null
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
  // Nothing more goes into a run that is being stopped: a message sent now waits
  // for the run to finish and starts a new one.
  activeRun?.input.close()
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

type CallCheck = { ok: true; name: string } | { ok: false; message: string }

// The agent I called, checked against the agent files as they are now: it must
// still exist, be the one that wins under its name, and be allowed to run.
function checkCall(
  call: { scope: string; filePath: string },
  listed: Awaited<ReturnType<typeof listAgents>>
): CallCheck {
  if (!listed.ok) return { ok: false, message: listed.error.message }
  const agent = listed.agents.find(
    (entry) => entry.filePath === call.filePath && entry.scope === call.scope
  )
  if (!agent) return { ok: false, message: 'This agent no longer exists.' }
  const block = callBlock(agent, listed.agents)
  if (block) return { ok: false, message: block.message }
  return { ok: true, name: agent.name }
}

function userMessage(text: string, id: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    uuid: id as UUID
  }
}

function newRun(cwd: string, sender: WebContents): Run {
  let settleReady: (started: boolean) => void = () => {}
  let settleDone: () => void = () => {}
  return {
    requestId: randomUUID(),
    cwd,
    sender,
    input: createInputQueue<SDKUserMessage>(),
    messages: createMessageTracker(),
    ready: new Promise<boolean>((resolve) => (settleReady = resolve)),
    settleReady: (started) => settleReady(started),
    done: new Promise<void>((resolve) => (settleDone = resolve)),
    settleDone: () => settleDone(),
    choice: AUTO_CHOICE,
    query: null,
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
}

// A run that never got going: nothing was sent to Claude Code.
function abandonRun(run: Run): void {
  run.input.close()
  if (activeRun === run) activeRun = null
  run.settleReady(false)
  run.settleDone()
}

// Send a message. While a run is going it goes into that run, and Claude Code
// reads it at its next turn: after the agent that is working, if one is. When no
// run is going it starts one. Only this module decides which.
export async function sendMessage(
  prompt: string,
  rawCall: unknown,
  rawMessageId: unknown,
  cwd: string,
  sender: WebContents
): Promise<AgentSendResult> {
  const call = readCall(rawCall)
  if (call === 'invalid') return unavailable('That is not an agent from the list.')
  if (typeof rawMessageId !== 'string' || !MESSAGE_ID.test(rawMessageId)) {
    return {
      ok: false,
      error: { code: 'invalid_prompt', message: 'The message id must be a lowercase UUID.' }
    }
  }

  for (;;) {
    const run = activeRun
    if (!run) return startRun(prompt, call, rawMessageId, cwd, sender)

    // A run is going, or is starting and its first message is not in yet.
    if (await run.ready) {
      const joined = await joinRun(run, prompt, call, rawMessageId)
      if (joined) return joined
    }
    // The run closed or failed before the message could go in. Wait for it to be
    // over, then look again: a new run takes the message.
    await run.done
  }
}

// Puts the message into a run that is going. Null when the run closed before it could.
async function joinRun(
  run: Run,
  prompt: string,
  call: { scope: string; filePath: string } | null,
  messageId: string
): Promise<AgentSendResult | null> {
  let text = prompt
  if (call) {
    if (run.openTasks.size >= MAX_AGENTS) return unavailable(FULL_MESSAGE)
    const checked = checkCall(call, await listAgents())
    if (!checked.ok) return unavailable(checked.message)
    text = withCall(checked.name, prompt)
  }

  // Nothing async from here to the push, so the run cannot close in between: the
  // message is in the run, or the run is closed and the caller starts a new one.
  if (activeRun !== run || run.input.closed) return null
  if (call && run.openTasks.size >= MAX_AGENTS) return unavailable(FULL_MESSAGE)
  if (!pushToRun(run.input, run.messages, userMessage(text, messageId), messageId)) return null
  return { ok: true, requestId: run.requestId, joined: true }
}

async function startRun(
  prompt: string,
  call: { scope: string; filePath: string } | null,
  messageId: string,
  cwd: string,
  sender: WebContents
): Promise<AgentSendResult> {
  // Claim the run before anything async: a message sent meanwhile joins this run
  // once its first message is in.
  const run = newRun(cwd, sender)
  activeRun = run

  let text = prompt
  try {
    const listed = await listAgents()
    run.agents = listed.ok ? listed.agents : []
    if (call) {
      const checked = checkCall(call, listed)
      if (!checked.ok) {
        abandonRun(run)
        return unavailable(checked.message)
      }
      text = withCall(checked.name, prompt)
    }
  } catch (err) {
    abandonRun(run)
    return { ok: false, error: { code: 'sdk_error', message: errorMessage(err) } }
  }

  run.input.push(userMessage(text, messageId))
  run.settleReady(true)
  void execute(run)
  return { ok: true, requestId: run.requestId, joined: false }
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

// Tells the window where a message sent into a running run stands.
function reportMessage(run: Run, messageId: string, state: 'received' | 'not_delivered'): void {
  emit(run, { requestId: run.requestId, type: 'message_state', messageId, state })
}

// Claude Code's `command_lifecycle` messages say what became of each message I
// pushed: queued, started (taken into a turn, or into the turn in progress),
// completed, or cancelled. The SDK's types do not list this message, so read it
// defensively: an unknown shape changes nothing, and the result's own list of
// answered messages still settles every message.
function handleLifecycle(run: Run, raw: { command_uuid?: unknown; state?: unknown }): void {
  const id = raw.command_uuid
  if (typeof id !== 'string') return
  if (raw.state === 'started') {
    if (run.messages.started(id)) reportMessage(run, id, 'received')
  } else if (raw.state === 'completed') {
    for (const late of run.messages.answered([id])) reportMessage(run, late, 'received')
  } else if (raw.state === 'cancelled') {
    if (run.messages.cancelled(id)) reportMessage(run, id, 'not_delivered')
  }
}

async function execute(run: Run): Promise<void> {
  // An `error` on an assistant message is held and reported when the run ends,
  // so each run ends with exactly one terminal event.
  let assistantError: AgentError | null = null
  let outcome: AgentError | 'done' | null = null
  let resumed: string | null = null
  // Set when a result ends the run: nothing after it is forwarded.
  let finished = false
  // The thinking block in progress in Claude's own reply, to time it.
  let thinking: { index: number; startedAt: number } | null = null

  try {
    const sdk = await loadSdk()
    resumed = await sessionToResume(sdk, run)

    // The chat's model and thinking choice. AUTO means leave the option out, so
    // Claude Code uses its own default. A saved choice that no longer fits is
    // replaced, with a line saying so once.
    const picked = await choiceForRun(run.cwd)
    run.choice = picked.choice
    for (const text of picked.notices) emit(run, { requestId: run.requestId, type: 'notice', text })
    const { model, effort } = run.choice

    // The active mascot's voice, as a system-prompt append. A broken lookup
    // never blocks or fails the run: it just runs with no voice.
    let voice: Awaited<ReturnType<typeof getActiveVoice>>
    try {
      voice = await getActiveVoice()
    } catch (err) {
      console.error('[agent] Could not read the active mascot voice:', errorMessage(err))
      voice = { name: null, voice: null }
    }
    const append = voiceAppend(voice.name, voice.voice)

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
      systemPrompt:
        append !== null
          ? { type: 'preset', preset: 'claude_code', append }
          : { type: 'preset', preset: 'claude_code' },
      settingSources: ['user', 'project', 'local'],
      abortController: run.abortController,
      env: childEnv(),
      ...claudeExecutable(),
      ...(model !== AUTO ? { model } : {}),
      ...(isEffortLevel(effort) ? { effort } : {}),
      ...(resumed ? { resume: resumed } : {})
    }

    // The run reads its messages from the input queue, so it stays open after a
    // result until main closes the queue.
    const query = sdk.query({ prompt: run.input.iterable, options })
    run.query = query
    // The account is read again whenever a run starts, from this run's own query.
    readAccountFromRun(query)
    for await (const message of query) {
      // Stopped by the user, or aborted below for an auth problem. The SDK can still
      // yield messages that were already in flight, so forward nothing more.
      if (run.abortController.signal.aborted) break

      if ((message as { type: string }).type === 'command_lifecycle') {
        handleLifecycle(run, message as unknown as { command_uuid?: unknown; state?: unknown })
        continue
      }

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
            // Every turn of the run starts with an init message: only the first
            // one tells us the session.
            if (run.sessionId === null) {
              run.sessionId = message.session_id
              if (resumed && message.session_id !== resumed) {
                emit(run, { requestId: run.requestId, type: 'notice', text: NOT_FOUND_NOTICE })
              }
              await setChatSession(run.cwd, message.session_id)
            }
          }
          break

        // The session and weekly numbers for the ACCOUNT screen. Every run, the chat's and
        // the agents', streams through this one loop. Only the numbers are kept: nothing
        // is forwarded to the window and nothing about how the run handles a limit changes.
        case 'rate_limit_event':
          noteRateLimit(message.rate_limit_info)
          break

        case 'stream_event': {
          // Only the main conversation. Agents' messages come whole, below.
          if (message.parent_tool_use_id !== null) break
          const { event } = message

          // Which model is answering, and how long it thought: the reply's tag.
          // While an agent works nothing here is Claude's reply (see below).
          if (run.openTasks.size === 0) {
            if (event.type === 'message_start') {
              emit(run, {
                requestId: run.requestId,
                type: 'reply_start',
                model: event.message.model,
                level: run.choice.effort
              })
            } else if (
              event.type === 'content_block_start' &&
              (event.content_block.type === 'thinking' ||
                event.content_block.type === 'redacted_thinking')
            ) {
              thinking = { index: event.index, startedAt: Date.now() }
            } else if (
              event.type === 'content_block_stop' &&
              thinking !== null &&
              thinking.index === event.index
            ) {
              emit(run, {
                requestId: run.requestId,
                type: 'thought',
                ms: Date.now() - thinking.startedAt
              })
              thinking = null
            }
          }

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

        case 'result': {
          if (assistantError) {
            outcome = assistantError
          } else if (message.subtype === 'success') {
            outcome = message.is_error
              ? fromResultText(message.result || 'The run ended with an error.')
              : 'done'
          } else {
            outcome = fromResultText(message.errors.join('\n') || message.subtype)
          }
          // The error belongs to this turn only.
          assistantError = null

          // One result per turn. It lists the messages of mine that the turn answered.
          // The queue closes here, or stays open for a message still waiting.
          const settled = settleResult(
            run.input,
            run.messages,
            message.user_message_uuids ?? [],
            outcome === 'done'
          )
          for (const late of settled.late) reportMessage(run, late, 'received')
          if (settled.finished) finished = true
          break
        }
      }
      if (finished) break
    }
  } catch (err) {
    if (!run.abortController.signal.aborted) {
      outcome = assistantError ?? { code: 'sdk_error', message: errorMessage(err) }
    }
  } finally {
    // Nothing more goes into this run, whatever ended it.
    run.input.close()
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
    // A message Claude never took in is reported before the run's last event, and
    // is not sent again.
    for (const lost of run.messages.undelivered()) reportMessage(run, lost, 'not_delivered')

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
    // Last: a message waiting to start a new run goes ahead only after this run's events.
    run.settleDone()
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
  // The new chat starts from the saved defaults. With "Use for new chats too" the
  // defaults are the last pick, so it starts on the same choice.
  await setChatChoice(cwd, await getDefaultChoice())
  // And with no chat theme of its own: it uses the default theme.
  await setChatTheme(cwd, null)
  return { ok: true }
}

// A pick in the model picker while a run is going. The model goes through
// setModel (no argument is AUTO) and the thinking level through applyFlagSettings
// (null is AUTO). Both take effect from the next message, the same moment a
// message pushed into the run is read. A run that has not started its query yet
// reads the choice when it does, and one that is finishing leaves it to the next run.
export async function applyChoiceToRun(next: ModelChoice): Promise<void> {
  const run = activeRun
  if (!run) return
  const previous = run.choice
  run.choice = next
  const query = run.query
  if (!query || run.input.closed) return
  try {
    if (next.model !== previous.model) {
      await query.setModel(next.model === AUTO ? undefined : next.model)
    }
    if (next.effort !== previous.effort) {
      await query.applyFlagSettings({
        effortLevel: isEffortLevel(next.effort) ? next.effort : null
      })
    }
  } catch (err) {
    console.error('[agent] Could not apply the model choice to the run:', errorMessage(err))
  }
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
