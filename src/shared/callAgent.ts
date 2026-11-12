// The sentence main puts in front of my message when I call an agent from the
// party panel. History loading recognizes it and shows the agent's chip instead.

export const CALL_SENTENCE = 'Use the <name> agent for this request.'

const [BEFORE, AFTER] = CALL_SENTENCE.split('<name>')

export function withCall(agentName: string, text: string): string {
  return `${BEFORE}${agentName}${AFTER}\n\n${text}`
}

// The agent name and my own text, when `prompt` starts with the sentence.
export function parseCall(prompt: string): { agentName: string; text: string } | null {
  const normalized = prompt.replace(/\r\n/g, '\n')
  if (!normalized.startsWith(BEFORE)) return null
  const end = normalized.indexOf(`${AFTER}\n\n`, BEFORE.length)
  if (end <= BEFORE.length) return null
  const agentName = normalized.slice(BEFORE.length, end)
  if (agentName.includes('\n')) return null
  return { agentName, text: normalized.slice(end + AFTER.length + 2) }
}
