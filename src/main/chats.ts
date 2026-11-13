import { app } from 'electron'
import { join } from 'path'
import type { ModelChoice } from '../shared/models'
import { isValidFade, type ThemeChoice } from '../shared/themes'
import { isObject, readJsonFile, serialQueue, writeJsonFile } from './jsonFile'

// The main conversation of each project, kept in userData/chats.json as
// { version: 1, chats: { <project path>: { sessionId?, model?, effort?, themeId?, fade? } } }:
// its Claude Code session id, the model and thinking level chosen for it, and its
// own chat theme if it has one. The session files themselves stay where Claude
// Code keeps them. A chat saved before the model picker has neither choice, and
// reads as AUTO and AUTO. One saved before themes has no theme of its own, so it
// uses the default theme.

const VERSION = 1

type Chat = { sessionId: string | null; choice: ModelChoice | null; theme: ThemeChoice | null }
type Chats = Record<string, Chat>

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
        if (!isObject(entry)) continue
        const sessionId =
          typeof entry.sessionId === 'string' && entry.sessionId !== '' ? entry.sessionId : null
        const choice =
          typeof entry.model === 'string' && typeof entry.effort === 'string'
            ? { model: entry.model, effort: entry.effort }
            : null
        const theme =
          typeof entry.themeId === 'string' && isValidFade(entry.fade)
            ? { themeId: entry.themeId, fade: entry.fade }
            : null
        if (sessionId !== null || choice !== null || theme !== null) {
          chats[path] = { sessionId, choice, theme }
        }
      }
    }
  } catch (err) {
    console.error('[chats] Could not read chats.json:', err)
  }
  cache = chats
  return chats
}

async function save(chats: Chats): Promise<void> {
  const out: Record<
    string,
    { sessionId?: string; model?: string; effort?: string; themeId?: string; fade?: number }
  > = {}
  for (const [path, chat] of Object.entries(chats)) {
    out[path] = {
      ...(chat.sessionId !== null ? { sessionId: chat.sessionId } : {}),
      ...(chat.choice ? { model: chat.choice.model, effort: chat.choice.effort } : {}),
      ...(chat.theme ? { themeId: chat.theme.themeId, fade: chat.theme.fade } : {})
    }
  }
  try {
    await writeJsonFile(chatsPath(), { version: VERSION, chats: out })
  } catch (err) {
    // The conversation still works for this app session; it just won't come back.
    console.error('[chats] Could not save chats.json:', err)
  }
}

// Changes one chat and saves. An entry with nothing left in it is forgotten.
function update(projectPath: string, change: (chat: Chat) => Chat): Promise<void> {
  return queue(async () => {
    const chats = await load()
    const before = chats[projectPath] ?? { sessionId: null, choice: null, theme: null }
    const after = change(before)
    if (
      after.sessionId === before.sessionId &&
      after.choice === before.choice &&
      after.theme === before.theme
    ) {
      return
    }
    if (after.sessionId === null && after.choice === null && after.theme === null) {
      delete chats[projectPath]
    } else {
      chats[projectPath] = after
    }
    await save(chats)
  })
}

export function getChatSession(projectPath: string): Promise<string | null> {
  return queue(async () => (await load())[projectPath]?.sessionId ?? null)
}

// Saves the project's session id, or forgets it with null (NEW CHAT). The model
// choice stays: the caller sets it for the new chat.
export function setChatSession(projectPath: string, sessionId: string | null): Promise<void> {
  return update(projectPath, (chat) =>
    chat.sessionId === sessionId ? chat : { ...chat, sessionId }
  )
}

// The chat's saved model and thinking choice, or null when it has none yet (a new
// chat, or one saved before the picker).
export function getChatChoice(projectPath: string): Promise<ModelChoice | null> {
  return queue(async () => (await load())[projectPath]?.choice ?? null)
}

export function setChatChoice(projectPath: string, choice: ModelChoice): Promise<void> {
  return update(projectPath, (chat) =>
    chat.choice?.model === choice.model && chat.choice.effort === choice.effort
      ? chat
      : { ...chat, choice }
  )
}

// The chat's own theme, or null when it uses the default theme.
export function getChatTheme(projectPath: string): Promise<ThemeChoice | null> {
  return queue(async () => (await load())[projectPath]?.theme ?? null)
}

// Saves the chat's own theme, or clears it with null: NEW CHAT, and ALL CHATS.
export function setChatTheme(projectPath: string, theme: ThemeChoice | null): Promise<void> {
  return update(projectPath, (chat) =>
    chat.theme?.themeId === theme?.themeId && chat.theme?.fade === theme?.fade
      ? chat
      : { ...chat, theme }
  )
}

// A theme was deleted: every chat that held it goes back to the default theme.
export function dropThemeFromChats(themeId: string): Promise<void> {
  return queue(async () => {
    const chats = await load()
    let changed = false
    for (const [path, chat] of Object.entries(chats)) {
      if (chat.theme?.themeId !== themeId) continue
      changed = true
      if (chat.sessionId === null && chat.choice === null) delete chats[path]
      else chats[path] = { ...chat, theme: null }
    }
    if (changed) await save(chats)
  })
}
