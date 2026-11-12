import { app } from 'electron'
import { join } from 'path'
import { isObject, readJsonFile, serialQueue, writeJsonFile } from './jsonFile'

// The main conversation of each project: its Claude Code session id, kept in
// userData/chats.json as { version: 1, chats: { <project path>: { sessionId } } }.
// The session files themselves stay where Claude Code keeps them.

const VERSION = 1

type Chats = Record<string, { sessionId: string }>

let cache: Chats | null = null
const queue = serialQueue()

function chatsPath(): string {
  return join(app.getPath('userData'), 'chats.json')
}

async function load(): Promise<Chats> {
  if (cache) return cache
  const chats: Chats = {}
  try {
    const raw = await readJsonFile(chatsPath())
    if (isObject(raw) && raw.version === VERSION && isObject(raw.chats)) {
      for (const [path, entry] of Object.entries(raw.chats)) {
        if (isObject(entry) && typeof entry.sessionId === 'string' && entry.sessionId !== '') {
          chats[path] = { sessionId: entry.sessionId }
        }
      }
    }
  } catch (err) {
    console.error('[chats] Could not read chats.json:', err)
  }
  cache = chats
  return chats
}

export function getChatSession(projectPath: string): Promise<string | null> {
  return queue(async () => (await load())[projectPath]?.sessionId ?? null)
}

// Saves the project's session id, or forgets it with null (NEW CHAT).
export function setChatSession(projectPath: string, sessionId: string | null): Promise<void> {
  return queue(async () => {
    const chats = await load()
    if ((chats[projectPath]?.sessionId ?? null) === sessionId) return
    if (sessionId === null) delete chats[projectPath]
    else chats[projectPath] = { sessionId }
    try {
      await writeJsonFile(chatsPath(), { version: VERSION, chats })
    } catch (err) {
      // The conversation still works for this app session; it just won't come back.
      console.error('[chats] Could not save chats.json:', err)
    }
  })
}
