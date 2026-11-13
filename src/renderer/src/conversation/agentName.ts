import type { Mascot } from '../mascots/types'

// The name the main conversation speaks under until a mascot has a name of its own.
// Agents Claude brings in show their own names on their cards, in the party panel, and
// in the inbox.
export const AGENT_NAME = 'Claude'

// The name the main conversation speaks under in CHAT: the active mascot's name. The
// built-in default mascot, until it is renamed, has no name of its own, so it stays Claude.
export function speakerName(mascot: Mascot): string {
  return mascot.named ? mascot.name : AGENT_NAME
}
