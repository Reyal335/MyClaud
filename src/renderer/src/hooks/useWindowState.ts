import { useEffect, useState } from 'react'
import type { WindowPlatform, WindowState } from '../../../shared/ipc'

// Until main answers, the platform comes from the user agent, so the bar is laid out
// right from the first frame (our own buttons on Windows and Linux, room for the
// traffic lights on macOS).
function guessPlatform(): WindowPlatform {
  const agent = navigator.userAgent
  if (agent.includes('Macintosh')) return 'darwin'
  if (agent.includes('Windows')) return 'win32'
  return 'linux'
}

// The main window's state for the title bar: maximized or full screen, focused, and
// the platform. Main sends a new state on every change.
export function useWindowState(): WindowState {
  const [state, setState] = useState<WindowState>(() => ({
    maximized: false,
    focused: document.hasFocus(),
    platform: guessPlatform()
  }))

  useEffect(() => {
    let disposed = false
    let unsubscribe = (): void => {}
    try {
      unsubscribe = window.myclaud.window.onState(setState)
      window.myclaud.window.getState().then(
        (initial) => {
          if (!disposed && initial) setState(initial)
        },
        (err: unknown) => console.error('Could not read the window state:', err)
      )
    } catch (err) {
      console.error('Could not read the window state:', err)
    }
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  return state
}
