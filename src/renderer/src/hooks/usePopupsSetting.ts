import { useCallback, useEffect, useState } from 'react'

// The POPUPS setting from settings.json, and TEST POPUP.
export function usePopupsSetting(): {
  on: boolean
  loaded: boolean
  toggle: () => void
  test: () => void
} {
  const [on, setOn] = useState(true)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let disposed = false
    window.myclaud.ui
      .getPopups()
      .then((value) => {
        if (disposed) return
        setOn(value)
        setLoaded(true)
      })
      .catch((err: unknown) => console.error('Could not read the popups setting:', err))
    return () => {
      disposed = true
    }
  }, [])

  const toggle = useCallback((): void => {
    const next = !on
    setOn(next)
    window.myclaud.ui
      .setPopups(next)
      .catch((err: unknown) => console.error('Could not save the popups setting:', err))
  }, [on])

  const test = useCallback((): void => {
    window.myclaud.ui
      .testPopup()
      .catch((err: unknown) => console.error('Could not show the test popup:', err))
  }, [])

  return { on, loaded, toggle, test }
}
