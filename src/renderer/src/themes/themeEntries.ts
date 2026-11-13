import { NONE_THEME, TOKYO_NIGHT, type ThemeInfo } from '../../../shared/themes'
// The built-in theme is bundled with the window like the default mascot, so it is
// part of the installed app and never has to be loaded from disk.
import tokyoNightImage from '../assets/tokyo-night.png'

// One choice in the picker: none, the built-in Tokyo Night, or an uploaded theme.
export type ThemeEntry = {
  id: string
  name: string
  kind: 'none' | 'built-in' | 'uploaded'
  // The picture, or null for none.
  image: string | null
}

export const NONE_ENTRY: ThemeEntry = { id: NONE_THEME, name: 'None', kind: 'none', image: null }

export const TOKYO_NIGHT_ENTRY: ThemeEntry = {
  id: TOKYO_NIGHT,
  name: 'Tokyo Night',
  kind: 'built-in',
  image: tokyoNightImage
}

// None first, then Tokyo Night, then the uploads, oldest first.
export function themeEntries(uploaded: ThemeInfo[]): ThemeEntry[] {
  return [
    NONE_ENTRY,
    TOKYO_NIGHT_ENTRY,
    ...uploaded.map((theme): ThemeEntry => ({
      id: theme.id,
      name: theme.name,
      kind: 'uploaded',
      image: theme.image
    }))
  ]
}

// The entry for a theme id. An id that is not in the list draws as none.
export function entryFor(themeId: string, entries: ThemeEntry[]): ThemeEntry {
  return entries.find((entry) => entry.id === themeId) ?? NONE_ENTRY
}
