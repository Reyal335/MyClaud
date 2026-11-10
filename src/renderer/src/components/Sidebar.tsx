import NavItem from './NavItem'
import type { Screen } from '../screens/types'
import './Sidebar.css'

type SidebarProps = {
  screen: Screen
  onNavigate: (screen: Screen) => void
}

const NAV_ITEMS: { screen: Screen; label: string }[] = [
  { screen: 'inbox', label: 'INBOX' },
  { screen: 'agents', label: 'AGENTS' },
  { screen: 'mascots', label: 'MASCOTS' }
]

function Sidebar({ screen, onNavigate }: SidebarProps): React.JSX.Element {
  return (
    <nav className="sidebar" aria-label="Main">
      <div className="sidebar__wordmark">MyClaud</div>
      {NAV_ITEMS.map((item) => (
        <NavItem
          key={item.screen}
          label={item.label}
          active={screen === item.screen}
          onClick={() => onNavigate(item.screen)}
        />
      ))}
      <div className="sidebar__footer">
        Project
        <br />
        <span className="sidebar__project">No project open</span>
      </div>
    </nav>
  )
}

export default Sidebar
