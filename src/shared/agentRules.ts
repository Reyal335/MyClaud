// Rules for agent files, used by the form for quick feedback and by the main
// process, which checks every field again before writing.

export const MAX_AGENT_NAME_LENGTH = 256

export const TOOL_CHOICES = [
  'Read',
  'Grep',
  'Glob',
  'Bash',
  'Edit',
  'Write',
  'WebFetch',
  'WebSearch'
] as const

export const MODEL_CHOICES = ['inherit', 'sonnet', 'opus', 'haiku', 'fable'] as const

export function agentNameError(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'Name is required.'
  if (trimmed.length > MAX_AGENT_NAME_LENGTH) {
    return `Name must be at most ${MAX_AGENT_NAME_LENGTH} characters.`
  }
  if (trimmed.includes(':')) return 'Name cannot contain ":".'
  if (/[\r\n]/.test(trimmed)) return 'Name cannot contain line breaks.'
  // Claude Code skips a file whose name starts with a hyphen.
  if (trimmed.startsWith('-')) return 'Name cannot start with "-".'
  return null
}

export const MAX_AGENT_ROLE_LENGTH = 40

// The role is optional: empty means none.
export function agentRoleError(role: string): string | null {
  const trimmed = role.trim()
  if (trimmed.length > MAX_AGENT_ROLE_LENGTH) {
    return `Role must be at most ${MAX_AGENT_ROLE_LENGTH} characters.`
  }
  if (/[\r\n]/.test(trimmed)) return 'Role cannot contain line breaks.'
  return null
}

export function agentDescriptionError(description: string): string | null {
  return description.trim() === '' ? 'Description is required.' : null
}

export function agentToolsError(tools: string[] | null): string | null {
  return tools !== null && tools.length === 0 ? 'Choose at least one tool.' : null
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/
const MAX_STEM_LENGTH = 100

// The filename (without .md) for a new agent: lowercase letters, digits, and
// hyphens. Empty when the name has none of those.
export function safeFileStem(name: string): string {
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, MAX_STEM_LENGTH)
    .replace(/-+$/, '')
  return WINDOWS_RESERVED.test(stem) ? `${stem}-agent` : stem
}
