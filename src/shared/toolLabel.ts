import type { ToolInput } from './ipc'

// One line describing a tool call: a verb and, once the input is known, its target.
export type ToolLabel = {
  verb: string
  target: string | null
}

const VERBS: Record<string, string> = {
  Read: 'Reading',
  Grep: 'Searching for',
  Glob: 'Finding',
  Edit: 'Editing',
  Write: 'Writing',
  Bash: 'Running'
}

const BASH_MAX = 80

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

// A path relative to the project folder when it is inside it, otherwise unchanged.
// Compared case-insensitively, as Windows paths are.
export function relativePath(path: string, projectPath: string | null): string {
  if (!projectPath) return path
  const file = normalize(path)
  const root = normalize(projectPath)
  if (file.toLowerCase() === root.toLowerCase()) return '.'
  if (file.toLowerCase().startsWith(root.toLowerCase() + '/')) return file.slice(root.length + 1)
  return path
}

function stringField(input: ToolInput, key: string): string | null {
  const value = input[key]
  return typeof value === 'string' && value !== '' ? value : null
}

function targetOf(name: string, input: ToolInput, projectPath: string | null): string | null {
  switch (name) {
    case 'Read':
    case 'Edit':
    case 'Write': {
      const path = stringField(input, 'file_path')
      return path && relativePath(path, projectPath)
    }
    case 'Grep':
    case 'Glob':
      return stringField(input, 'pattern')
    case 'Bash': {
      const command = stringField(input, 'command')
      return command && command.split(/\r?\n/)[0].slice(0, BASH_MAX)
    }
    default:
      return null
  }
}

export function toolLabel(
  name: string,
  input: ToolInput | null,
  projectPath: string | null
): ToolLabel {
  const verb = VERBS[name]
  if (!verb) return { verb: name, target: null }
  if (!input) return { verb: `${verb}...`, target: null }
  const target = targetOf(name, input, projectPath)
  return target ? { verb, target } : { verb: `${verb}...`, target: null }
}

// The label as one line of text, for previews and the party panel.
export function labelText(label: ToolLabel): string {
  return label.target === null ? label.verb : `${label.verb} ${label.target}`
}
