import './NavItem.css'

type NavItemProps = {
  label: string
  active: boolean
  onClick: () => void
  count?: number
}

function NavItem({ label, active, onClick, count }: NavItemProps): React.JSX.Element {
  const showCount = count !== undefined && count > 0

  return (
    <button
      type="button"
      className={active ? 'nav-item nav-item--active' : 'nav-item'}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      <span>{label}</span>
      {showCount && (
        <span className="nav-item__count" aria-label={`${count} unread`}>
          {count}
        </span>
      )}
    </button>
  )
}

export default NavItem
