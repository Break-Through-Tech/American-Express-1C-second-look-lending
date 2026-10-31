import { Link } from 'react-router-dom'

// Small shared UI pieces

export function Stat({ label, value, hint }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  )
}

export function ErrorBox({ error }) {
  if (!error) return null
  return <div className="error">{String(error.message || error)}</div>
}

export function Legend({ items }) {
  return (
    <div className="legend">
      {items.map((item) => (
        <span key={item.label}>
          <i className={item.box ? 'box' : ''} style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  )
}

// Tooltip shared by all the Recharts charts
export function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter }) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="tooltip">
      <div className="tooltip-title">{labelFormatter ? labelFormatter(label) : label}</div>
      {payload.map((item) => (
        <div className="tooltip-row" key={item.dataKey}>
          <span><i style={{ background: item.color }} />{item.name}</span>
          <strong>{valueFormatter ? valueFormatter(item.value) : item.value}</strong>
        </div>
      ))}
    </div>
  )
}

export function Decision({ approve }) {
  return approve
    ? <span className="badge good">✓ Approve</span>
    : <span className="badge bad">✕ Deny</span>
}

export function RunPicker({ runs, value, onChange }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
      {runs.map((run) => (
        <option key={run.run_id} value={run.run_id}>
          {run.name} — validation AUC {run.metrics.validation.all.auc.toFixed(4)}
        </option>
      ))}
    </select>
  )
}

export function NoRuns() {
  return (
    <div className="card empty">
      <h2>No trained models yet</h2>
      <p>Go to <Link to="/train">Train models</Link> and train your first model.</p>
    </div>
  )
}

// ⓘ icon that shows its text on hover or keyboard focus
export function InfoTip({ children }) {
  return (
    <span className="infotip" tabIndex={0} aria-label="More information">
      ⓘ
      <span className="infotip-text" role="tooltip">{children}</span>
    </span>
  )
}
