import type { MyClaudPopupApi } from '../shared/ipc'

declare global {
  interface Window {
    // Only in the popup window.
    myclaudPopup: MyClaudPopupApi
  }
}

export {}
