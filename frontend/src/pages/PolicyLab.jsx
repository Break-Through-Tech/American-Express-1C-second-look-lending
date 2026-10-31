import { useEffect, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '../api.js'
import { ChartTooltip, ErrorBox, Legend, NoRuns, RunPicker } from '../components/ui.jsx'
import { useRuns } from '../components/useRuns.js'
import { money, percent, points } from '../format.js'

const POLICY_NAMES = {
  approve_all: 'Approve everyone (naïve)',
  baseline: 'Baseline: raw PD < 20%',
  calibrated_flat: 'Calibrated PD < 20%',
  second_look: 'Second-look policy',
}

const axisProps = { tick: { fontSize: 12, fill: 'var(--text-3)' }, stroke: 'var(--border)' }

export default function PolicyLab() {
  const { runs, selected, select, error: runsError } = useRuns()
  const [options, setOptions] = useState(null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Load the saved analysis whenever the run changes
  useEffect(() => {
    if (!selected) return
    setResult(null)
    setError(null)
    api.policy(selected).then((r) => {
      setResult(r)
      setOptions({ ...r.options, manual: false })
    }).catch(setError)
  }, [selected])

  const runAnalysis = async () => {
    setBusy(true)
    setError(null)
    try {
      const body = { ...options, thresholds: options.manual ? options.thresholds : null }
      const r = await api.updatePolicy(selected, body)
      setResult(r)
      setOptions({ ...r.options, manual: options.manual })
    } catch (e) {
      setError(e)
    }
    setBusy(false)
  }

  if (runsError) return <ErrorBox error={runsError} />
  if (!runs) return <div className="muted">Loading…</div>

  return (
    <>
      <div className="page-head">
        <h1>Policy lab</h1>
        <p>
          Turn PD into approve / deny. Repaid loan <strong>+$2,000</strong>, default <strong>−$8,000</strong>, denied $0
          → approve if PD &lt; 20%. The second-look policy calibrates PD per segment, corrects for drift, and tunes one
          threshold per segment on validation — then is scored once on the out-of-time test set.
        </p>
      </div>
      {runs.length === 0 ? <NoRuns /> : (
        <>
          <div className="card">
            <div className="row" style={{ marginBottom: 12 }}>
              <label className="field" style={{ minWidth: 280 }}>
                Model run
                <RunPicker runs={runs} value={selected} onChange={select} />
              </label>
            </div>
            {options && <Controls options={options} setOptions={setOptions} onRun={runAnalysis} busy={busy} />}
          </div>
          <ErrorBox error={error} />
          {result && <Results result={result} />}
        </>
      )}
    </>
  )
}

function Controls({ options, setOptions, onRun, busy }) {
  const set = (key, value) => setOptions({ ...options, [key]: value })
  const setThreshold = (segment, value) =>
    setOptions({ ...options, thresholds: { ...options.thresholds, [segment]: Number(value) } })

  return (
    <>
      <div className="grid grid-4">
        <label className="field">
          Calibration
          <select value={options.calibration} onChange={(e) => set('calibration', e.target.value)}>
            <option value="none">None (raw PD)</option>
            <option value="platt">Platt (logistic)</option>
            <option value="isotonic">Isotonic</option>
          </select>
        </label>
        <label className="field">
          Gap penalty ($ per point per 100k applicants)
          <input type="number" step={10000} min={0} value={options.penalty} onChange={(e) => set('penalty', Number(e.target.value))} />
        </label>
        <label className="field">
          Default-rate ceiling (approved loans)
          <input type="number" step={0.01} min={0.01} max={1} value={options.ceiling} onChange={(e) => set('ceiling', Number(e.target.value))} />
        </label>
        <div className="field" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <label className="check"><input type="checkbox" checked={options.per_segment} onChange={(e) => set('per_segment', e.target.checked)} /> Calibrate per segment</label>
          <label className="check"><input type="checkbox" checked={options.drift} onChange={(e) => set('drift', e.target.checked)} /> Drift correction</label>
        </div>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <label className="check">
          <input type="checkbox" checked={options.manual} onChange={(e) => set('manual', e.target.checked)} />
          Set thresholds by hand (otherwise they are optimized on validation)
        </label>
      </div>
      {options.manual && (
        <div className="grid grid-2" style={{ marginTop: 8 }}>
          <label className="field">
            Established threshold: {percent(options.thresholds.established)}
            <input type="range" min={0.05} max={0.5} step={0.005} value={options.thresholds.established} onChange={(e) => setThreshold('established', e.target.value)} />
          </label>
          <label className="field">
            Thin-file threshold: {percent(options.thresholds.thin_file)}
            <input type="range" min={0.05} max={0.5} step={0.005} value={options.thresholds.thin_file} onChange={(e) => setThreshold('thin_file', e.target.value)} />
          </label>
        </div>
      )}
      <button style={{ marginTop: 14 }} onClick={onRun} disabled={busy}>{busy ? 'Running…' : 'Run policy analysis'}</button>
    </>
  )
}

function Results({ result }) {
  const [split, setSplit] = useState('validation')
  const data = result[split]
  const base = data.baseline
  const second = data.second_look

  return (
    <>
      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Before / after</h2>
          <div className="spacer" />
          <div className="tabs">
            <button className={split === 'validation' ? 'active' : ''} onClick={() => setSplit('validation')}>Validation</button>
            <button className={split === 'test' ? 'active' : ''} onClick={() => setSplit('test')}>Test (final check)</button>
          </div>
        </div>
        <div className="compare">
          <PolicyCard title="Baseline policy" subtitle="One flat threshold on raw PD (20%)" policy={base} />
          <PolicyCard title="Second-look policy" subtitle={`Established < ${percent(second.thresholds.established)} · thin-file < ${percent(second.thresholds.thin_file)}`} policy={second} compareTo={base} highlight />
        </div>
        <p className="card-note">
          Inclusion gap = approval rate among applicants who actually repaid: established minus thin-file.
          Inclusive Profit Score = profit − penalty × |gap|, only if the default rate among approved loans is under the ceiling.
        </p>
      </div>

      <div className="grid grid-2">
        <GoodApprovalChart data={data} />
        <PolicyTable data={data} />
      </div>

      <div className="grid grid-2">
        <ProfitCurve result={result} />
        <GapCurve result={result} />
      </div>

      <div className="grid grid-2">
        <CalibrationChart result={result} />
        <CalibrationInfo result={result} />
      </div>
    </>
  )
}

function PolicyCard({ title, subtitle, policy, compareTo, highlight }) {
  const delta = (value, before, better, format) => {
    if (!compareTo || before == null || value == null) return null
    const diff = value - before
    const good = better === 'up' ? diff > 0 : diff < 0
    return <span className={good ? 'delta-good' : 'delta-bad'}> {diff > 0 ? '▲' : '▼'} {format(Math.abs(diff))}</span>
  }
  return (
    <div className={`compare-card ${highlight ? 'highlight' : ''}`}>
      <h2 style={{ marginBottom: 2 }}>{title}</h2>
      <p className="muted small">{subtitle}</p>
      <div className="grid grid-2" style={{ marginTop: 10 }}>
        <div>
          <div className="stat-label">Profit</div>
          <div className="big">{money(policy.profit)}</div>
          {delta(policy.profit, compareTo?.profit, 'up', money)}
        </div>
        <div>
          <div className="stat-label">Inclusion gap</div>
          <div className="big">{points(policy.inclusion_gap_pts)}</div>
          {compareTo && delta(Math.abs(policy.inclusion_gap_pts), Math.abs(compareTo.inclusion_gap_pts), 'down', points)}
        </div>
        <div>
          <div className="stat-label">Inclusive Profit Score</div>
          <div style={{ fontWeight: 600 }}>{policy.ceiling_ok ? money(policy.inclusive_profit_score) : <span className="badge warn">⚠ over ceiling</span>}</div>
        </div>
        <div>
          <div className="stat-label">Approved · default rate among approved</div>
          <div style={{ fontWeight: 600 }}>{percent(policy.approval_rate)} · {percent(policy.default_rate_approved)}</div>
        </div>
      </div>
    </div>
  )
}

function GoodApprovalChart({ data }) {
  const rows = ['baseline', 'calibrated_flat', 'second_look'].map((key) => ({
    policy: POLICY_NAMES[key].replace('Baseline: ', ''),
    established: data[key].segments.established.good_approval_rate,
    thin_file: data[key].segments.thin_file.good_approval_rate,
  }))
  return (
    <div className="card">
      <h2>Of applicants who repaid, what share got approved?</h2>
      <Legend items={[
        { label: 'Established', color: 'var(--series-established)', box: true },
        { label: 'Thin-file', color: 'var(--series-thin)', box: true },
      ]} />
      <div className="chart">
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barGap={2}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="policy" {...axisProps} interval={0} tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
            <YAxis domain={[0, 1]} tickFormatter={(v) => percent(v, 0)} {...axisProps} width={44} />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip valueFormatter={(v) => percent(v)} />} />
            <Bar isAnimationActive={false} dataKey="established" name="Established" fill="var(--series-established)" radius={[4, 4, 0, 0]} label={{ position: 'top', fontSize: 11, fill: 'var(--text-2)', formatter: (v) => percent(v, 0) }} />
            <Bar isAnimationActive={false} dataKey="thin_file" name="Thin-file" fill="var(--series-thin)" radius={[4, 4, 0, 0]} label={{ position: 'top', fontSize: 11, fill: 'var(--text-2)', formatter: (v) => percent(v, 0) }} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function PolicyTable({ data }) {
  return (
    <div className="card">
      <h2>All policies</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Policy</th>
              <th className="num">Profit</th>
              <th className="num">Gap</th>
              <th className="num">Approved</th>
              <th className="num">Default rate (approved)</th>
              <th className="num">Good thin-file denied</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(POLICY_NAMES).map(([key, label]) => {
              const p = data[key]
              return (
                <tr key={key} className={key === 'second_look' ? 'selected' : ''}>
                  <td>{label}</td>
                  <td className="num">{money(p.profit)}</td>
                  <td className="num">{points(p.inclusion_gap_pts)}</td>
                  <td className="num">{percent(p.approval_rate)}</td>
                  <td className="num">{percent(p.default_rate_approved)}</td>
                  <td className="num">{p.segments.thin_file.good_denied.toLocaleString()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="card-note">"Approve everyone" is the naïve baseline: it ignores the model and lends to all.</p>
    </div>
  )
}

function mergeCurves(result, field) {
  return result.profit_curve.raw.map((row, i) => ({
    threshold: row.threshold,
    raw: row[field],
    calibrated: result.profit_curve.calibrated[i][field],
  }))
}

const CURVE_LEGEND = [
  { label: 'Raw PD', color: 'var(--series-baseline)' },
  { label: 'Calibrated PD', color: 'var(--series-second-look)' },
]

function ProfitCurve({ result }) {
  return (
    <div className="card">
      <h2>Test profit vs one flat threshold</h2>
      <Legend items={CURVE_LEGEND} />
      <div className="chart">
        <ResponsiveContainer>
          <LineChart data={mergeCurves(result, 'profit')} margin={{ top: 20, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="threshold" tickFormatter={(v) => percent(v, 0)} {...axisProps} />
            <YAxis tickFormatter={money} {...axisProps} width={64} />
            <ReferenceLine x={0.2} stroke="var(--text-3)" strokeDasharray="4 4" label={{ value: '20%', fontSize: 11, fill: 'var(--text-3)', position: 'top' }} />
            <Tooltip content={<ChartTooltip labelFormatter={(t) => `Threshold ${percent(t, 0)}`} valueFormatter={money} />} />
            <Line isAnimationActive={false} dataKey="raw" name="Raw PD" stroke="var(--series-baseline)" strokeWidth={2} dot={false} />
            <Line isAnimationActive={false} dataKey="calibrated" name="Calibrated PD" stroke="var(--series-second-look)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="card-note">With well-calibrated PD the profit peak sits near the 20% break-even point.</p>
    </div>
  )
}

function GapCurve({ result }) {
  return (
    <div className="card">
      <h2>Test inclusion gap vs one flat threshold</h2>
      <Legend items={CURVE_LEGEND} />
      <div className="chart">
        <ResponsiveContainer>
          <LineChart data={mergeCurves(result, 'inclusion_gap_pts')} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="threshold" tickFormatter={(v) => percent(v, 0)} {...axisProps} />
            <YAxis tickFormatter={(v) => `${v.toFixed(0)}`} {...axisProps} width={44} />
            <ReferenceLine y={0} stroke="var(--text-3)" />
            <Tooltip content={<ChartTooltip labelFormatter={(t) => `Threshold ${percent(t, 0)}`} valueFormatter={points} />} />
            <Line isAnimationActive={false} dataKey="raw" name="Raw PD" stroke="var(--series-baseline)" strokeWidth={2} dot={false} />
            <Line isAnimationActive={false} dataKey="calibrated" name="Calibrated PD" stroke="var(--series-second-look)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="card-note">Gap in percentage points. Calibration alone already removes most of it.</p>
    </div>
  )
}

function CalibrationChart({ result }) {
  const [segment, setSegment] = useState('thin_file')
  const raw = result.calibration_table.raw[segment]
  const calibrated = result.calibration_table.calibrated[segment]
  const diagonal = [{ predicted: 0, actual: 0 }, { predicted: 0.7, actual: 0.7 }]

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Calibration on test</h2>
        <div className="spacer" />
        <div className="tabs">
          <button className={segment === 'thin_file' ? 'active' : ''} onClick={() => setSegment('thin_file')}>Thin-file</button>
          <button className={segment === 'established' ? 'active' : ''} onClick={() => setSegment('established')}>Established</button>
        </div>
      </div>
      <Legend items={[...CURVE_LEGEND, { label: 'Perfect calibration', color: 'var(--text-3)' }]} />
      <div className="chart">
        <ResponsiveContainer>
          <LineChart margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" />
            <XAxis type="number" dataKey="predicted" domain={[0, 0.7]} tickFormatter={(v) => percent(v, 0)} {...axisProps} />
            <YAxis type="number" dataKey="actual" domain={[0, 0.7]} tickFormatter={(v) => percent(v, 0)} {...axisProps} width={44} />
            <Tooltip content={<CalibrationTooltip />} />
            <Line isAnimationActive={false} data={diagonal} dataKey="actual" name="Perfect" stroke="var(--text-3)" strokeDasharray="4 4" dot={false} activeDot={false} />
            <Line isAnimationActive={false} data={raw} dataKey="actual" name="Raw PD" stroke="var(--series-baseline)" strokeWidth={2} dot={{ r: 4 }} />
            <Line isAnimationActive={false} data={calibrated} dataKey="actual" name="Calibrated PD" stroke="var(--series-second-look)" strokeWidth={2} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="card-note">Each dot is a PD decile: average predicted PD (x) vs actual default rate (y). Points below the line = model too pessimistic.</p>
    </div>
  )
}

function CalibrationTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const point = payload.find((p) => p.name !== 'Perfect') || payload[0]
  return (
    <div className="tooltip">
      <div className="tooltip-title">{point.name}</div>
      <div>Predicted: {percent(point.payload.predicted)}</div>
      <div>Actual: {percent(point.payload.actual)}</div>
    </div>
  )
}

function CalibrationInfo({ result }) {
  const c = result.calibrator
  const raw = result.test_metrics.raw
  const cal = result.test_metrics.calibrated
  return (
    <div className="card">
      <h2>What the second look changed</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Test set</th><th className="num">Mean PD raw</th><th className="num">Mean PD calibrated</th><th className="num">Actual default</th><th className="num">LogLoss raw → cal</th></tr>
          </thead>
          <tbody>
            {[['established', 'Established'], ['thin_file', 'Thin-file']].map(([key, label]) => (
              <tr key={key}>
                <td>{label}</td>
                <td className="num">{percent(raw[key].mean_pd)}</td>
                <td className="num">{percent(cal[key].mean_pd)}</td>
                <td className="num">{percent(raw[key].default_rate)}</td>
                <td className="num">{raw[key].logloss.toFixed(4)} → {cal[key].logloss.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 style={{ marginTop: 14 }}>Settings used</h3>
      <ul className="small" style={{ paddingLeft: 18, margin: 0, color: 'var(--text-2)' }}>
        <li>Calibration: <strong>{c.method}</strong>{c.per_segment ? ', fitted separately per segment' : ', one for everyone'} on validation weeks</li>
        <li>Drift correction: <strong>{c.drift ? 'on' : 'off'}</strong>{c.drift && ` — thin-file log-odds change ${c.trend_per_week.thin_file.toFixed(4)} per week, established ${c.trend_per_week.established.toFixed(4)}`}</li>
        <li>Thresholds: established <strong>{percent(result.options.thresholds.established)}</strong>, thin-file <strong>{percent(result.options.thresholds.thin_file)}</strong></li>
        <li>Penalty {money(result.options.penalty)} per gap point per 100k applicants · ceiling {percent(result.options.ceiling)}</li>
      </ul>
    </div>
  )
}
