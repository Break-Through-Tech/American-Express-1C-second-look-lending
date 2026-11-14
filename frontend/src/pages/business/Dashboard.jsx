import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../../api.js'
import { ChartTooltip, ErrorBox, Legend } from '../../components/ui.jsx'
import { count, money, percent, points } from '../../format.js'

const axisProps = { tick: { fontSize: 12, fill: 'var(--text-3)' }, stroke: 'var(--border)' }

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [runs, setRuns] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    api.businessDashboard().then(setData).catch(setError)
    api.runs().then(setRuns).catch(() => {})
  }, [])

  if (error && !error.message.includes('No trained model')) return <><PageHead /><ErrorBox error={error} /></>
  if (error) {
    return (
      <>
        <PageHead />
        <div className="card empty">
          <h2>No trained model yet</h2>
          <p>The tech team needs to <Link to="/tech/train">train a model</Link> first.</p>
        </div>
      </>
    )
  }
  if (!data) return <><PageHead /><p className="muted">Loading…</p></>

  const before = data.baseline
  const after = data.second_look
  const nameOf = (runId) => runs.find((r) => r.run_id === runId)?.name || runId

  return (
    <>
      <PageHead weeks={data.weeks} applications={data.applications} />

      <div className="kpi-grid">
        <Kpi label="Profit" value={money(after.profit)} change={after.profit - before.profit} format={money} better="up"
          hint={`primary model only: ${money(before.profit)}`} />
        <Kpi label="Inclusion gap" value={points(after.inclusion_gap_pts)}
          change={Math.abs(after.inclusion_gap_pts) - Math.abs(before.inclusion_gap_pts)} format={points} better="down"
          hint={`primary only: ${points(before.inclusion_gap_pts)} · closer to 0 is fairer`} />
        <Kpi label="Approval rate" value={percent(after.approval_rate)} change={after.approval_rate - before.approval_rate}
          format={(v) => percent(v)} better="up" hint={`primary only: ${percent(before.approval_rate)}`} />
        <Kpi label="Default rate of approved loans" value={percent(after.default_rate_approved)}
          change={after.default_rate_approved - before.default_rate_approved} format={(v) => percent(v)} better="down"
          hint={`limit ${percent(data.ceiling)} · primary only: ${percent(before.default_rate_approved)}`} />
      </div>

      <div className="card highlight-card">
        <div>
          <span className="role-tag">Second Look at work</span>
          <h2>{count(data.rescued.count)} first-time borrowers declined by the primary model and approved by Second Look</h2>
          <p>
            {count(data.rescued.repaid)} of them ({percent(data.rescued.repaid / data.rescued.count, 0)}) repaid. Of all
            thin-file applicants who repaid, {percent(after.segments.thin_file.good_approval_rate, 0)} are now approved,
            up from {percent(before.segments.thin_file.good_approval_rate, 0)}.
          </p>
        </div>
        <FairnessBars before={before} after={after} />
      </div>

      <div className="grid grid-2">
        <WeeklyProfit weekly={data.weekly} />
        <WeeklyApprovals weekly={data.weekly} />
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>Published policy</h2>
          <table>
            <tbody>
              <tr><td>Approve established applicants when risk is below</td><td className="num"><strong>{percent(data.thresholds.established)}</strong></td></tr>
              <tr><td>Approve first-time (thin-file) applicants when risk is below</td><td className="num"><strong>{percent(data.thresholds.thin_file)}</strong></td></tr>
              <tr><td>Fairness penalty per gap point (per 100k applicants)</td><td className="num">{money(data.penalty)}</td></tr>
              <tr><td>Maximum default rate of approved loans</td><td className="num">{percent(data.ceiling)}</td></tr>
            </tbody>
          </table>
          <Link to="/business/policy" className="button-link">Preview a change in the Policy lab →</Link>
        </div>
        <div className="card">
          <h2>Models in use</h2>
          <table>
            <tbody>
              <tr><td>Primary model — decides every application first (approves below {percent(data.primary_cutoff)} risk)</td><td className="num"><strong>{nameOf(data.roles.primary)}</strong></td></tr>
              <tr><td>Second-look model — reviews what the primary model declines, with the policy on the left</td><td className="num"><strong>{nameOf(data.roles.second_look)}</strong></td></tr>
            </tbody>
          </table>
          <p className="muted small" style={{ marginTop: 8 }}>
            Chosen by the tech team. Second Look declines close to the cut-off ({count(data.in_review)} in these weeks) go to a
            person; they are counted as declined here until someone decides.
          </p>
          <Link to="/business/pipeline" className="button-link">Open the work queue →</Link>
        </div>
      </div>
    </>
  )
}

function PageHead({ weeks, applications }) {
  return (
    <div className="page-head">
      <h1>Business dashboard</h1>
      <p>
        How lending performs{weeks ? ` on the most recent weeks (${weeks[0]}–${weeks[1]}, ${count(applications)} applications)` : ''}{' '}
        with Second Look reviewing the primary model's declines, compared with the primary model alone.
      </p>
    </div>
  )
}

function Kpi({ label, value, change, format, better, hint }) {
  const good = better === 'up' ? change > 0 : change < 0
  return (
    <div className="stat kpi">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className={good ? 'delta-good' : 'delta-bad'}>{change > 0 ? '▲' : '▼'} {format(Math.abs(change))} vs primary only</div>
      <div className="stat-hint">{hint}</div>
    </div>
  )
}

function FairnessBars({ before, after }) {
  const rows = [
    ['Primary only · established', before.segments.established.good_approval_rate, 'var(--series-established)'],
    ['Primary only · first-time', before.segments.thin_file.good_approval_rate, 'var(--series-thin)'],
    ['Second Look · established', after.segments.established.good_approval_rate, 'var(--series-established)'],
    ['Second Look · first-time', after.segments.thin_file.good_approval_rate, 'var(--series-thin)'],
  ]
  return (
    <div className="fairness">
      <div className="small muted" style={{ marginBottom: 6 }}>Of applicants who repaid, share approved</div>
      {rows.map(([label, value, color]) => (
        <div className="bar-item" key={label}>
          <span className="label">{label}</span>
          <div className="track"><div className="fill" style={{ width: `${value * 100}%`, background: color }} /></div>
          <span className="num">{percent(value, 0)}</span>
        </div>
      ))}
    </div>
  )
}

function WeeklyProfit({ weekly }) {
  return (
    <div className="card">
      <h2>Profit per week</h2>
      <Legend items={[
        { label: 'Primary model only', color: 'var(--series-baseline)' },
        { label: 'Second Look', color: 'var(--series-second-look)' },
      ]} />
      <div className="chart" style={{ height: 240 }}>
        <ResponsiveContainer>
          <LineChart data={weekly} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="week" {...axisProps} />
            <YAxis tickFormatter={money} domain={['auto', 'auto']} {...axisProps} width={64} />
            <Tooltip content={<ChartTooltip labelFormatter={(w) => `Week ${w}`} valueFormatter={money} />} />
            <Line isAnimationActive={false} dataKey="profit_baseline" name="Primary model only" stroke="var(--series-baseline)" strokeWidth={2} dot={false} />
            <Line isAnimationActive={false} dataKey="profit_second_look" name="Second Look" stroke="var(--series-second-look)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function WeeklyApprovals({ weekly }) {
  return (
    <div className="card">
      <h2>Approval rate per week (with Second Look)</h2>
      <Legend items={[
        { label: 'Established', color: 'var(--series-established)' },
        { label: 'First-time (thin-file)', color: 'var(--series-thin)' },
      ]} />
      <div className="chart" style={{ height: 240 }}>
        <ResponsiveContainer>
          <LineChart data={weekly} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="week" {...axisProps} />
            <YAxis tickFormatter={(v) => percent(v, 0)} domain={[0.4, 0.9]} {...axisProps} width={44} />
            <Tooltip content={<ChartTooltip labelFormatter={(w) => `Week ${w}`} valueFormatter={(v) => percent(v)} />} />
            <Line isAnimationActive={false} dataKey="approval_established" name="Established" stroke="var(--series-established)" strokeWidth={2} dot={false} />
            <Line isAnimationActive={false} dataKey="approval_thin_file" name="First-time" stroke="var(--series-thin)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
