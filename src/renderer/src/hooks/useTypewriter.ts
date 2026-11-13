import { useCallback, useEffect, useRef, useState } from 'react'

// Steady typing pace, in characters per second.
const BASE_CPS = 60
// When more than this many characters are waiting, speed up so everything waiting
// shows within CATCH_UP_SECONDS. The faster pace holds until the box has caught up.
const CATCH_UP_AFTER = 120
const CATCH_UP_SECONDS = 1
// Longest frame gap counted, so a paused window does not dump text all at once.
const MAX_FRAME_MS = 100

export type Typewriter = {
  // How many characters show now.
  shown: number
  typing: boolean
  skip: () => void
}

// Counts up to `length` visible characters, one at a time. The caller draws that
// many (the dialogue box draws rendered Markdown). `blockKey` identifies the text
// block: a new key types from the start. The block present on mount starts fully
// shown, so a reply that finished while the box was away is not typed out again.
export function useTypewriter(
  length: number,
  blockKey: number | null,
  reducedMotion: boolean
): Typewriter {
  const [count, setCount] = useState(length)
  const [prevKey, setPrevKey] = useState(blockKey)
  if (blockKey !== prevKey) {
    setPrevKey(blockKey)
    setCount(0)
  }

  const visible = reducedMotion ? length : Math.min(count, length)
  const behind = visible < length

  const lengthRef = useRef(length)
  const countRef = useRef(count)
  useEffect(() => {
    lengthRef.current = length
    countRef.current = count
  }, [length, count])

  useEffect(() => {
    if (!behind) return
    let frame = 0
    let last = performance.now()
    let carry = 0
    // Catch-up pace in characters per second. It only rises while catching up, so
    // the backlog clears within about CATCH_UP_SECONDS of the last chunk.
    let catchUpCps = 0
    const tick = (now: number): void => {
      const elapsed = Math.min(now - last, MAX_FRAME_MS)
      last = now
      const waiting = lengthRef.current - countRef.current
      if (waiting <= 0) {
        catchUpCps = 0
      } else {
        if (waiting > CATCH_UP_AFTER) {
          catchUpCps = Math.max(catchUpCps, waiting / CATCH_UP_SECONDS)
        }
        const cps = Math.max(BASE_CPS, catchUpCps)
        carry += (elapsed / 1000) * cps
        const step = Math.floor(carry)
        if (step > 0) {
          carry -= step
          countRef.current = Math.min(lengthRef.current, countRef.current + step)
          setCount(countRef.current)
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [behind])

  // Show everything that has arrived so far.
  const skip = useCallback((): void => {
    countRef.current = lengthRef.current
    setCount(lengthRef.current)
  }, [])

  return { shown: visible, typing: behind, skip }
}
