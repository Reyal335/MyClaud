// Loading the Claude Agent SDK and the environment it runs in. The SDK stays in the
// main process: the renderer and preloads never import it.

// The SDK is an ES module and the main bundle is CommonJS, so it is loaded
// with a dynamic import on first use and kept external to the bundle.
export type Sdk = typeof import('@anthropic-ai/claude-agent-sdk')
let sdkPromise: Promise<Sdk> | null = null

export function loadSdk(): Promise<Sdk> {
  sdkPromise ??= import('@anthropic-ai/claude-agent-sdk').catch((err) => {
    sdkPromise = null
    throw err
  })
  return sdkPromise
}

// The app runs on the Claude Code login, never on an API key. `env` replaces the
// child environment entirely, so pass a full copy minus the variables that would
// switch Claude Code to API billing. Agents run in the foreground, one level deep,
// at most three at once, and never as forks of the conversation.
export function childEnv(): Record<string, string | undefined> {
  const env = { ...process.env }
  delete env['ANTHROPIC_API_KEY']
  delete env['ANTHROPIC_AUTH_TOKEN']
  env['CLAUDE_CODE_DISABLE_BACKGROUND_TASKS'] = '1'
  env['CLAUDE_CODE_FORK_SUBAGENT'] = '0'
  env['CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH'] = '1'
  env['CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS'] = '3'
  return env
}
