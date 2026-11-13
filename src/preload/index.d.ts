import type { MyaApi } from '../shared/ipc'

declare global {
  interface Window {
    mya: MyaApi
  }
}

export {}
