// Model and thinking choices: the rules main and the window share. Pure: no
// imports, no SDK. Main fills a ModelLists from the SDK's supportedModels(); the
// window only reads it.

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

// In order, weakest first. Anything that compares levels uses this order.
export const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

export const AUTO = 'auto'

// What a chat saves. `model` is 'auto' or a value from the model list. `effort` is
// 'auto' or one of the levels that model supports.
export type ModelChoice = { model: string; effort: string }

export const AUTO_CHOICE: ModelChoice = { model: AUTO, effort: AUTO }

// One row of the model list.
export type ModelOption = {
  // What the SDK's model option takes.
  value: string
  // The exact model it resolves to, such as 'claude-sonnet-5-5'. Replies name this.
  resolvedModel: string | null
  name: string
  description: string
  // The levels it takes, weakest first. [] means none. null means the SDK did not
  // say (an older Claude Code), so the window offers the usual four.
  effortLevels: EffortLevel[] | null
}

// What AUTO stands for: Claude Code's default model.
export type AutoModel = {
  resolvedModel: string | null
  // The default model's display name when it is also a row of the list.
  name: string | null
  effortLevels: EffortLevel[] | null
}

export type ModelLists = { models: ModelOption[]; auto: AutoModel }

// The part of the SDK's ModelInfo this reads.
export type RawModelInfo = {
  value: string
  resolvedModel?: string
  displayName: string
  description: string
  supportsEffort?: boolean
  supportedEffortLevels?: readonly string[]
}

// The 'default' row is Claude Code's own default model: AUTO already means it, so it
// is not a row of its own, but its effort levels are the ones AUTO offers. Every
// other row stays, in the order the SDK gives them.
//
// Effort fields: a row that lists its levels has them. A row with supportsEffort
// false has none. When other rows have the fields and this one does not, it takes
// no level. When no row has them at all (an older Claude Code), they are unknown.
export function modelLists(infos: readonly RawModelInfo[]): ModelLists {
  const known = infos.some(
    (info) => Array.isArray(info.supportedEffortLevels) || typeof info.supportsEffort === 'boolean'
  )
  const levelsOf = (info: RawModelInfo): EffortLevel[] | null => {
    if (Array.isArray(info.supportedEffortLevels)) {
      return EFFORT_LEVELS.filter((level) => info.supportedEffortLevels?.includes(level))
    }
    if (info.supportsEffort === false) return []
    if (info.supportsEffort === true) return null
    return known ? [] : null
  }

  const models = infos
    .filter((info) => info.value !== 'default')
    .map((info): ModelOption => ({
      value: info.value,
      resolvedModel: info.resolvedModel ?? null,
      name: info.displayName,
      description: info.description,
      effortLevels: levelsOf(info)
    }))
  const fallback = infos.find((info) => info.value === 'default')
  const resolved = fallback?.resolvedModel ?? null
  return {
    models,
    auto: {
      resolvedModel: resolved,
      name: resolved ? (models.find((m) => m.resolvedModel === resolved)?.name ?? null) : null,
      effortLevels: fallback ? levelsOf(fallback) : null
    }
  }
}

// Shown for a model whose levels the SDK does not give.
const USUAL_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'max']

// The levels a model takes, or null when unknown. A model not in the list is unknown.
export function levelsFor(model: string, lists: ModelLists | null): EffortLevel[] | null {
  if (!lists) return null
  if (model === AUTO) return lists.auto.effortLevels
  return lists.models.find((option) => option.value === model)?.effortLevels ?? null
}

// The level buttons after AUTO: what the model supports, or the usual four when the
// SDK does not say. Empty when the model takes no level.
export function pickerLevels(model: string, lists: ModelLists | null): EffortLevel[] {
  return levelsFor(model, lists) ?? USUAL_LEVELS
}

export function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === 'string' && (EFFORT_LEVELS as readonly string[]).includes(value)
}

// --- Names and labels ----------------------------------------------------------

export const LEVEL_LABELS: Record<EffortLevel, string> = {
  low: 'LOW',
  medium: 'MED',
  high: 'HIGH',
  xhigh: 'XHIGH',
  max: 'MAX'
}

export function levelLabel(effort: string): string {
  return isEffortLevel(effort) ? LEVEL_LABELS[effort] : 'AUTO'
}

// The model's name as shown in the control and on tags.
export function optionLabel(option: ModelOption): string {
  return option.name.toUpperCase()
}

// A name for a model value in a message about it. The model may be gone from the list.
export function modelValueLabel(model: string, lists: ModelLists | null): string {
  if (model === AUTO) return 'AUTO'
  const option = lists?.models.find((entry) => entry.value === model)
  return option ? optionLabel(option) : model.toUpperCase()
}

// The model that answered, by the id the SDK reports (always the exact model, never
// an alias). A model the list does not know shows its id, tidied.
export function modelNameFor(id: string, lists: ModelLists | null): string {
  const option =
    lists?.models.find((entry) => entry.resolvedModel === id) ??
    lists?.models.find((entry) => entry.value === id)
  if (option) return optionLabel(option)
  // "claude-haiku-4-5-20251001" reads "HAIKU 4.5".
  const versioned = /^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?$/.exec(id)
  if (versioned) return `${versioned[1]} ${versioned[2]}.${versioned[3]}`.toUpperCase()
  return id
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .replace(/-/g, ' ')
    .toUpperCase()
}

// The control's two parts: "SONNET 5.5" and "HIGH", shown as "SONNET 5.5 · THINK HIGH".
export function choiceLabel(
  choice: ModelChoice,
  lists: ModelLists | null
): { model: string; level: string } {
  return { model: modelValueLabel(choice.model, lists), level: levelLabel(choice.effort) }
}

// --- The thinking meter ----------------------------------------------------------

export const METER_BLOCKS = 4

// How many of the 4 blocks are filled, or 'dotted' for AUTO. Five levels in four
// blocks: XHIGH and MAX both fill all four, and the word tells them apart.
export function meterFill(effort: string): number | 'dotted' {
  switch (effort) {
    case 'low':
      return 1
    case 'medium':
      return 2
    case 'high':
      return 3
    case 'xhigh':
    case 'max':
      return 4
    default:
      return 'dotted'
  }
}

// --- Power and speed bars, and the copy -------------------------------------------

type Family = 'opus' | 'sonnet' | 'haiku'

const FAMILIES: Record<Family, { power: number; speed: number; description: string }> = {
  opus: {
    power: 3,
    speed: 1,
    description: 'Strongest. For hard bugs and big refactors. Uses plan limits fastest.'
  },
  sonnet: { power: 2, speed: 2, description: 'Balanced. A good default for everyday coding.' },
  haiku: {
    power: 1,
    speed: 3,
    description: 'Fastest and lightest. Small edits and quick questions.'
  }
}

export const AUTO_MODEL_DESCRIPTION =
  "Claude Code's default model. Follows it when the default changes."

export const LEVEL_DESCRIPTIONS: Record<EffortLevel | 'auto', string> = {
  auto: "Claude Code's default thinking for this model.",
  low: 'Quick answers. Little thinking before it replies.',
  medium: 'Thinks through a normal task before acting.',
  high: 'Plans carefully. Slower, better on tricky changes.',
  xhigh: 'Thinks longer than HIGH on hard problems.',
  max: 'Thinks as long as it needs. Slowest and heaviest on limits.'
}

export const NO_LEVEL_LINE = "This model doesn't take a thinking level."

function familyOf(option: ModelOption): Family | null {
  const text = `${option.value} ${option.resolvedModel ?? ''}`.toLowerCase()
  const found = (Object.keys(FAMILIES) as Family[]).find((family) => text.includes(family))
  return found ?? null
}

// POWER and SPEED, 1 to 3 blocks each. A model of no known family has none.
export function modelBars(option: ModelOption): { power: number; speed: number } | null {
  const family = familyOf(option)
  return family ? { power: FAMILIES[family].power, speed: FAMILIES[family].speed } : null
}

// The table's line for the three families, the SDK's own description for any other.
export function modelDescription(option: ModelOption): string {
  const family = familyOf(option)
  return family ? FAMILIES[family].description : option.description
}

// --- Checking a saved choice --------------------------------------------------------

// The highest level the model takes that is below `level`, or null.
function levelBelow(level: EffortLevel, supported: readonly EffortLevel[]): EffortLevel | null {
  const index = EFFORT_LEVELS.indexOf(level)
  for (let i = index - 1; i >= 0; i--) {
    if (supported.includes(EFFORT_LEVELS[i])) return EFFORT_LEVELS[i]
  }
  return null
}

// A saved choice made to fit what is available now. `lists` is null when the model
// list could not be loaded: then only AUTO is known. Each change comes with a line
// for the person, to show once.
export function resolveChoice(
  saved: ModelChoice,
  lists: ModelLists | null
): { choice: ModelChoice; notices: string[] } {
  const notices: string[] = []
  let model = saved.model
  if (model !== AUTO && !lists?.models.some((option) => option.value === model)) {
    notices.push(`${modelValueLabel(model, lists)} isn't available right now. Using AUTO.`)
    model = AUTO
  }

  let effort = saved.effort
  if (effort !== AUTO) {
    const levels = levelsFor(model, lists)
    // Unknown levels (null) cannot be checked: the choice stays.
    if (!isEffortLevel(effort)) {
      effort = AUTO
    } else if (levels !== null && !levels.includes(effort)) {
      const name =
        model === AUTO ? (lists?.auto.name?.toUpperCase() ?? 'AUTO') : modelValueLabel(model, lists)
      const lower = levelBelow(effort, levels)
      notices.push(
        `${LEVEL_LABELS[effort]} isn't available on ${name}. Using ${lower ? LEVEL_LABELS[lower] : 'AUTO'}.`
      )
      effort = lower ?? AUTO
    }
  }
  return { choice: { model, effort }, notices }
}

// --- Replies ---------------------------------------------------------------------

// What a reply was made with: the model that answered, the level in force when it
// started (null when not known, such as a reply loaded from a saved chat), and how
// long it thought before answering.
export type ReplyMeta = { model: string | null; level: string | null; thoughtMs: number }

// "SONNET 5.5 · HIGH · THOUGHT 12s". THOUGHT shows only for a second or more.
export function replyTag(meta: ReplyMeta, lists: ModelLists | null): string {
  const parts: string[] = []
  if (meta.model) parts.push(modelNameFor(meta.model, lists))
  if (meta.level !== null) parts.push(levelLabel(meta.level))
  if (meta.thoughtMs >= 1000) parts.push(`THOUGHT ${Math.round(meta.thoughtMs / 1000)}s`)
  return parts.join(' · ')
}
