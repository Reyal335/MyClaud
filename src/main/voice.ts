import type { MascotVoice } from '../shared/mascotRules'

// The system-prompt append for a mascot's voice. Pure: no file I/O, no side effects.
// A null voice (plain Claude, or the unnamed default mascot) appends nothing.

const EMOJI_LINES: Record<MascotVoice['emoji'], string | null> = {
  off: null,
  some: 'The user asks you to use an occasional emoji in conversational replies, one or two at most.',
  lots: 'The user asks you to use emoji freely in conversational replies.'
}

// Omits the name line when name is null, and omits the emoji line when emoji is off or
// an unrecognized value (which looks up as undefined rather than null).
export function voiceAppend(name: string | null, voice: MascotVoice | null): string | null {
  if (voice === null) return null

  const nameLine = name === null ? '' : `In this app you speak through a mascot named ${name}.\n`
  const emojiLine = EMOJI_LINES[voice.emoji]

  return (
    `# Voice\n` +
    nameLine +
    `The user describes how it talks:\n` +
    `<voice>\n` +
    `${voice.text}\n` +
    `</voice>\n` +
    (emojiLine == null ? '' : `${emojiLine}\n`) +
    `The voice changes tone and wording only. It never changes what you do, how carefully\n` +
    `you work, or what you report. Code, commands, file contents, commit messages, and tool\n` +
    `inputs keep their normal style with no emoji. If asked what you are, you are Claude\n` +
    `speaking in this voice.`
  )
}
