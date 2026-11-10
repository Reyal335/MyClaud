import type { ReactNode } from 'react'
import './AppShell.css'

type AppShellProps = {
  sidebar: ReactNode
  children: ReactNode
}

function AppShell({ sidebar, children }: AppShellProps): React.JSX.Element {
  return (
    <div className="app-shell">
      {sidebar}
      <main className="app-shell__content">{children}</main>
    </div>
  )
}

export default AppShell
