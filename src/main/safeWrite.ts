import { randomBytes } from 'crypto'
import { open, rename, unlink, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'

const RENAME_ATTEMPTS = 4
const RENAME_RETRY_MS = 60

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code
}

// On Windows a virus scanner or indexer can hold a file or folder for a moment.
export async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (err) {
      const busy = errorCode(err) === 'EPERM' || errorCode(err) === 'EBUSY'
      if (!busy || attempt >= RENAME_ATTEMPTS) throw err
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_MS))
    }
  }
}

// Writes a temporary file in the same folder, then renames it over the target, so
// the target is never left half written.
export async function writeFileSafely(
  target: string,
  data: string | Buffer,
  mode?: number
): Promise<void> {
  const temp = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`)
  try {
    await writeFile(temp, data, mode === undefined ? undefined : { mode })
    await renameWithRetry(temp, target)
  } catch (err) {
    await unlink(temp).catch(() => {})
    throw err
  }
}

// Like writeFileSafely, but never replaces an existing file. Rejects with EEXIST.
export async function createFileSafely(
  target: string,
  data: string | Buffer,
  mode?: number
): Promise<void> {
  // Claiming the name with an exclusive open closes the gap between a check and the rename.
  const placeholder = await open(target, 'wx')
  await placeholder.close()
  try {
    await writeFileSafely(target, data, mode)
  } catch (err) {
    await unlink(target).catch(() => {})
    throw err
  }
}
