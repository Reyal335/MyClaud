import { useState } from 'react'
import AppShell from './components/AppShell'
import Sidebar from './components/Sidebar'
import InboxScreen from './screens/InboxScreen'
import AgentsScreen from './screens/AgentsScreen'
import MascotsScreen from './screens/MascotsScreen'
import type { Screen } from './screens/types'

function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('inbox')

  return (
    <AppShell sidebar={<Sidebar screen={screen} onNavigate={setScreen} />}>
      {screen === 'inbox' && <InboxScreen />}
      {screen === 'agents' && <AgentsScreen />}
      {screen === 'mascots' && <MascotsScreen />}
    </AppShell>
  )
}

export default App
