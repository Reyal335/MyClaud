// Loading the Claude Agent SDK and the environment it runs in. The SDK stays in the
// main process: the renderer and preloads never import it.
import { app } from 'electron'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import type { Options } from '@anthropic-ai/claude-agent-sdk'

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

// A packaged app keeps its files in app.asar, an archive that a program cannot be run
// from. The SDK finds Claude Code's own binary by its path inside the node_modules it
// ships in, so in a package that path points into the archive and the launch fails.
// electron-builder also copies native binaries, unchanged, to app.asar.unpacked beside it:
// the SDK is pointed there. Not packaged, nothing is passed and the SDK finds it itself.
let unpackedBinary: string | null | undefined

function findUnpackedBinary(): string | null {
  const scope = join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai')
  const file = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const platform = `claude-agent-sdk-${process.platform}-${process.arch}`
  let names: string[]
  try {
    names = readdirSync(scope)
  } catch {
    return null
  }
  // This platform's package. The shortest name is the plain one (Linux also has a musl
  // package, named with a longer suffix).
  const matches = names
    .filter((name) => name === platform || name.startsWith(`${platform}-`))
    .sort((a, b) => a.length - b.length)
  for (const name of matches) {
    const path = join(scope, name, file)
    if (existsSync(path)) return path
  }
  return null
}

// Spread into the options of every `query()`. Empty when not packaged, or when no
// unpacked binary is found (the SDK's own lookup then runs, as before).
export function claudeExecutable(): Pick<Options, 'pathToClaudeCodeExecutable'> {
  if (!app.isPackaged) return {}
  unpackedBinary ??= findUnpackedBinary()
  if (unpackedBinary === null) {
    console.error('[sdk] No unpacked Claude Code binary was found in app.asar.unpacked.')
    return {}
  }
  return { pathToClaudeCodeExecutable: unpackedBinary }
}
