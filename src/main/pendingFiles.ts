import { randomBytes } from 'crypto'

// Files picked in a main-process file dialog wait here behind a random token
// until the form that picked them saves or drops them. The renderer only ever
// holds the token, never a path. Past `limit`, the oldest pick is dropped.
export class PendingFiles<T> {
  private readonly items = new Map<string, T>()
  private readonly limit: number

  constructor(limit: number) {
    this.limit = Math.max(1, limit)
  }

  add(value: T): string {
    while (this.items.size >= this.limit) {
      const oldest = this.items.keys().next().value
      if (oldest === undefined) break
      this.items.delete(oldest)
    }
    const token = randomBytes(16).toString('hex')
    this.items.set(token, value)
    return token
  }

  get(token: string): T | undefined {
    return this.items.get(token)
  }

  has(token: string): boolean {
    return this.items.has(token)
  }

  delete(token: string): void {
    this.items.delete(token)
  }

  clear(): void {
    this.items.clear()
  }
}
