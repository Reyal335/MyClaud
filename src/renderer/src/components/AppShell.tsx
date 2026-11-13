import type { ReactNode } from 'react'
import './AppShell.css'

type AppShellProps = {
  // The title bar, across the full width above everything else.
  titleBar: ReactNode
  sidebar: ReactNode
  children: ReactNode
}

function AppShell({ titleBar, sidebar, children }: AppShellProps): React.JSX.Element {
  return (
    <div className="app-shell">
      {titleBar}
      <div className="app-shell__body">
        {sidebar}
        <main className="app-shell__content">{children}</main>
      </div>
    </div>
  )
}

export default AppShell
