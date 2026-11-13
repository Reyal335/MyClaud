import { useCallback, useEffect, useState } from 'react'
import { LOADING_DATA, type AccountData } from '../../../shared/account'

export type AccountStore = {
  data: AccountData
  // The time as of the last tick: refreshed every minute and when the window is focused,
  // so "in 42 min" counts down and a window whose reset time has passed clears.
  now: number
  checking: boolean
  // Reads the account again (CHECK AGAIN). Null when the read could not be made.
  check: () => Promise<AccountData | null>
}

const TICK_MS = 60_000

// The account and the usage numbers, kept by main and pushed here when they change. They
// sit above the screens so the sidebar meter and the ACCOUNT screen always agree.
export function useAccount(): AccountStore {
  const [data, setData] = useState<AccountData>(LOADING_DATA)
  const [now, setNow] = useState(() => Date.now())
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    let active = true
    // A change that arrives before the first answer is newer than the answer.
    let changed = false
    const stop = window.mya.account.onChange((next) => {
      if (!active) return
      changed = true
      setData(next)
      setNow(Date.now())
    })
    window.mya.account.get().then(
      (first) => {
        if (active && !changed) {
          setData(first)
          setNow(Date.now())
        }
      },
      (err: unknown) => console.error('Could not read the account:', err)
    )

    const refresh = (): void => setNow(Date.now())
    const timer = setInterval(refresh, TICK_MS)
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      stop()
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const check = useCallback(async (): Promise<AccountData | null> => {
    setChecking(true)
    try {
      const next = await window.mya.account.check()
      setData(next)
      setNow(Date.now())
      return next
    } catch (err) {
      console.error('Could not check the account:', err)
      return null
    } finally {
      setChecking(false)
    }
  }, [])

  return { data, now, checking, check }
}
