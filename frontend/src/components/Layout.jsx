import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import Icon from './Icon.jsx'

// The three workspaces, each with its own pages
export const WORKSPACES = [
  {
    id: 'apply',
    label: 'Applicant',
    icon: 'user',
    path: '/apply',
    pages: [],
  },
  {
    id: 'business',
    label: 'Business',
    icon: 'briefcase',
    path: '/business',
    pages: [
      { path: '/business', label: 'Dashboard', icon: 'dashboard' },
      { path: '/business/statistics', label: 'Statistics', icon: 'chart' },
      { path: '/business/pipeline', label: 'Work queue', icon: 'inbox' },
      { path: '/business/policy', label: 'Policy lab', icon: 'sliders' },
    ],
  },
  {
    id: 'tech',
    label: 'Tech team',
    icon: 'code',
    path: '/tech',
    pages: [
      { path: '/tech', label: 'Data overview', icon: 'database' },
      { path: '/tech/insights', label: 'Insights', icon: 'bulb' },
      { path: '/tech/train', label: 'Train models', icon: 'play' },
      { path: '/tech/models', label: 'Compare models', icon: 'compare' },
    ],
  },
]

function Header() {
  const { pathname } = useLocation()
  return (
    <header className="topbar">
      <Link to="/" className="topbar-brand">
        <span className="logo" aria-hidden="true">SL</span>
        <span>Second-Look <span className="brand-light">Lending</span></span>
      </Link>
      <nav className="switcher" aria-label="Workspaces">
        {WORKSPACES.map((w) => (
          <NavLink key={w.id} to={w.path} className={pathname.startsWith(w.path) ? 'active' : ''}>
            <Icon name={w.icon} size={16} />{w.label}
          </NavLink>
        ))}
      </nav>
      <NavLink to="/help" className="topbar-help"><Icon name="help" size={16} />Help</NavLink>
    </header>
  )
}

// Business and Tech: header, a sidebar with that workspace's pages, and the page itself
export function WorkspaceLayout({ workspaceId, subtitle }) {
  const workspace = WORKSPACES.find((w) => w.id === workspaceId)
  return (
    <div className="app">
      <Header />
      <div className="layout">
        <nav className="sidebar" aria-label={`${workspace.label} pages`}>
          <div className="sidebar-title">{workspace.label}</div>
          <div className="sidebar-sub">{subtitle}</div>
          {workspace.pages.map((page) => (
            <NavLink key={page.path} to={page.path} end><Icon name={page.icon} />{page.label}</NavLink>
          ))}
        </nav>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

// Applicant portal, Home and Help: header and a centered page, no sidebar
export function SimpleLayout({ wide }) {
  return (
    <div className="app">
      <Header />
      <main className={`simple ${wide ? 'wide' : ''}`}>
        <Outlet />
      </main>
      <footer className="footer">
        Second-Look Lending · a learning project built on synthetic data, with no real customers
      </footer>
    </div>
  )
}
