import { contextBridge } from 'electron'

// The typed app API is added here in later steps. Nothing is exposed yet.
const api = {}

contextBridge.exposeInMainWorld('api', api)
