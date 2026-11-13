// Only http and https addresses become links in rendered Markdown. Everything
// else, relative links and file paths included, is dropped and its text shows
// as plain text. Returns the address to use, or null.
export function safeUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}
