import type { Options, Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { createInputQueue } from './runInput'
import { childEnv, claudeExecutable, loadSdk } from './sdk'

// A query with no message in it, to ask Claude Code something it knows from starting up.
// Nothing is sent to a model, so nothing is used from the plan. It is closed at once.
//
// Only the user's own settings are read: the account does not depend on a project, and
// a project's hooks have no business running to answer it.
export async function withIdleQuery<T>(
  cwd: string,
  ask: (query: Query) => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  const input = createInputQueue<SDKUserMessage>()
  const abortController = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const sdk = await loadSdk()
    const options: Options = {
      cwd,
      tools: [],
      permissionMode: 'default',
      strictMcpConfig: true,
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      settingSources: ['user'],
      persistSession: false,
      abortController,
      env: childEnv(),
      ...claudeExecutable()
    }
    const query = sdk.query({ prompt: input.iterable, options })
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
      })
      return await Promise.race([ask(query), timeout])
    } finally {
      input.close()
      abortController.abort()
      query.close()
    }
  } finally {
    clearTimeout(timer)
  }
}
