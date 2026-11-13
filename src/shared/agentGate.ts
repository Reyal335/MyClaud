// Which agents Claude may run, as one set of rules for the main process (the
// PreToolUse hook on the Agent tool, and agent:send's call check) and the
// renderer (the party panel's CANNOT BE CALLED look).

export type GateAgent = {
  name: string
  scope: 'project' | 'global'
  filePath: string
  problem: string | null
  // The file's permissionMode field as written, or null when it has none.
  permissionMode: string | null
  // True when the file sets background: true.
  background: boolean
}

export type GateBlock = {
  // The full message: the reason a task ends as ERROR, or agent:send refuses.
  message: string
  // The party panel's short reason.
  short: string
}

// Modes that would let an agent act without asking.
const UNSAFE_MODES = ['acceptEdits', 'auto', 'bypassPermissions']

// The agent Claude Code runs under `name`: a project agent wins over a global one,
// and a file that loads wins over one with a problem.
export function winningAgent<T extends GateAgent>(agents: T[], name: string): T | null {
  const named = agents.filter((agent) => agent.name === name)
  const rank = (agent: T): number =>
    (agent.problem === null ? 0 : 2) + (agent.scope === 'project' ? 0 : 1)
  return named.sort((a, b) => rank(a) - rank(b))[0] ?? null
}

// Why the agent's own file keeps it from running, or null when it can run.
export function fileBlock(agent: GateAgent): GateBlock | null {
  if (agent.problem !== null) {
    return {
      message: `The agent ${agent.name} cannot run. Its file has a problem: ${agent.problem}`,
      short: 'File has a problem'
    }
  }
  if (agent.permissionMode !== null && UNSAFE_MODES.includes(agent.permissionMode)) {
    return {
      message: `The agent ${agent.name} sets its own permission mode (${agent.permissionMode}). Mya keeps approvals on, so it does not run this agent.`,
      short: 'Sets its own permission mode'
    }
  }
  if (agent.background) {
    return {
      message: `The agent ${agent.name} is set to run in the background. Mya runs agents in the foreground.`,
      short: 'Runs in the background'
    }
  }
  return null
}

// Why this file cannot be called, or null when it can: it must be the one that
// wins under its name, and its file must allow it.
export function callBlock<T extends GateAgent>(agent: T, agents: T[]): GateBlock | null {
  const winner = winningAgent(agents, agent.name)
  if (winner && winner.filePath !== agent.filePath && winner.problem === null) {
    return {
      message: `Another agent named ${agent.name} takes its place: the project agent wins over the global one.`,
      short: 'Hidden by a project agent'
    }
  }
  return fileBlock(agent)
}

// The hook's answer for an Agent call naming `name`. A name with no file is a
// built-in agent such as general-purpose, which may run.
export function hookBlock(agents: GateAgent[], name: string): GateBlock | null {
  const winner = winningAgent(agents, name)
  return winner ? fileBlock(winner) : null
}
