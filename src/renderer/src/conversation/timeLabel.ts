// Times in the inbox, as designs/1-inbox.html shows them: the clock time today,
// "Yesterday", the weekday within a week, then the date.

const DAY = 24 * 60 * 60 * 1000

function startOfDay(time: number): number {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function clockTime(time: number): string {
  return new Date(time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function timeLabel(time: number, now: number = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(time)) / DAY)
  if (days <= 0) return clockTime(time)
  if (days === 1) return 'Yesterday'
  if (days < 7) return new Date(time).toLocaleDateString(undefined, { weekday: 'long' })
  return new Date(time).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

// How long a task took: "42s", "3m 5s", "1h 2m".
export function durationLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
