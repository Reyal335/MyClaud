import '@fontsource/press-start-2p/400.css'
import '@fontsource/ibm-plex-mono/400.css'
import '../styles/tokens.css'
import '../styles/global.css'
import '../styles/buttons.css'
import './popup.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import PopupApp from './PopupApp'

// The popup window's page. It only talks to window.myclaudPopup.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PopupApp />
  </StrictMode>
)
