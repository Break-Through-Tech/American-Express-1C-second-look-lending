import { NavLink, Route, Routes } from 'react-router-dom'
import Overview from './pages/Overview.jsx'
import Train from './pages/Train.jsx'
import Models from './pages/Models.jsx'
import PolicyLab from './pages/PolicyLab.jsx'
import Applicant from './pages/Applicant.jsx'
import Insights from './pages/Insights.jsx'

const pages = [
  { path: '/', label: 'Overview & EDA', element: <Overview /> },
  { path: '/insights', label: 'Insights: data & model', element: <Insights /> },
  { path: '/train', label: 'Train models', element: <Train /> },
  { path: '/models', label: 'Compare models', element: <Models /> },
  { path: '/policy', label: 'Policy lab', element: <PolicyLab /> },
  { path: '/applicant', label: 'Score applicant', element: <Applicant /> },
]

export default function App() {
  return (
    <div className="layout">
      <nav className="sidebar">
        <div className="brand">Second-Look Lending</div>
        <div className="brand-sub">Profit-aware, inclusive credit decisions</div>
        {pages.map((page) => (
          <NavLink key={page.path} to={page.path} end>
            {page.label}
          </NavLink>
        ))}
      </nav>
      <main className="content">
        <Routes>
          {pages.map((page) => (
            <Route key={page.path} path={page.path} element={page.element} />
          ))}
        </Routes>
      </main>
    </div>
  )
}
