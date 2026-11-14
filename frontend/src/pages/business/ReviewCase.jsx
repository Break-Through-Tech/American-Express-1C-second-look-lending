import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../../api.js'
import { ErrorBox } from '../../components/ui.jsx'
import { money, percent } from '../../format.js'
import { SegmentBadge, StatusBadge } from './WorkQueue.jsx'
import { phraseFor } from '../applicant/reasons.js'

// The terms a reviewer can change, with plain labels
const FIELDS = [
  ['credamount_770A', 'Loan amount', 'money'],
  ['annuity_780A', 'Payment per period', 'money'],
  ['mainoccupationinc_384A', 'Stated income', 'money'],
  ['tax_amount_4527230A_mean', 'Verified income (tax records)', 'money'],
  ['days_employed_700P', 'Days employed', 'number'],
  ['prev_app_count', 'Earlier applications with us', 'number'],
]

export default function ReviewCase() {
  const { caseId } = useParams()
  const [detail, setDetail] = useState(null)
  const [score, setScore] = useState(null)       // the second-look model's view with the current changes
  const [changes, setChanges] = useState({})
  const [reason, setReason] = useState('')
  const [reviewer, setReviewer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setDetail(null)
    setChanges({})
    setError(null)
    api.workflowCase(caseId).then(setDetail).catch(setError)
    api.rescoreCase(caseId, {}).then(setScore).catch(() => {})
  }, [caseId])

  const rescore = async () => {
    setError(null)
    try {
      setScore(await api.rescoreCase(caseId, changes))
    } catch (e) {
      setError(e)
    }
  }

  const decide = async (decision) => {
    setBusy(true)
    setError(null)
    try {
      setDetail(await api.decideCase(caseId, { decision, reason, reviewer: reviewer || 'reviewer', changes }))
    } catch (e) {
      setError(e)
    }
    setBusy(false)
  }

  if (error && !detail) {
    return (
      <>
        <BackLink />
        <div className="card empty">
          <h2>Application #{caseId} is not in the pipeline yet</h2>
          <p>Its week has not been processed. Process it on the <Link to="/business/pipeline">Work queue</Link>, or see the
            <Link to={`/apply/${caseId}`}> applicant's view</Link>.</p>
        </div>
      </>
    )
  }
  if (!detail) return <><BackLink /><p className="muted">Loading…</p></>

  const c = detail.case
  const reviewable = c.status === 'in_review'
  const changed = Object.keys(changes).length > 0
  const override = score && !score.model_approves

  return (
    <>
      <BackLink />
      <div className="page-head">
        <div className="row">
          <h1 style={{ margin: 0 }}>Application #{c.case_id}</h1>
          <SegmentBadge thin={c.thin_file} />
          <StatusBadge status={c.status} label={c.status_label} />
          <div className="spacer" />
          <Link to={`/apply/${c.case_id}`}>See what the applicant sees →</Link>
        </div>
        <p className="small muted" style={{ marginTop: 6 }}>
          {c.application
            ? `Applied online by ${c.application.first_name} ${c.application.last_name} on ${c.application.submitted_at.slice(0, 10)} · ${c.application.purpose} · ${c.application.term_months} months · ${c.application.employment}`
            : `Applied in week ${c.week}`}
        </p>
      </div>
      <ErrorBox error={error} />

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <Stage title="1 · Primary model" value={percent(c.primary_pd)}
          note={c.status === 'approved_primary' ? 'approved' : 'declined: risk above its cut-off'} />
        <Stage title="2 · Second Look" value={c.second_look_pd == null ? '—' : percent(c.second_look_pd)}
          note={c.second_look_pd == null ? 'not run' : `cut-off ${percent(c.second_look_cutoff)} · ${gapText(c)}`} />
        <Stage title="3 · Human review" value={reviewable ? 'Your decision' : c.status.endsWith('review') ? 'Decided' : '—'}
          note={reviewable ? 'borderline case — a person decides' : c.status_label} />
      </div>

      {reviewable && score && (
        <div className="grid grid-2">
          <div className="card">
            <h2>Adjust the terms</h2>
            <p className="small muted">
              Change what you have verified or agreed with the applicant, then re-score. Nothing is saved until you decide.
            </p>
            <div className="grid grid-2">
              {FIELDS.map(([field, label]) => (
                <label className="field" key={field}>
                  {label}
                  <input type="number" step="any" placeholder="missing"
                    value={field in changes ? (changes[field] ?? '') : (score.editable[field] ?? '')}
                    onChange={(e) => setChanges({ ...changes, [field]: e.target.value === '' ? null : Number(e.target.value) })} />
                </label>
              ))}
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button onClick={rescore}>Re-score</button>
              {changed && <button className="secondary" onClick={() => { setChanges({}); api.rescoreCase(caseId, {}).then(setScore) }}>Undo changes</button>}
            </div>
            <div className={`banner ${score.model_approves ? 'good' : 'warn'}`} style={{ marginTop: 12, marginBottom: 0 }}>
              Second Look risk <strong>{percent(score.pd)}</strong> vs cut-off {percent(score.cutoff)}:{' '}
              {score.model_approves ? 'the model would approve these terms.' : 'the model still declines.'}
            </div>
          </div>

          <div className="card">
            <h2>Decide</h2>
            <label className="field">
              Your name
              <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="e.g. A. Reviewer" />
            </label>
            <label className="field" style={{ marginTop: 10 }}>
              Reason {override ? <strong className="delta-bad">(required to approve against the model)</strong> : '(optional)'}
              <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Income confirmed with three months of payslips" />
            </label>
            <div className="row" style={{ marginTop: 12 }}>
              <button disabled={busy || (override && !reason.trim())} onClick={() => decide('approve')}
                className={override ? 'override' : ''}>
                {override ? 'Override and approve' : changed ? 'Approve with these terms' : 'Approve'}
              </button>
              <button className="danger" disabled={busy} onClick={() => decide('decline')}>Decline</button>
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>
              Every decision is recorded below with your name, reason and the terms you changed.
            </p>
          </div>
        </div>
      )}

      {score?.reasons?.length > 0 && <Reasons reasons={score.reasons} />}
      <AuditTrail events={detail.events} />
    </>
  )
}

function BackLink() {
  return <Link to="/business/pipeline" className="back-link">← Back to the work queue</Link>
}

function gapText(c) {
  const gap = (c.second_look_pd - c.second_look_cutoff) * 100
  return gap < 0 ? 'approved' : `${gap.toFixed(1)} pts above`
}

function Stage({ title, value, note }) {
  return (
    <div className="stat">
      <div className="stat-label">{title}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-hint">{note}</div>
    </div>
  )
}

function Reasons({ reasons }) {
  const largest = Math.max(...reasons.map((r) => Math.abs(r.contribution)))
  return (
    <div className="card">
      <h2>What drives the Second Look score</h2>
      <p className="small muted">Red pushes the risk up, green pulls it down. Bar length shows how strongly (SHAP values).</p>
      <div className="bar-list">
        {reasons.map((r) => (
          <div className="bar-item" key={r.feature}>
            <span className="label" title={r.feature}>
              {phraseFor(r.feature, false)}
              <span className="muted small"> · <span className="mono">{r.feature}</span> = {r.value == null ? 'missing' : typeof r.value === 'number' ? Number(r.value.toFixed(3)) : r.value}</span>
            </span>
            <div className="track">
              <div className="fill" style={{ width: `${(Math.abs(r.contribution) / largest) * 100}%`, background: r.contribution > 0 ? 'var(--bad)' : 'var(--good)' }} />
            </div>
            <span className={r.contribution > 0 ? 'delta-bad' : 'delta-good'}>{r.contribution > 0 ? '+' : ''}{r.contribution.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function AuditTrail({ events }) {
  return (
    <div className="card">
      <h2>Audit trail</h2>
      <ol className="audit">
        {events.map((e, i) => (
          <li key={i}>
            <div className="row" style={{ gap: 8 }}>
              <strong>{e.action}</strong>
              <span className="small muted">{e.at.replace('T', ' ')} · {e.actor}</span>
            </div>
            <EventDetail detail={e.detail} />
          </li>
        ))}
      </ol>
    </div>
  )
}

// System events are plain text; reviewer decisions are stored as JSON
function EventDetail({ detail }) {
  let parsed = null
  try { parsed = JSON.parse(detail) } catch { /* plain text */ }
  if (!parsed) return <div className="small">{detail}</div>
  const changes = Object.entries(parsed.changes || {})
  return (
    <div className="small">
      {parsed.reason && <div>Reason: “{parsed.reason}”</div>}
      {changes.length > 0 && <div>Changed: {changes.map(([k, v]) => `${labelFor(k)} → ${v == null ? 'missing' : formatValue(k, v)}`).join(', ')}</div>}
      <div className="muted">
        Second Look risk after changes {percent(parsed.risk_after_changes)} vs cut-off {percent(parsed.cutoff)} —
        {parsed.model_approves_after_changes ? ' model agreed' : ' model disagreed'}
      </div>
    </div>
  )
}

function labelFor(field) {
  return FIELDS.find(([f]) => f === field)?.[1] || field
}

function formatValue(field, value) {
  return FIELDS.find(([f]) => f === field)?.[2] === 'money' ? money(value) : value
}
