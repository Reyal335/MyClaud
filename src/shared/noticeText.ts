import type { AgentError } from './ipc'

// The message shown for a failed run: in the history, the dialogue box, and the error popup.
export function errorText(error: AgentError): string {
  switch (error.code) {
    case 'not_signed_in':
      return 'MyClaud uses your Claude Code login. Open a terminal, run `claude`, sign in with /login, then try again.'
    case 'api_key_in_use':
      return 'An API key is set for Claude Code on this machine, so this would be billed to the API. Remove it and try again.'
    case 'rate_limit':
      return "You've reached your Claude plan's usage limit, or Claude is busy. Try again later."
    case 'overloaded':
      return 'Claude is busy or rate limited. Try again in a moment.'
    default:
      return `The request failed: ${error.message}`
  }
}

export const STOPPED_TEXT = 'Stopped.'
