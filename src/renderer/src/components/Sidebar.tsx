import NavItem from './NavItem'
import type { Screen } from '../screens/types'
import type { ProjectInfo } from '../../../shared/ipc'
import './Sidebar.css'

type SidebarProps = {
  screen: Screen
  onNavigate: (screen: Screen) => void
  project: ProjectInfo | null
  canOpenProject: boolean
  onOpenProject: () => void
}

const NAV_ITEMS: { screen: Screen; label: string }[] = [
  { screen: 'inbox', label: 'INBOX' },
  { screen: 'agents', label: 'AGENTS' },
  { screen: 'mascots', label: 'MASCOTS' }
]

function Sidebar({
  screen,
  onNavigate,
  project,
  canOpenProject,
  onOpenProject
}: SidebarProps): React.JSX.Element {
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
        <span className="sidebar__project" title={project?.path}>
          {project ? project.name : 'No project open'}
        </span>
        <button
          type="button"
          className="button button--small sidebar__open"
          disabled={!canOpenProject}
          onClick={onOpenProject}
        >
          {project ? 'CHANGE' : 'OPEN'}
        </button>
      </div>
    </nav>
  )
}

export default Sidebar
