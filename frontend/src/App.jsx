import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { SimpleLayout, WorkspaceLayout } from './components/Layout.jsx'
import Home from './pages/Home.jsx'
import Help from './pages/Help.jsx'
import Apply from './pages/applicant/Apply.jsx'
import Portal from './pages/applicant/Portal.jsx'
import Decision from './pages/applicant/Decision.jsx'
import Dashboard from './pages/business/Dashboard.jsx'
import PolicyLab from './pages/business/PolicyLab.jsx'
import Statistics from './pages/business/Statistics.jsx'
import WorkQueue from './pages/business/WorkQueue.jsx'
import ReviewCase from './pages/business/ReviewCase.jsx'
import Overview from './pages/tech/Overview.jsx'
import Insights from './pages/tech/Insights.jsx'
import Train from './pages/tech/Train.jsx'
import Models from './pages/tech/Models.jsx'

// Old links (before the three workspaces) still work, query string included
function Moved({ to }) {
  const { search } = useLocation()
  return <Navigate to={to + search} replace />
}

export default function App() {
  return (
    <Routes>
      <Route element={<SimpleLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/apply" element={<Apply />} />
        <Route path="/apply/status" element={<Portal />} />
        <Route path="/apply/:caseId" element={<Decision />} />
      </Route>
      <Route element={<SimpleLayout wide />}>
        <Route path="/help" element={<Help />} />
      </Route>

      <Route element={<WorkspaceLayout workspaceId="business" subtitle="Profit, fairness and the lending policy" />}>
        <Route path="/business" element={<Dashboard />} />
        <Route path="/business/policy" element={<PolicyLab />} />
        <Route path="/business/statistics" element={<Statistics />} />
        <Route path="/business/pipeline" element={<WorkQueue />} />
        <Route path="/business/review/:caseId" element={<ReviewCase />} />
      </Route>

      <Route element={<WorkspaceLayout workspaceId="tech" subtitle="Data, training and model quality" />}>
        <Route path="/tech" element={<Overview />} />
        <Route path="/tech/insights" element={<Insights />} />
        <Route path="/tech/train" element={<Train />} />
        <Route path="/tech/models" element={<Models />} />
      </Route>

      <Route path="/insights" element={<Moved to="/tech/insights" />} />
      <Route path="/train" element={<Moved to="/tech/train" />} />
      <Route path="/models" element={<Moved to="/tech/models" />} />
      <Route path="/policy" element={<Moved to="/business/policy" />} />
      <Route path="/applicant" element={<Moved to="/business/pipeline" />} />
      <Route path="/business/cases" element={<Moved to="/business/pipeline" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
