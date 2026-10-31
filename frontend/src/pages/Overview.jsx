import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api.js'
import { ChartTooltip, ErrorBox, Legend, Stat } from '../components/ui.jsx'
import { count, percent } from '../format.js'

const SEGMENT_LEGEND = [
  { label: 'Established', color: 'var(--series-established)' },
  { label: 'Thin-file', color: 'var(--series-thin)' },
]

export default function Overview() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.overview().then(setData).catch(setError)
  }, [])

  return (
    <>
      <div className="page-head">
        <h1>Overview & EDA</h1>
        <p>
          ~1M synthetic loans (train) and 200k later loans (test). Thin-file applicants have no credit-bureau history,
          so the model is least sure about them — that is where the inclusion gap comes from.
        </p>
      </div>
      <ErrorBox error={error} />
      {!data && !error && <div className="card muted">Loading dataset (the first load builds the feature tables, ~30s)…</div>}
      {data && <OverviewContent data={data} />}
    </>
  )
}

function OverviewContent({ data }) {
  return (
    <>
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Train loans" value={count(data.train_loans)} hint={`weeks ${data.train_weeks[0]}–${data.train_weeks[1]}`} />
        <Stat label="Test loans (out-of-time)" value={count(data.test_loans)} hint={`weeks ${data.test_weeks[0]}–${data.test_weeks[1]}`} />
        <Stat label="Default rate (naïve baseline)" value={percent(data.default_rate)} hint="share of train loans that defaulted" />
        <Stat label="Thin-file applicants" value={percent(data.thin_file_share)} hint="no credit_bureau_a_1 rows" />
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>Default rate by segment</h2>
          <div className="grid grid-2">
            <Stat label="Established" value={percent(data.default_rate_established)} />
            <Stat label="Thin-file" value={percent(data.default_rate_thin_file)} />
          </div>
          <p className="card-note">
            Thin-file loans default more often on average, but most of that difference is from early weeks — see the drift chart.
          </p>
        </div>
        <CoverageChart rows={data.coverage_distribution} />
      </div>

      <WeeklyChart rows={data.weekly_default_rate} />
      <FeatureExplorer />

      <div className="grid grid-2">
        <TablesCard tables={data.tables} />
        <MissingCard rows={data.missing} />
      </div>
    </>
  )
}

function WeeklyChart({ rows }) {
  return (
    <div className="card">
      <h2>Default rate per week — thin-file risk drifts down over time</h2>
      <Legend items={SEGMENT_LEGEND} />
      <div className="chart">
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="week" tick={{ fontSize: 12, fill: 'var(--text-3)' }} stroke="var(--border)" />
            <YAxis tickFormatter={(v) => percent(v, 0)} tick={{ fontSize: 12, fill: 'var(--text-3)' }} stroke="var(--border)" width={44} />
            <Tooltip content={<ChartTooltip labelFormatter={(w) => `Week ${w}`} valueFormatter={(v) => percent(v)} />} />
            <Line isAnimationActive={false} dataKey="established" name="Established" stroke="var(--series-established)" strokeWidth={2} dot={false} />
            <Line isAnimationActive={false} dataKey="thin_file" name="Thin-file" stroke="var(--series-thin)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="card-note">
        Test weeks come later than all train weeks, so a model trained on train will over-estimate thin-file risk on test.
        The policy lab corrects for this with segment-aware calibration and a drift adjustment.
      </p>
    </div>
  )
}

function CoverageChart({ rows }) {
  return (
    <div className="card">
      <h2>External-data coverage per applicant</h2>
      <div className="chart" style={{ height: 200 }}>
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="coverage" tick={{ fontSize: 12, fill: 'var(--text-3)' }} stroke="var(--border)" />
            <YAxis tickFormatter={(v) => `${v / 1000}k`} tick={{ fontSize: 12, fill: 'var(--text-3)' }} stroke="var(--border)" width={44} />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip labelFormatter={(c) => `${c} records`} valueFormatter={count} />} />
            <Bar isAnimationActive={false} dataKey="count" name="Applicants" fill="var(--series-established)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="card-note">Coverage = bureau contracts + prior applications + tax records (capped at 15).</p>
    </div>
  )
}

function FeatureExplorer() {
  const [featureNames, setFeatureNames] = useState([])
  const [selected, setSelected] = useState('riskassesment_940T')
  const [signal, setSignal] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.featureList().then((list) => setFeatureNames(list.map((f) => f.name))).catch(setError)
  }, [])

  useEffect(() => {
    setSignal(null)
    api.featureSignal(selected).then(setSignal).catch(setError)
  }, [selected])

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Signal vs default — default rate across feature bins</h2>
        <div className="spacer" />
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {featureNames.map((name) => <option key={name}>{name}</option>)}
        </select>
      </div>
      <ErrorBox error={error} />
      <Legend items={SEGMENT_LEGEND.map((item) => ({ ...item, box: true }))} />
      <div className="chart">
        {signal && (
          <ResponsiveContainer>
            <BarChart data={signal.rows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barGap={2}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: 'var(--text-3)' }} stroke="var(--border)" interval={0} angle={-20} textAnchor="end" height={56} />
              <YAxis tickFormatter={(v) => percent(v, 0)} tick={{ fontSize: 12, fill: 'var(--text-3)' }} stroke="var(--border)" width={44} />
              <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip valueFormatter={(v) => percent(v)} />} />
              <Bar isAnimationActive={false} dataKey="established" name="Established" fill="var(--series-established)" radius={[4, 4, 0, 0]} />
              <Bar isAnimationActive={false} dataKey="thin_file" name="Thin-file" fill="var(--series-thin)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <p className="card-note">Bureau features have no thin-file bar — thin-file applicants have no bureau data at all.</p>
    </div>
  )
}

function TablesCard({ tables }) {
  return (
    <div className="card">
      <h2>Tables and depths</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Table</th><th className="num">Depth</th><th>Rows / loan</th><th className="num">Train rows</th></tr>
          </thead>
          <tbody>
            {tables.map((t) => (
              <tr key={t.table} title={t.description}>
                <td className="mono">{t.table}</td>
                <td className="num">{t.depth}</td>
                <td>{t.grain_rows_per_case}</td>
                <td className="num">{count(t.n_rows_train)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="card-note">Depth 0 joins directly on case_id. Depth 1–2 is aggregated to one row per loan first.</p>
    </div>
  )
}

function MissingCard({ rows }) {
  return (
    <div className="card">
      <h2>Most-missing features</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Feature</th><th className="num">All</th><th className="num">Established</th><th className="num">Thin-file</th></tr>
          </thead>
          <tbody>
            {rows.slice(0, 12).map((r) => (
              <tr key={r.feature}>
                <td className="mono">{r.feature}</td>
                <td className="num">{percent(r.all, 0)}</td>
                <td className="num">{percent(r.established, 0)}</td>
                <td className="num">{percent(r.thin_file, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="card-note">Missing values are kept: LightGBM handles them natively, logistic regression gets median + a missing flag.</p>
    </div>
  )
}
