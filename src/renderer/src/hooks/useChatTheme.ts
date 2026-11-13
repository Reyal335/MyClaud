import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AddThemeResult, ThemeChoiceChange, ThemeChoices } from '../../../shared/ipc'
import type { ThemeChoice, ThemeInfo } from '../../../shared/themes'
import { entryFor, themeEntries, type ThemeEntry } from '../themes/themeEntries'

export type ChatTheme = {
  // None, Tokyo Night, and the uploads, oldest first.
  entries: ThemeEntry[]
  // The choice in force: this chat's own, or the default. null until loaded, so
  // the frame stays plain instead of flashing the wrong theme.
  active: ThemeChoice | null
  // The theme drawn now.
  entry: ThemeEntry
  // This chat has a choice of its own, not just the default.
  ownChoice: boolean
  // Loads the themes and the choice again.
  reload: () => void
  // APPLY. Returns a message to show when it failed, else null.
  apply: (change: ThemeChoiceChange) => Promise<string | null>
  // ADD THEME: the result as main gave it, with the new theme already in `entries`.
  add: () => Promise<AddThemeResult>
  rename: (id: string, name: string) => Promise<string | null>
  // Returns the choice in force after the delete, or a message.
  remove: (id: string) => Promise<{ error: string | null; active: ThemeChoice | null }>
}

const FAILED = 'The themes could not be loaded.'

// The chat theme: the themes, and which one this chat shows. Main keeps both; this
// only shows them and asks for changes. Uploads, renames, and deletes take effect
// when made, so the list here is always the saved one.
export function useChatTheme(projectPath: string): ChatTheme {
  const [uploaded, setUploaded] = useState<ThemeInfo[]>([])
  const [choices, setChoices] = useState<ThemeChoices | null>(null)
  const latest = useRef(0)

  const reload = useCallback((): void => {
    const request = ++latest.current
    Promise.all([window.myclaud.themes.list(), window.myclaud.themes.getChoice()]).then(
      ([listed, chosen]) => {
        if (request !== latest.current) return
        if (listed.ok) setUploaded(listed.themes)
        else console.error(FAILED, listed.error.message)
        if (chosen.ok) setChoices({ chat: chosen.chat, default: chosen.default })
        else console.error(FAILED, chosen.error.message)
      },
      (err: unknown) => console.error(FAILED, err)
    )
  }, [])

  useEffect(() => {
    reload()
  }, [projectPath, reload])

  const entries = useMemo(() => themeEntries(uploaded), [uploaded])
  const active = choices ? (choices.chat ?? choices.default) : null
  const entry = active ? entryFor(active.themeId, entries) : entryFor('none', entries)

  const apply = useCallback(async (change: ThemeChoiceChange): Promise<string | null> => {
    try {
      const result = await window.myclaud.themes.setChoice(change)
      if (!result.ok) return result.error.message
      setChoices({ chat: result.chat, default: result.default })
      return null
    } catch (err) {
      console.error('Could not save the theme choice:', err)
      return 'The theme choice could not be saved.'
    }
  }, [])

  const add = useCallback(async (): Promise<AddThemeResult> => {
    try {
      const result = await window.myclaud.themes.add()
      if (result.ok && !result.canceled) {
        setUploaded((current) => [...current, result.theme])
      }
      return result
    } catch (err) {
      console.error('Could not add the theme:', err)
      return {
        ok: false,
        error: { code: 'io_error', message: 'The theme could not be added.' }
      }
    }
  }, [])

  const rename = useCallback(async (id: string, name: string): Promise<string | null> => {
    try {
      const result = await window.myclaud.themes.rename(id, name)
      if (!result.ok) return result.error.message
      setUploaded((current) =>
        current.map((theme) => (theme.id === id ? { ...theme, name: result.name } : theme))
      )
      return null
    } catch (err) {
      console.error('Could not rename the theme:', err)
      return 'The theme could not be renamed.'
    }
  }, [])

  const remove = useCallback(
    async (id: string): Promise<{ error: string | null; active: ThemeChoice | null }> => {
      try {
        const result = await window.myclaud.themes.remove(id)
        if (!result.ok) return { error: result.error.message, active: null }
        setUploaded((current) => current.filter((theme) => theme.id !== id))
        setChoices({ chat: result.chat, default: result.default })
        return { error: null, active: result.chat ?? result.default }
      } catch (err) {
        console.error('Could not delete the theme:', err)
        return { error: 'The theme could not be deleted.', active: null }
      }
    },
    []
  )

  return {
    entries,
    active,
    entry,
    ownChoice: choices?.chat != null,
    reload,
    apply,
    add,
    rename,
    remove
  }
}
