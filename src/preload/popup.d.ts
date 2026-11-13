import type { MyaPopupApi } from '../shared/ipc'

declare global {
  interface Window {
    // Only in the popup window.
    myaPopup: MyaPopupApi
  }
}

export {}
