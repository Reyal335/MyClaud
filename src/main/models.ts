import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { modelLists, type ModelLists } from '../shared/models'
import { createInputQueue } from './runInput'
import { childEnv, claudeExecutable, loadSdk } from './sdk'

// The models the logged-in account can use, from the SDK's supportedModels(). It
// belongs to a query, so a query is opened with no message in it: Claude Code
// answers from its start-up information, nothing is sent to a model, and nothing
// is used from the plan. The query is closed at once.
//
// The list is fetched once per project folder and kept: the folder's own settings
// can narrow it. A failed fetch is not kept, so the next ask tries again.

const FETCH_TIMEOUT_MS = 30_000

export type ModelsLoad = { ok: true; lists: ModelLists } | { ok: false; message: string }

const cache = new Map<string, Promise<ModelsLoad>>()

async function fetchModels(cwd: string): Promise<ModelsLoad> {
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
      settingSources: ['user', 'project', 'local'],
      persistSession: false,
      abortController,
      env: childEnv(),
      ...claudeExecutable()
    }
    const query = sdk.query({ prompt: input.iterable, options })
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('The model list took too long to load.')),
          FETCH_TIMEOUT_MS
        )
      })
      const infos = await Promise.race([query.supportedModels(), timeout])
      return { ok: true, lists: modelLists(infos) }
    } finally {
      input.close()
      abortController.abort()
      query.close()
    }
  } catch (err) {
    console.error(
      '[models] Could not load the model list:',
      err instanceof Error ? err.message : err
    )
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}

export function getModels(cwd: string): Promise<ModelsLoad> {
  let load = cache.get(cwd)
  if (!load) {
    load = fetchModels(cwd)
    cache.set(cwd, load)
    void load.then((result) => {
      if (!result.ok && cache.get(cwd) === load) cache.delete(cwd)
    })
  }
  return load
}

// Starts the fetch for the open project at startup, so the list is ready by the
// time the picker opens.
export function prefetchModels(cwd: string | null): void {
  if (cwd) void getModels(cwd)
}
