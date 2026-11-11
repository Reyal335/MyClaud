import type { MyClaudApi } from '../shared/ipc'

declare global {
  interface Window {
    myclaud: MyClaudApi
  }
}

export {}
