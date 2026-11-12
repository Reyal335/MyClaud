import type { ModelChoiceResult, ModelsResult } from '../shared/ipc'
import { AUTO, resolveChoice, type ModelChoice } from '../shared/models'
import { getChatChoice, setChatChoice } from './chats'
import { isObject } from './jsonFile'
import { getModels } from './models'
import { getDefaultChoice, setDefaultChoice } from './settings'

// A chat's model and thinking choice, checked against what the account can use now.
// The pure rules are in shared/models.ts; this reads and saves around them.

const FAILED_LIST = "Couldn't load the model list."
const MAX_MODEL_LENGTH = 200

export async function listModels(cwd: string): Promise<ModelsResult> {
  const loaded = await getModels(cwd)
  return loaded.ok ? { ok: true, ...loaded.lists } : { ok: false, message: FAILED_LIST }
}

// The chat's saved choice made to fit the models available now. A chat with none
// yet starts from the saved defaults. `listed` is false when the model list could
// not be loaded: then only AUTO is known.
async function checkedChoice(cwd: string): Promise<{
  saved: ModelChoice
  choice: ModelChoice
  notices: string[]
  listed: boolean
}> {
  const saved = (await getChatChoice(cwd)) ?? (await getDefaultChoice())
  const loaded = await getModels(cwd)
  const { choice, notices } = resolveChoice(saved, loaded.ok ? loaded.lists : null)
  return { saved, choice, notices, listed: loaded.ok }
}

// For the picker: what to show now. Nothing is saved and no line is made, so the
// run that follows still says what changed.
export async function chatChoice(cwd: string): Promise<ModelChoiceResult> {
  try {
    return { ok: true, choice: (await checkedChoice(cwd)).choice }
  } catch (err) {
    console.error('[modelChoice] Could not read the choice:', err)
    return { ok: false, error: { message: 'The model choice could not be read.' } }
  }
}

// For a run starting: the choice to run with, and a line for each change made to a
// saved choice that no longer fits. A change is saved once the list is known, so
// its line shows once; while the list could not be loaded nothing is saved, so a
// failed fetch never costs the person their choice.
export async function choiceForRun(
  cwd: string
): Promise<{ choice: ModelChoice; notices: string[] }> {
  const { saved, choice, notices, listed } = await checkedChoice(cwd)
  if (listed && (choice.model !== saved.model || choice.effort !== saved.effort)) {
    await setChatChoice(cwd, choice)
  }
  return { choice, notices }
}

// A pick in the picker. Checked again here, since the window is not trusted: the
// model must be AUTO or in the list, and the level is made to fit the model.
export async function saveChoice(cwd: string, raw: unknown): Promise<ModelChoiceResult> {
  if (
    !isObject(raw) ||
    typeof raw.model !== 'string' ||
    raw.model === '' ||
    raw.model.length > MAX_MODEL_LENGTH ||
    typeof raw.effort !== 'string' ||
    typeof raw.asDefault !== 'boolean'
  ) {
    return { ok: false, error: { message: 'That is not a model choice.' } }
  }
  try {
    const loaded = await getModels(cwd)
    const known = loaded.ok && loaded.lists.models.some((option) => option.value === raw.model)
    if (raw.model !== AUTO && !known) {
      return { ok: false, error: { message: 'That model is not available.' } }
    }
    const { choice } = resolveChoice(
      { model: raw.model, effort: raw.effort },
      loaded.ok ? loaded.lists : null
    )
    await setChatChoice(cwd, choice)
    if (raw.asDefault) await setDefaultChoice(choice)
    return { ok: true, choice }
  } catch (err) {
    console.error('[modelChoice] Could not save the choice:', err)
    return { ok: false, error: { message: 'The model choice could not be saved.' } }
  }
}
