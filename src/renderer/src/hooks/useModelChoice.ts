import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AUTO_CHOICE,
  resolveChoice,
  type ModelChoice,
  type ModelLists
} from '../../../shared/models'

export type ModelChoiceStore = {
  // The models the account can use, or null until loaded, or when loading failed.
  lists: ModelLists | null
  // The model list could not be loaded: the picker offers AUTO only.
  listFailed: boolean
  // The open chat's model and thinking choice, made to fit the models available now.
  choice: ModelChoice
  // The picker's "Use for new chats too" box. Checked until I clear it.
  asDefault: boolean
  setAsDefault: (on: boolean) => void
  // Picks apply at once: the control updates now, main saves it, and during a run it
  // applies from the next message.
  pick: (next: ModelChoice) => void
  // Loads the list and the choice again: the picker was opened after a failed load,
  // or NEW CHAT changed the choice.
  reload: () => void
}

// The model list and the open chat's model and thinking choice. Main keeps both:
// the window only shows them and asks for changes.
export function useModelChoice(projectPath: string): ModelChoiceStore {
  const [lists, setLists] = useState<ModelLists | null>(null)
  const [listFailed, setListFailed] = useState(false)
  const [choice, setChoice] = useState<ModelChoice>(AUTO_CHOICE)
  const [asDefault, setAsDefault] = useState(true)
  const latestLoad = useRef(0)
  const latestPick = useRef(0)
  // Picks sent to main and not answered yet.
  const picking = useRef(0)
  // The list as last loaded, for fitting a pick before main answers.
  const listsRef = useRef<ModelLists | null>(null)

  const reload = useCallback((): void => {
    const request = ++latestLoad.current
    Promise.all([window.myclaud.models.list(), window.myclaud.chat.getModelChoice()]).then(
      ([models, saved]) => {
        if (request !== latestLoad.current) return
        if (models.ok) {
          const next: ModelLists = { models: models.models, auto: models.auto }
          listsRef.current = next
          setLists(next)
          setListFailed(false)
        } else {
          listsRef.current = null
          setLists(null)
          setListFailed(true)
        }
        // A pick still being saved is newer than what was loaded.
        if (saved.ok && picking.current === 0) setChoice(saved.choice)
      },
      (err: unknown) => {
        console.error('Could not load the model choice:', err)
        if (request === latestLoad.current) setListFailed(true)
      }
    )
  }, [])

  useEffect(() => {
    reload()
  }, [projectPath, reload])

  const pick = useCallback(
    (next: ModelChoice): void => {
      // The level is made to fit the model now, as main does, so the control never
      // shows a level the model does not take.
      const fitted = resolveChoice(next, listsRef.current).choice
      const request = ++latestPick.current
      picking.current++
      setChoice(fitted)
      window.myclaud.chat
        .setModelChoice({ ...fitted, asDefault })
        .then((result) => {
          picking.current--
          if (request !== latestPick.current) return
          if (result.ok) setChoice(result.choice)
          else reload()
        })
        .catch((err: unknown) => {
          picking.current--
          console.error('Could not save the model choice:', err)
          if (request === latestPick.current) reload()
        })
    },
    [asDefault, reload]
  )

  return { lists, listFailed, choice, asDefault, setAsDefault, pick, reload }
}
