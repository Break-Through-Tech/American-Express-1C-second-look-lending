import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../../api.js'
import { ChartTooltip, ErrorBox, Legend, Stat } from '../../components/ui.jsx'
import { count, percent } from '../../format.js'

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
        <h1>Data overview</h1>
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

      <DataFlow data={data} />
      <TrainingData />

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

      <MissingCard rows={data.missing} />
      <p className="small muted">How the 8 tables fit together, their columns and sample rows: <Link to="/tech/insights">Insights → Raw data</Link>.</p>
    </>
  )
}

// What each time window is used for, and its color in the flow
const WINDOW_INFO = {
  fit: { color: 'var(--series-established)', use: 'The model learns from these rows' },
  model_validation: { color: 'var(--series-second-look)', use: 'Early stopping and Optuna tuning' },
  policy_validation: { color: 'var(--series-thin)', use: 'Calibration, drift correction and cut-offs' },
  test: { color: 'var(--series-baseline)', use: 'Scored once at the end, never used to choose anything' },
}

function DataFlow({ data }) {
  const totalWeeks = data.test_weeks[1] + 1
  const trainRows = data.windows.filter((w) => w.key !== 'test').reduce((sum, w) => sum + w.rows, 0)
  return (
    <div className="card">
      <h2>How the data flows into training</h2>
      <div className="data-flow">
        <div className="data-flow-box">
          <span className="flow-step">1 · Raw data</span>
          <strong>{data.raw_tables} CSV tables</strong>
          <span>base, applicant, people, credit bureau, payments, earlier applications, tax records</span>
        </div>
        <span className="connect-arrow" aria-hidden="true">→</span>
        <div className="data-flow-box">
          <span className="flow-step">2 · Feature table</span>
          <strong>1 row per loan · {data.feature_count} features</strong>
          <span>many-row tables are summed up per loan (count, mean, max…) and joined on case_id</span>
        </div>
        <span className="connect-arrow" aria-hidden="true">→</span>
        <div className="data-flow-box">
          <span className="flow-step">3 · Split by week</span>
          <strong>{count(trainRows)} train + {count(data.test_loans)} test rows</strong>
          <span>older weeks to learn, newer weeks to check, so nothing is judged on data it learned from</span>
        </div>
      </div>

      <div className="timeline" role="img" aria-label="Weeks used by each window">
        {data.windows.map((w) => (
          <div key={w.key} style={{ flex: w.weeks[1] - w.weeks[0] + 1, background: WINDOW_INFO[w.key].color }}>
            <span>{w.weeks[0]}–{w.weeks[1]}</span>
          </div>
        ))}
      </div>
      <p className="small muted" style={{ margin: '4px 0 12px' }}>Weeks 0–{totalWeeks - 1}, oldest on the left. Bar width = number of weeks.</p>

      <div className="grid grid-4">
        {data.windows.map((w) => (
          <div key={w.key} className="window-card" style={{ '--window': WINDOW_INFO[w.key].color }}>
            <span className="window-name">{w.label}</span>
            <strong>{count(w.rows)} rows</strong>
            <span className="small muted">weeks {w.weeks[0]}–{w.weeks[1]} · {percent(w.default_rate)} defaulted · {percent(w.thin_file_share, 0)} first-time</span>
            <span className="small">{WINDOW_INFO[w.key].use}</span>
          </div>
        ))}
      </div>

      <details className="faq" style={{ marginTop: 12 }}>
        <summary>Why split by week, and why three training windows?</summary>
        <p>
          <strong>By week, not at random:</strong> lending predicts the future from the past. A random split would mix
          next month's loans into training, hide the drift (first-time borrowers get less risky every week) and make the
          scores look better than they really are.
        </p>
        <p>
          <strong>Three windows, one job each:</strong> the model <em>learns</em> on weeks 0–79. Weeks 80–85 decide when to
          stop adding trees and which settings are best. The finished model is then calibrated and its cut-offs chosen on
          weeks 86–91, which it has never seen; reusing 80–85 would make the policy look better than it is. Test weeks
          92–107 are scored once at the end, so the reported results are honest.
        </p>
      </details>
    </div>
  )
}

const SAMPLE_PAGE = 10

// The tables training uses, in the order they are joined
const RAW_TABLES = ['base', 'static_0', 'static_cb_0', 'person_1', 'credit_bureau_a_1', 'credit_bureau_a_2', 'applprev_1', 'tax_registry_a_1']

function TrainingData() {
  const [view, setView] = useState('features')
  const [loanId, setLoanId] = useState('')

  // Clicking a loan in the feature table shows that loan's raw rows
  const followLoan = (caseId) => { setLoanId(String(caseId)); setView('base') }

  return (
    <div className="card">
      <h2>Training data — 8 raw tables and the feature table built from them</h2>
      <p className="small muted">
        The model is trained on the <strong>feature table</strong>: one row per loan, made by joining and summing up the
        8 raw tables on <code>case_id</code>. Open any raw table to see the rows it starts from. Hover a column name to see
        what it means.
      </p>
      <div className="table-tabs" role="tablist">
        <button role="tab" className={view === 'features' ? 'active' : ''} onClick={() => setView('features')}>
          Feature table <span>what the model sees</span>
        </button>
        {RAW_TABLES.map((name) => (
          <button key={name} role="tab" className={view === name ? 'active' : ''} onClick={() => setView(name)}>
            {name} <span>raw</span>
          </button>
        ))}
      </div>
      {view === 'features'
        ? <FeatureTableView onFollowLoan={followLoan} />
        : <RawTableView key={view} name={view} loanId={loanId} setLoanId={setLoanId} />}
    </div>
  )
}

function FeatureTableView({ onFollowLoan }) {
  const [filters, setFilters] = useState({ window: '', segment: '', outcome: '' })
  const [allColumns, setAllColumns] = useState(false)
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    const params = { offset, limit: SAMPLE_PAGE, all_columns: allColumns }
    Object.entries(filters).forEach(([key, value]) => { if (value) params[key] = value })
    api.trainingSample(params).then(setData).catch(setError)
  }, [filters, allColumns, offset])

  const setFilter = (key) => (e) => { setOffset(0); setFilters({ ...filters, [key]: e.target.value }) }

  return (
    <>
      <p className="small muted">
        <strong>target</strong> is the answer the model learns to predict (1 = defaulted). Click a case_id to see that
        loan's rows in the raw tables.
      </p>
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={filters.window} onChange={setFilter('window')} aria-label="Time window">
          <option value="">All train weeks (0–91)</option>
          <option value="fit">Fit the model (0–79)</option>
          <option value="model_validation">Model validation (80–85)</option>
          <option value="policy_validation">Policy validation (86–91)</option>
        </select>
        <select value={filters.segment} onChange={setFilter('segment')} aria-label="Borrower type">
          <option value="">All borrowers</option>
          <option value="established">Established</option>
          <option value="thin_file">First-time (thin-file)</option>
        </select>
        <select value={filters.outcome} onChange={setFilter('outcome')} aria-label="Outcome">
          <option value="">Repaid and defaulted</option>
          <option value="repaid">Repaid (target = 0)</option>
          <option value="defaulted">Defaulted (target = 1)</option>
        </select>
        <label className="check">
          <input type="checkbox" checked={allColumns} onChange={(e) => setAllColumns(e.target.checked)} />
          Show all features
        </label>
      </div>
      <DataTable data={data} error={error} offset={offset} setOffset={setOffset} onFollowLoan={onFollowLoan} />
    </>
  )
}

function RawTableView({ name, loanId, setLoanId }) {
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    setError(null)
    const params = { offset, limit: SAMPLE_PAGE }
    if (/^\d+$/.test(loanId)) params.case_id = loanId
    api.rawTable(name, params).then(setData).catch(setError)
  }, [name, loanId, offset])

  return (
    <>
      {data && <p className="small"><strong>{data.title}.</strong> <span className="muted">{data.what}</span></p>}
      <div className="row" style={{ marginBottom: 12 }}>
        <input value={loanId} onChange={(e) => { setOffset(0); setLoanId(e.target.value.trim()) }}
          placeholder="Show one loan: case_id" inputMode="numeric" style={{ width: 200 }} aria-label="Loan id" />
        {loanId && <button className="chip" onClick={() => { setOffset(0); setLoanId('') }}>Show all loans</button>}
        {loanId && data && <span className="small muted">{count(data.total)} row(s) for loan {loanId} in this table</span>}
      </div>
      <DataTable data={data} error={error} offset={offset} setOffset={setOffset}
        empty={loanId ? `Loan ${loanId} has no rows in ${name} — for bureau tables that means a first-time borrower.` : 'No rows.'} />
    </>
  )
}

function DataTable({ data, error, offset, setOffset, onFollowLoan, empty }) {
  if (error) return <ErrorBox error={error} />
  if (!data) return <p className="muted">Loading…</p>
  if (data.total === 0) return <p className="muted">{empty || 'No rows.'}</p>
  return (
    <>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>{data.columns.map((c) => <th key={c.name} title={c.description} className="mono">{c.name}</th>)}</tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => (
              <tr key={i}>
                {data.columns.map((c) => (
                  <td key={c.name}>
                    {c.name === 'case_id' && onFollowLoan
                      ? <button className="link-button" onClick={() => onFollowLoan(row.case_id)}>{row.case_id}</button>
                      : <Cell name={c.name} value={row[c.name]} />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="chip" disabled={offset === 0} onClick={() => setOffset(offset - SAMPLE_PAGE)}>← Previous</button>
        <span className="small muted">
          Rows {count(offset + 1)}–{count(Math.min(offset + SAMPLE_PAGE, data.total))} of {count(data.total)} · {data.columns.length} columns
        </span>
        <button className="chip" disabled={offset + SAMPLE_PAGE >= data.total} onClick={() => setOffset(offset + SAMPLE_PAGE)}>Next →</button>
      </div>
    </>
  )
}

function Cell({ name, value }) {
  if (value == null) return <span className="missing-cell">missing</span>
  if (name === 'target') return value ? <span className="badge bad">1 · defaulted</span> : <span className="badge good">0 · repaid</span>
  if (name === 'thin_file') return value ? <span className="badge warn">1 · first-time</span> : <span className="badge neutral">0 · established</span>
  if (typeof value === 'number' && !Number.isInteger(value)) return Math.abs(value) >= 100 ? Math.round(value).toLocaleString() : value.toFixed(2)
  if (typeof value === 'number' && !['case_id', 'WEEK_NUM', 'MONTH'].includes(name) && !name.startsWith('num_group')) return value.toLocaleString()
  return String(value)
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
