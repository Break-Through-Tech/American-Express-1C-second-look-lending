import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../../api.js'
import { ChartTooltip, ErrorBox, Legend, Stat } from '../../components/ui.jsx'
import { count, percent } from '../../format.js'

// One color per outcome, used in every chart on this page
const OUTCOMES = [
  ['approved_primary', 'Approved by primary', 'var(--series-established)'],
  ['approved_second_look', 'Approved by Second Look', 'var(--series-second-look)'],
  ['approved_review', 'Approved by a reviewer', '#6b4fd8'],
  ['in_review', 'Waiting for a person', 'var(--warn)'],
  ['awaiting_second_look', 'Waiting for Second Look', 'var(--series-baseline)'],
  ['declined_second_look', 'Declined automatically', 'var(--bad)'],
  ['declined_review', 'Declined by a reviewer', '#8f2a2a'],
]

const axisProps = { tick: { fontSize: 12, fill: 'var(--text-3)' }, stroke: 'var(--border)' }

export default function Statistics() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.workflowSummary().then(setData).catch(setError)
  }, [])

  return (
    <>
      <div className="page-head">
        <h1>Pipeline statistics</h1>
        <p>
          How the applications processed so far moved through the pipeline: how many the primary model approved or
          declined, how many went through Second Look, and how many are waiting for a person. For expected profit and fairness
          across all recent weeks, see the <Link to="/business">Dashboard</Link>.
        </p>
      </div>
      <ErrorBox error={error} />
      {data && data.total === 0 && (
        <div className="card empty">
          <h2>Nothing processed yet</h2>
          <p>Process a week of applications on the <Link to="/business/pipeline">Work queue</Link> to see statistics here.</p>
        </div>
      )}
      {data && data.total > 0 && <Content data={data} />}
    </>
  )
}

function Content({ data }) {
  const n = (status) => data.counts[status] || 0
  const total = data.total
  const primaryDeclined = total - n('approved_primary')
  const throughSecondLook = n('approved_second_look') + n('in_review') + n('declined_second_look') + n('approved_review') + n('declined_review')
  const approved = n('approved_primary') + n('approved_second_look') + n('approved_review')
  const declined = n('declined_second_look') + n('declined_review')
  const reviewed = n('approved_review') + n('declined_review')
  const weekName = (w) => (w === data.online_week ? 'Online' : `Week ${w}`)

  return (
    <>
      <div className="kpi-grid">
        <Stat label="Applications processed" value={count(total)} hint={onlineHint(data)} />
        <Stat label="Approved by the primary model" value={count(n('approved_primary'))} hint={`${percent(n('approved_primary') / total)} · declined ${count(primaryDeclined)}`} />
        <Stat label="Went through Second Look" value={count(throughSecondLook)} hint={`${count(n('approved_second_look'))} approved there`} />
        <Stat label="Waiting for a person" value={count(n('in_review'))} hint={`${count(reviewed)} already decided by reviewers`} />
      </div>

      <div className="card">
        <h2>Funnel</h2>
        <p className="small muted">Each bar is a share of all processed applications.</p>
        <Funnel total={total} rows={[
          { label: 'Applications processed', value: total, color: 'var(--text-3)', depth: 0 },
          { label: 'Approved by the primary model', value: n('approved_primary'), color: 'var(--series-established)', depth: 1 },
          { label: 'Declined by the primary model', value: primaryDeclined, color: 'var(--series-baseline)', depth: 1 },
          { label: 'Waiting to be sent to Second Look', value: n('awaiting_second_look'), color: 'var(--series-baseline)', depth: 2 },
          { label: 'Approved by Second Look', value: n('approved_second_look'), color: 'var(--series-second-look)', depth: 2 },
          { label: 'Declined automatically (clearly too risky)', value: n('declined_second_look'), color: 'var(--bad)', depth: 2 },
          { label: 'Sent to a person (borderline)', value: n('in_review') + reviewed, color: 'var(--warn)', depth: 2 },
          { label: 'Waiting for a person', value: n('in_review'), color: 'var(--warn)', depth: 3 },
          { label: 'Approved by a reviewer', value: n('approved_review'), color: '#6b4fd8', depth: 3 },
          { label: 'Declined by a reviewer', value: n('declined_review'), color: '#8f2a2a', depth: 3 },
        ]} />
        <div className="row" style={{ marginTop: 12 }}>
          <span className="badge good">✓ {count(approved)} approved overall ({percent(approved / total)})</span>
          <span className="badge bad">✕ {count(declined)} declined</span>
          <span className="badge warn">… {count(n('in_review') + n('awaiting_second_look'))} still open</span>
        </div>
      </div>

      <div className="card">
        <h2>Outcomes per week</h2>
        <Legend items={OUTCOMES.map(([, label, color]) => ({ label, color, box: true }))} />
        <div className="chart">
          <ResponsiveContainer>
            <BarChart data={data.weekly} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="week" tickFormatter={weekName} {...axisProps} />
              <YAxis tickFormatter={count} {...axisProps} width={56} />
              <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip labelFormatter={weekName} valueFormatter={count} />} />
              {OUTCOMES.map(([key, label, color]) => (
                <Bar key={key} isAnimationActive={false} dataKey={key} name={label} stackId="week" fill={color} maxBarSize={64} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-2">
        <RouteOutcomes outcomes={data.outcomes} />
        <ReviewProgress waiting={n('in_review')} approved={n('approved_review')} declined={n('declined_review')} overrides={data.overrides} />
      </div>

      <FirstTimeShare counts={data.counts} thinCounts={data.thin_file_counts} />
    </>
  )
}

function onlineHint(data) {
  const weeks = data.weekly.filter((w) => w.week !== data.online_week).length
  const online = data.weekly.find((w) => w.week === data.online_week)
  const onlineCount = online ? Object.entries(online).reduce((sum, [key, n]) => (key === 'week' ? sum : sum + n), 0) : 0
  return `${weeks} week(s)${onlineCount ? ` + ${count(onlineCount)} online` : ''}`
}

function Funnel({ total, rows }) {
  return (
    <div className="funnel">
      {rows.map((row) => (
        <div className="funnel-row" key={row.label} style={{ paddingLeft: row.depth * 22 }}>
          <span className="funnel-label">{row.depth > 0 && <span className="funnel-branch" aria-hidden="true">↳ </span>}{row.label}</span>
          <div className="track"><div className="fill" style={{ width: `${(row.value / total) * 100}%`, background: row.color }} /></div>
          <span className="num">{count(row.value)}</span>
          <span className="num muted">{percent(row.value / total, 0)}</span>
        </div>
      ))}
    </div>
  )
}

function RouteOutcomes({ outcomes }) {
  const rows = outcomes.map((o) => ({ route: o.label.replace('Approved ', ''), repaid: o.repaid_share, approved: o.approved }))
  return (
    <div className="card">
      <h2>Did the approvals repay?</h2>
      <p className="small muted">Share of each route's approvals that repaid (from the answer key; in real life this is known months later).</p>
      <div className="chart" style={{ height: 220 }}>
        <ResponsiveContainer>
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="var(--grid)" horizontal={false} />
            <XAxis type="number" domain={[0, 1]} tickFormatter={(v) => percent(v, 0)} {...axisProps} />
            <YAxis type="category" dataKey="route" width={140} {...axisProps} />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip valueFormatter={(v) => percent(v)} />} />
            <Bar isAnimationActive={false} dataKey="repaid" name="Repaid" fill="var(--series-second-look)" radius={[0, 4, 4, 0]} barSize={22}
              label={{ position: 'right', fontSize: 12, fill: 'var(--text-2)', formatter: (v) => percent(v) }} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="small muted">{rows.map((r) => `${r.route}: ${count(r.approved)} loans`).join(' · ')}</p>
    </div>
  )
}

function ReviewProgress({ waiting, approved, declined, overrides }) {
  const total = waiting + approved + declined
  return (
    <div className="card">
      <h2>Human review progress</h2>
      {total === 0 ? <p className="muted">No borderline cases yet.</p> : (
        <>
          <div className="progress-stack" role="img" aria-label="Review progress">
            {[[approved, '#6b4fd8'], [declined, '#8f2a2a'], [waiting, 'var(--warn)']].map(([value, color], i) => (
              <div key={i} style={{ flex: value, background: color }} />
            ))}
          </div>
          <div className="grid grid-3" style={{ marginTop: 12 }}>
            <Stat label="Approved by reviewers" value={count(approved)} hint={`${count(overrides)} against the model (override)`} />
            <Stat label="Declined by reviewers" value={count(declined)} />
            <Stat label="Still waiting" value={count(waiting)} hint={`${percent(waiting / total, 0)} of borderline cases`} />
          </div>
          <Link to="/business/pipeline" className="button-link">Open the review queue →</Link>
        </>
      )}
    </div>
  )
}

function FirstTimeShare({ counts, thinCounts }) {
  const rows = OUTCOMES.filter(([key]) => counts[key]).map(([key, label]) => ({
    label,
    share: (thinCounts[key] || 0) / counts[key],
  }))
  return (
    <div className="card">
      <h2>First-time borrowers in each outcome</h2>
      <p className="small muted">Share of each outcome that is first-time (thin-file) borrowers — about 30% of all applicants.</p>
      <div className="bar-list">
        {rows.map((r) => (
          <div className="bar-item" key={r.label}>
            <span className="label">{r.label}</span>
            <div className="track"><div className="fill" style={{ width: `${r.share * 100}%`, background: 'var(--series-thin)' }} /></div>
            <span className="num">{percent(r.share, 0)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
