import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../../api.js'
import { ErrorBox, InfoTip } from '../../components/ui.jsx'
import { useModelRoles } from '../../components/useRuns.js'
import { count, money, percent } from '../../format.js'

const PAGE = 50

export default function WorkQueue() {
  const { primaryRun, secondLookRun } = useModelRoles()
  const [summary, setSummary] = useState(null)
  const [tab, setTab] = useState('in_review')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)

  const reload = () => api.workflowSummary().then(setSummary).catch(setError)
  useEffect(() => { reload() }, [])

  // Every action shows a short message and refreshes the counts
  const run = async (action, describe) => {
    setBusy(true)
    setError(null)
    try {
      const result = await action()
      setMessage(describe(result))
      await reload()
    } catch (e) {
      setError(e)
    }
    setBusy(false)
  }

  if (!summary) return <><Head /><ErrorBox error={error} /><p className="muted">Loading…</p></>
  const counts = summary.counts
  const nextWeek = summary.weeks.find((w) => w.processed === 0)

  return (
    <>
      <Head />
      <ErrorBox error={error} />
      {message && <div className="banner good">{message}</div>}

      <div className="grid grid-2">
        <Settings settings={summary.settings} primaryRun={primaryRun} secondLookRun={secondLookRun}
          onSave={(changes) => run(() => api.saveWorkflowSettings(changes), () => 'Settings saved. They apply to the next cases you process.')} />

        <div className="card">
          <h2>Incoming applications</h2>
          <p className="small muted">New applications arrive one week at a time (weeks 92–107). Processing a week runs the primary model on it.</p>
          <div className="week-grid">
            {summary.weeks.map((w) => (
              <button key={w.week} className={`week-chip ${w.processed ? 'done' : ''}`} disabled={busy || w.processed > 0}
                onClick={() => run(() => api.processWeek(w.week), (r) => processedMessage(r))}
                title={w.processed ? `${count(w.processed)} applications processed` : 'Click to process this week'}>
                <strong>Week {w.week}</strong>
                <span>{w.processed ? `${count(w.processed)} done` : 'not processed'}</span>
              </button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            {nextWeek && (
              <button disabled={busy} onClick={() => run(() => api.processWeek(nextWeek.week), (r) => processedMessage(r))}>
                Process week {nextWeek.week}
              </button>
            )}
            <div className="spacer" />
            <button className="danger chip" disabled={busy || summary.total === 0} onClick={() => {
              if (window.confirm('Clear every case and the audit trail, and start the pipeline over?')) {
                run(() => api.resetWorkflow(), () => 'Pipeline cleared.')
              }
            }}>Start over</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <div className="tabs">
            <button className={tab === 'in_review' ? 'active' : ''} onClick={() => setTab('in_review')}>
              Human review ({count(counts.in_review || 0)})
            </button>
            <button className={tab === 'awaiting_second_look' ? 'active' : ''} onClick={() => setTab('awaiting_second_look')}>
              Waiting for Second Look ({count(counts.awaiting_second_look || 0)})
            </button>
            <button className={tab === 'decided' ? 'active' : ''} onClick={() => setTab('decided')}>
              Decided by reviewers ({count((counts.approved_review || 0) + (counts.declined_review || 0))})
            </button>
            <button className={tab === 'online' ? 'active' : ''} onClick={() => setTab('online')}>
              Online applications ({count(summary.online_total || 0)})
            </button>
          </div>
          <div className="spacer" />
          <OpenCase />
        </div>
        {tab === 'awaiting_second_look' && (
          <SecondLookQueue key={summary.total} mode={summary.settings.mode} busy={busy}
            onSend={(ids) => run(() => api.sendToSecondLook(ids), (r) => sentMessage(r))} />
        )}
        {tab === 'in_review' && <ReviewQueue key={`r${summary.total}`} status="in_review" />}
        {tab === 'decided' && <ReviewQueue key={`d${summary.total}`} status="decided" />}
        {tab === 'online' && <OnlineApplications key={`o${summary.total}`} />}
      </div>
    </>
  )
}

function Head() {
  return (
    <div className="page-head">
      <h1>Work queue</h1>
      <p>
        Each application gets the <strong>primary model</strong> first. Declines go to <strong>Second Look</strong> —
        automatically, or when you send them. Second Look declines that land just above the cut-off wait here for a
        <strong> person</strong> to review; clearly risky ones are declined automatically.
      </p>
    </div>
  )
}

function processedMessage(r) {
  const routed = r.mode === 'auto' ? 'sent straight to Second Look' : 'waiting for you to send them to Second Look'
  return `Week ${r.week}: ${count(r.processed)} applications processed. ${count(r.declined_by_primary)} declined by the primary model, ${routed}.`
}

function sentMessage(r) {
  const results = r.results
  return `${count(r.sent)} sent to Second Look: ${count(results.approved_second_look || 0)} approved, `
    + `${count(results.in_review || 0)} to human review, ${count(results.declined_second_look || 0)} declined.`
}

function Settings({ settings, primaryRun, secondLookRun, onSave }) {
  const [form, setForm] = useState(settings)
  useEffect(() => setForm(settings), [settings])
  const set = (key, value) => setForm({ ...form, [key]: value })

  return (
    <div className="card">
      <h2>How cases are routed</h2>
      <div className="field" style={{ marginBottom: 12 }}>
        <span className="field-label">
          Sending primary declines to Second Look
          <InfoTip><span>Automatic: every primary decline goes to Second Look right away. Manual: they wait in the queue below until you select and send them.</span></InfoTip>
        </span>
        <div className="tabs">
          <button className={form.mode === 'auto' ? 'active' : ''} onClick={() => set('mode', 'auto')}>Automatic</button>
          <button className={form.mode === 'manual' ? 'active' : ''} onClick={() => set('mode', 'manual')}>Manual</button>
        </div>
      </div>
      <div className="grid grid-2">
        <label className="field">
          <span className="field-label">
            Primary model approves below
            <InfoTip><span>The primary model approves when its risk score is under this. 20% is the break-even point of the cost model.</span></InfoTip>
          </span>
          <input type="number" min={1} max={99} step={0.5} value={Math.round(form.primary_cutoff * 1000) / 10}
            onChange={(e) => set('primary_cutoff', Number(e.target.value) / 100)} />
        </label>
        <label className="field">
          <span className="field-label">
            Send to a person if within (points)
            <InfoTip><span>Second Look declines this close to their cut-off go to human review; the rest are declined automatically. 2 points is about 260 cases a week; 0 turns human review off.</span></InfoTip>
          </span>
          <input type="number" min={0} max={100} step={0.5} value={Math.round(form.review_band * 1000) / 10}
            onChange={(e) => set('review_band', Number(e.target.value) / 100)} />
        </label>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>
        Primary model: <strong>{primaryRun?.name || '—'}</strong> · Second-look model: <strong>{secondLookRun?.name || '—'}</strong>
        {' '}(set by the tech team on <Link to="/tech/models">Compare models</Link>).
      </p>
      <button style={{ marginTop: 8 }} onClick={() => onSave(form)}>Save settings</button>
    </div>
  )
}

function OpenCase() {
  const [id, setId] = useState('')
  const navigate = useNavigate()
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); if (id.trim()) navigate(`/business/review/${id.trim()}`) }}>
      <input value={id} onChange={(e) => setId(e.target.value)} placeholder="Open application #" style={{ width: 180 }} />
      <button className="chip" type="submit" disabled={!id.trim()}>Open</button>
    </form>
  )
}

function useCases(status, offset) {
  const [data, setData] = useState(null)
  useEffect(() => {
    const statuses = status === 'decided' ? ['approved_review', 'declined_review'] : [status]
    Promise.all(statuses.map((s) => api.workflowCases({ status: s, limit: PAGE, offset })))
      .then((parts) => setData({
        total: parts.reduce((sum, p) => sum + p.total, 0),
        cases: parts.flatMap((p) => p.cases),
      }))
  }, [status, offset])
  return data
}

function Pager({ offset, total, onChange }) {
  if (total <= PAGE) return null
  return (
    <div className="row" style={{ marginTop: 10 }}>
      <button className="chip" disabled={offset === 0} onClick={() => onChange(offset - PAGE)}>← Previous</button>
      <span className="small muted">{offset + 1}–{Math.min(offset + PAGE, total)} of {count(total)}</span>
      <button className="chip" disabled={offset + PAGE >= total} onClick={() => onChange(offset + PAGE)}>Next →</button>
    </div>
  )
}

function SecondLookQueue({ mode, busy, onSend }) {
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState(new Set())
  const data = useCases('awaiting_second_look', offset)
  if (!data) return <p className="muted">Loading…</p>
  if (data.total === 0) {
    return <p className="muted">{mode === 'auto' ? 'Nothing waiting: in Automatic mode every primary decline goes straight to Second Look.' : 'Nothing waiting. Process a week to fill this queue.'}</p>
  }

  const toggle = (id) => {
    const next = new Set(selected)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    setSelected(next)
  }
  const allOnPage = data.cases.every((c) => selected.has(c.case_id))
  const togglePage = () => setSelected(allOnPage ? new Set() : new Set(data.cases.map((c) => c.case_id)))

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <button disabled={busy || selected.size === 0} onClick={() => { onSend([...selected]); setSelected(new Set()) }}>
          Send {selected.size || ''} selected to Second Look
        </button>
        <button className="secondary" disabled={busy} onClick={() => onSend([])}>Send all {count(data.total)}</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" checked={allOnPage} onChange={togglePage} aria-label="Select page" /></th>
              <th>Application</th><th>Week</th><th>Borrower</th><th className="num">Primary risk</th>
            </tr>
          </thead>
          <tbody>
            {data.cases.map((c) => (
              <tr key={c.case_id}>
                <td><input type="checkbox" checked={selected.has(c.case_id)} onChange={() => toggle(c.case_id)} aria-label={`Select ${c.case_id}`} /></td>
                <td className="mono">#{c.case_id}</td>
                <td>{c.online ? 'Online' : c.week}</td>
                <td><SegmentBadge thin={c.thin_file} /></td>
                <td className="num">{percent(c.primary_pd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager offset={offset} total={data.total} onChange={setOffset} />
    </>
  )
}

function ReviewQueue({ status }) {
  const [offset, setOffset] = useState(0)
  const data = useCases(status, offset)
  if (!data) return <p className="muted">Loading…</p>
  if (data.total === 0) {
    return <p className="muted">{status === 'in_review' ? 'No cases waiting for a person.' : 'No reviewer decisions yet.'}</p>
  }
  return (
    <>
      {status === 'in_review' && <p className="small muted">Closest to approval first — these are the cases where a person can make the biggest difference.</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Application</th><th>Week</th><th>Borrower</th><th className="num">Primary risk</th>
              <th className="num">Second Look risk</th><th className="num">Above cut-off by</th><th>Status</th><th />
            </tr>
          </thead>
          <tbody>
            {data.cases.map((c) => (
              <tr key={c.case_id}>
                <td className="mono">#{c.case_id}</td>
                <td>{c.online ? 'Online' : c.week}</td>
                <td><SegmentBadge thin={c.thin_file} /></td>
                <td className="num">{percent(c.primary_pd)}</td>
                <td className="num">{percent(c.second_look_pd)}</td>
                <td className="num">{((c.second_look_pd - c.second_look_cutoff) * 100).toFixed(1)} pts</td>
                <td><StatusBadge status={c.status} label={c.status_label} /></td>
                <td><Link to={`/business/review/${c.case_id}`}>{status === 'in_review' ? 'Review →' : 'Open →'}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager offset={offset} total={data.total} onChange={setOffset} />
    </>
  )
}

// Everything submitted through the applicant form, newest first, with where each one ended up
function OnlineApplications() {
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState(null)
  useEffect(() => {
    api.workflowCases({ online: true, limit: PAGE, offset }).then(setData)
  }, [offset])
  if (!data) return <p className="muted">Loading…</p>
  if (data.total === 0) {
    return <p className="muted">No online applications yet. They appear here as soon as someone submits the form on <Link to="/apply">Apply</Link>.</p>
  }
  return (
    <>
      <p className="small muted">Applications submitted on the Apply page. Each one goes through the pipeline the moment it is submitted.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Application</th><th>Applicant</th><th>Submitted</th><th className="num">Loan</th><th>Borrower</th>
              <th className="num">Primary risk</th><th className="num">Second Look risk</th><th>Decision</th><th />
            </tr>
          </thead>
          <tbody>
            {data.cases.map((c) => (
              <tr key={c.case_id}>
                <td className="mono">#{c.case_id}</td>
                <td>{c.application.first_name} {c.application.last_name}</td>
                <td>{c.application.submitted_at.replace('T', ' ').slice(0, 16)}</td>
                <td className="num">{money(c.application.loan_amount)}</td>
                <td><SegmentBadge thin={c.thin_file} /></td>
                <td className="num">{percent(c.primary_pd)}</td>
                <td className="num">{c.second_look_pd == null ? '—' : percent(c.second_look_pd)}</td>
                <td><StatusBadge status={c.status} label={c.status_label} /></td>
                <td><Link to={`/business/review/${c.case_id}`}>{c.status === 'in_review' ? 'Review →' : 'Open →'}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager offset={offset} total={data.total} onChange={setOffset} />
    </>
  )
}

export function SegmentBadge({ thin }) {
  return thin ? <span className="badge warn">First-time</span> : <span className="badge neutral">Established</span>
}

export function StatusBadge({ status, label }) {
  const kind = status.startsWith('approved') ? 'good' : status.startsWith('declined') ? 'bad' : 'warn'
  const icon = kind === 'good' ? '✓' : kind === 'bad' ? '✕' : '…'
  return <span className={`badge ${kind}`}>{icon} {label}</span>
}
