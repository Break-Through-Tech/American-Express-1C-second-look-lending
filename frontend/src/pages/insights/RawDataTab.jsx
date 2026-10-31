import { useEffect, useState } from 'react'
import { api } from '../../api.js'
import { ErrorBox, Stat } from '../../components/ui.jsx'
import { count, percent } from '../../format.js'

const DEPTH_HELP = {
  0: 'Depth 0 — one row per loan. Join straight onto base.',
  1: 'Depth 1 — many rows per loan. Aggregate first (count, average, max…).',
  2: 'Depth 2 — rows inside rows (contract → month). Aggregate first.',
}

export default function RawDataTab() {
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState('credit_bureau_a_1')
  const [error, setError] = useState(null)

  useEffect(() => {
    api.rawInsights().then(setData).catch(setError)
  }, [])

  if (error) return <ErrorBox error={error} />
  if (!data) return <div className="card muted">Reading all 8 raw tables (about 5 seconds the first time)…</div>

  const table = data.tables.find((t) => t.name === selected)

  return (
    <>
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Raw rows in 8 tables" value={count(data.raw_rows)} hint="train files only" />
        <Stat label="Loans (one row each after joining)" value={count(data.loans)} />
        <Stat label="Model features per loan" value={data.feature_count} hint="built in features.py" />
        <Stat label="Thin-file applicants" value={percent(data.thin_file_share)} hint="no credit-bureau contracts" />
      </div>

      <TableMap tables={data.tables} selected={selected} onSelect={setSelected} table={table} />
      <SuffixLegend suffixes={data.suffixes} />
      <TableDetail table={table} />
      <FollowApplicant examples={data.examples} />
      <Takeaways />
    </>
  )
}

function TableMap({ tables, selected, onSelect, table }) {
  const box = (t) => (
    <button
      key={t.name}
      className={`table-box ${t.name === selected ? 'selected' : ''} ${t.name.startsWith('credit_bureau') || t.name === 'static_cb_0' ? 'bureau' : ''}`}
      onClick={() => onSelect(t.name)}
    >
      <span className="mono">{t.name}</span>
      <span className="small muted">{t.title} · {percent(t.loans_covered, 0)} of loans</span>
    </button>
  )
  return (
    <div className="card">
      <h2>1. How the tables fit together</h2>
      <p className="muted">
        Every table links to <span className="mono">base</span> through <span className="mono">case_id</span>.
        Click a table to see 5 of its records below. Orange tables are the credit bureau: thin-file applicants have no rows there.
      </p>
      <div className="table-map">
        <div className="table-map-col">
          <div className="small muted">Depth 0 · join directly</div>
          {tables.filter((t) => t.depth === 0 && t.name !== 'base').map(box)}
        </div>
        <div className="table-map-arrow">→</div>
        <div className="table-map-col center">
          <div className="small muted">The spine</div>
          {tables.filter((t) => t.name === 'base').map(box)}
        </div>
        <div className="table-map-arrow">←</div>
        <div className="table-map-col">
          <div className="small muted">Depth 1–2 · aggregate per case_id first</div>
          {tables.filter((t) => t.depth > 0).map(box)}
        </div>
      </div>

      <div className="table-preview">
        <h3>
          First 5 records of <span className="mono">{table.name}</span>
          <span className="small muted"> · {count(table.rows)} rows in total</span>
        </h3>
        <RowsTable rows={table.sample} />
        {table.depth > 0 && (
          <p className="small muted" style={{ marginTop: 6 }}>
            Notice <span className="mono">case_id</span> repeats: one loan has several rows here
            (<span className="mono">num_group1</span> numbers them), so this table is aggregated before joining.
          </p>
        )}
      </div>
    </div>
  )
}

function SuffixLegend({ suffixes }) {
  return (
    <div className="card">
      <h2>2. Read a column name from its last letter</h2>
      <p className="muted">Column names are anonymized, but the last letter tells you the type. Example: <span className="mono">credamount_770<strong>A</strong></span> is an amount of money.</p>
      <div className="row">
        {Object.entries(suffixes).map(([letter, meaning]) => (
          <span key={letter} className="suffix-chip"><strong className="mono">…{letter}</strong> {meaning}</span>
        ))}
      </div>
    </div>
  )
}

function TableDetail({ table }) {
  return (
    <div className="card">
      <h2>3. Inside <span className="mono">{table.name}</span> — {table.title}</h2>
      <p>{table.what}</p>
      <p className="muted"><strong>Why it matters:</strong> {table.why}</p>
      <p className="small muted">{DEPTH_HELP[table.depth]}</p>

      <div className="grid grid-4" style={{ margin: '12px 0 16px' }}>
        <Stat label="Rows" value={count(table.rows)} />
        <Stat label="Loans that have rows here" value={percent(table.loans_covered)} />
        <Stat label="Rows per loan (average)" value={table.rows_per_loan_mean.toFixed(2)} />
        <Stat label="Rows per loan (most)" value={table.rows_per_loan_max} />
      </div>

      <h3>Columns</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Column</th><th>Type</th><th>Meaning</th><th className="num">Missing</th><th>Values</th></tr>
          </thead>
          <tbody>
            {table.columns.map((c) => (
              <tr key={c.name}>
                <td className="mono">{c.name}</td>
                <td>{c.suffix ? <span className="badge neutral" title={c.suffix_meaning}>…{c.suffix} {c.kind}</span> : <span className="small muted">{c.kind}</span>}</td>
                <td style={{ whiteSpace: 'normal', minWidth: 220 }}>{c.description}</td>
                <td className="num">{percent(c.missing, 0)}</td>
                <td style={{ whiteSpace: 'normal', minWidth: 180 }} className="small">{valueSummary(c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  )
}

function valueSummary(column) {
  if (column.kind === 'number') {
    return `min ${formatValue(column.min)} · median ${formatValue(column.median)} · max ${formatValue(column.max)}`
  }
  if (column.kind === 'date') return `${column.first} → ${column.last}`
  const top = column.top.map((t) => `${t.value} (${percent(t.share, 0)})`).join(', ')
  return `${column.levels} values. Most common: ${top}`
}

function formatValue(value) {
  if (value == null) return 'missing'
  if (typeof value !== 'number') return String(value)
  return Number.isInteger(value) ? value.toLocaleString() : Number(value.toFixed(3)).toLocaleString()
}

function RowsTable({ rows }) {
  if (rows.length === 0) return <p className="muted small">No rows.</p>
  const columns = Object.keys(rows[0])
  return (
    <div className="table-wrap">
      <table className="compact">
        <thead><tr>{columns.map((c) => <th key={c} className="mono">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c} className={row[c] == null ? 'missing-cell' : ''}>{formatValue(row[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FollowApplicant({ examples }) {
  const [kind, setKind] = useState('established')
  const example = examples[kind]
  const totalRows = Object.values(example.tables).reduce((sum, rows) => sum + rows.length, 0)

  // Group the feature row by source table
  const groups = {}
  for (const f of example.features) {
    groups[f.source] = groups[f.source] || []
    groups[f.source].push(f)
  }

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>4. Follow one applicant from raw rows to one feature row</h2>
        <div className="spacer" />
        <div className="tabs">
          <button className={kind === 'established' ? 'active' : ''} onClick={() => setKind('established')}>Established applicant</button>
          <button className={kind === 'thin_file' ? 'active' : ''} onClick={() => setKind('thin_file')}>Thin-file applicant</button>
        </div>
      </div>
      <p className="muted">
        Applicant <span className="mono">case_id = {example.case_id}</span> has <strong>{totalRows} raw rows</strong> spread
        over 8 tables. Outcome: {example.defaulted ? <span className="badge bad">✕ defaulted</span> : <span className="badge good">✓ repaid</span>}
      </p>

      {Object.entries(example.tables).map(([name, rows]) => (
        <details key={name} className="example-table" open={['credit_bureau_a_1', 'applprev_1'].includes(name)}>
          <summary>
            <span className="mono">{name}</span>
            <span className={`badge ${rows.length === 0 ? 'warn' : 'neutral'}`}>{rows.length} row{rows.length === 1 ? '' : 's'}</span>
            {rows.length === 0 && name.includes('bureau') && <span className="small muted">no credit history — this is what makes them thin-file</span>}
          </summary>
          <RowsTable rows={rows} />
        </details>
      ))}

      <div className="aggregate-arrow">↓ aggregate each table per case_id (count, average, max, sum…) and join onto base ↓</div>

      <h3>The single row the model sees ({example.features.length} features)</h3>
      <p className="small muted">Grey values are missing. For a thin-file applicant every bureau feature is missing — the model has to rely on the rest.</p>
      <div className="feature-groups">
        {Object.entries(groups).map(([source, items]) => (
          <div key={source} className="feature-group">
            <div className="feature-group-title mono">{source}</div>
            {items.map((f) => (
              <div key={f.feature} className="feature-line" title={f.meaning}>
                <span className="mono">{f.feature}</span>
                <span className={f.value == null ? 'missing-cell' : ''}>{formatValue(f.value)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function Takeaways() {
  return (
    <div className="card">
      <h2>5. What to remember about the data</h2>
      <ul className="takeaways">
        <li><strong>One row per loan is the goal.</strong> Depth-0 tables join directly; depth-1/2 tables are squashed per case_id first.</li>
        <li><strong>Thin-file = no rows in credit_bureau_a_1.</strong> About 30% of applicants. They also miss static_cb_0 and credit_bureau_a_2.</li>
        <li><strong>Missing is information, not an error.</strong> Most missing values are thin-file applicants having no bureau data, so we keep them.</li>
        <li><strong>The bureau tables carry the strongest signal</strong> (risk score, days past due). Without them the model leans on income, employment, earlier applications and tax records.</li>
        <li><strong>Time matters.</strong> Thin-file default risk falls over the weeks (see Overview), so we always split train / validation / test by week, never at random.</li>
      </ul>
    </div>
  )
}
