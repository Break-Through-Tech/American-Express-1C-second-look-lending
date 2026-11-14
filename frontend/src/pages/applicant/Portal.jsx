import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../../api.js'
import { ErrorBox } from '../../components/ui.jsx'
import { money } from '../../format.js'

const STORY_STYLE = {
  second_look: 'good',
  approved: 'good',
  in_review: 'warn',
  not_approved: 'neutral',
}

export default function Portal() {
  const [samples, setSamples] = useState(null)
  const [caseId, setCaseId] = useState('')
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    api.portalShowcase().then(setSamples).catch(setError)
  }, [])

  const open = (event) => {
    event.preventDefault()
    if (caseId.trim()) navigate(`/apply/${caseId.trim()}`)
  }

  return (
    <>
      <div className="portal-hero">
        <span className="portal-tag">Application status</span>
        <h1>Check your application</h1>
        <p>
          Enter the application number you got when you applied to see the decision, the main reasons behind it, and
          what could change it. Haven't applied yet? <Link to="/apply">Start an application</Link>.
        </p>
        <form className="portal-search" onSubmit={open}>
          <label className="field" style={{ flex: 1 }}>
            Application number
            <input value={caseId} onChange={(e) => setCaseId(e.target.value)} placeholder="e.g. 1000005" inputMode="numeric" />
          </label>
          <button type="submit" disabled={!caseId.trim()}>See my decision</button>
        </form>
      </div>

      <ErrorBox error={error} />
      <h2 className="portal-section">Example decisions</h2>
      <p className="muted">Applications from the most recent weeks of the dataset, picked to show each kind of outcome.</p>
      {!samples && !error && <p className="muted">Loading…</p>}
      <div className="sample-grid">
        {samples?.map((s) => (
          <Link key={s.case_id} to={`/apply/${s.case_id}`} className="sample-card">
            <span className={`badge ${STORY_STYLE[s.story]}`}>{s.story_label}</span>
            <strong>{money(s.credit_amount)} loan</strong>
            <span className="muted small">
              {s.payment ? `${money(s.payment)} per payment · ` : ''}income {money(s.income)}
            </span>
            <span className="small">{s.thin_file ? 'First-time borrower · no credit history' : 'Has credit history'}</span>
            <span className="sample-id mono">Application #{s.case_id}</span>
          </Link>
        ))}
      </div>
    </>
  )
}
