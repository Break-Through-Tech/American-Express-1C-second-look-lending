import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api.js'
import { Decision, ErrorBox, NoRuns, RunPicker } from '../components/ui.jsx'
import { useRuns } from '../components/useRuns.js'
import { money, percent } from '../format.js'

const FIELD_LABELS = {
  mainoccupationinc_384A: 'Stated income',
  credamount_770A: 'Credit requested',
  annuity_780A: 'Periodic payment (annuity)',
  days_employed_700P: 'Days employed',
  age_years: 'Age (years)',
  riskassesment_940T: 'Bureau risk score',
  numberofqueries_146L: 'Recent credit queries',
  bureau_pmts_dpdvalue_108P_max: 'Worst days past due',
  prev_app_count: 'Prior applications',
  tax_amount_4527230A_mean: 'Declared tax income',
}

export default function Applicant() {
  const { runs, selected, select, error: runsError } = useRuns()
  const [samples, setSamples] = useState([])
  const [caseId, setCaseId] = useState('')
  const [result, setResult] = useState(null)
  const [changes, setChanges] = useState({})
  const [error, setError] = useState(null)

  useEffect(() => {
    api.randomApplicants().then(setSamples).catch(setError)
  }, [])

  // Support links like /applicant?case=1000001
  const [searchParams] = useSearchParams()
  useEffect(() => {
    const fromUrl = searchParams.get('case')
    if (fromUrl && selected && !result) lookUp(fromUrl)
  }, [selected])

  const score = async (id, whatIf = {}) => {
    setError(null)
    try {
      setResult(await api.score(selected, Number(id), whatIf))
    } catch (e) {
      setError(e)
    }
  }

  const lookUp = (id) => {
    setCaseId(String(id))
    setChanges({})
    score(id)
  }

  // Re-score when another model is picked
  useEffect(() => {
    if (result && selected) score(result.case_id, changes)
  }, [selected])

  if (runsError) return <ErrorBox error={runsError} />
  if (!runs) return <div className="muted">Loading…</div>

  return (
    <>
      <div className="page-head">
        <h1>Score an applicant</h1>
        <p>
          Look up any loan by case_id (test ids start at 1,000,001), see both decisions side by side, and try what-if
          changes to see how the PD moves.
        </p>
      </div>
      {runs.length === 0 ? <NoRuns /> : (
        <>
          <div className="card">
            <div className="row">
              <label className="field" style={{ minWidth: 260 }}>
                Model run
                <RunPicker runs={runs} value={selected} onChange={select} />
              </label>
              <label className="field">
                case_id
                <input value={caseId} onChange={(e) => setCaseId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lookUp(caseId)} placeholder="1000001" />
              </label>
              <button style={{ alignSelf: 'flex-end' }} onClick={() => lookUp(caseId)} disabled={!caseId}>Score</button>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <span className="small muted">Random test applicants:</span>
              {samples.map((s) => (
                <button key={s.case_id} className="chip" onClick={() => lookUp(s.case_id)}>
                  {s.case_id} {s.thin_file ? '· thin' : ''}
                </button>
              ))}
            </div>
          </div>
          <ErrorBox error={error} />
          {result && (
            <ApplicantResult
              result={result}
              changes={changes}
              setChanges={setChanges}
              onWhatIf={() => score(result.case_id, changes)}
              onReset={() => lookUp(result.case_id)}
            />
          )}
        </>
      )}
    </>
  )
}

function ApplicantResult({ result, changes, setChanges, onWhatIf, onReset }) {
  const outcome = result.actual_default == null
    ? <span className="badge neutral">unknown</span>
    : result.actual_default === 1
      ? <span className="badge bad">✕ Defaulted</span>
      : <span className="badge good">✓ Repaid</span>

  return (
    <>
      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Applicant {result.case_id}</h2>
          <span className={`badge ${result.thin_file ? 'warn' : 'neutral'}`}>{result.thin_file ? 'Thin-file' : 'Established'}</span>
          <span className="muted small">{result.split} set · week {result.week}</span>
          <div className="spacer" />
          <span className="small muted">Actual outcome:</span> {outcome}
        </div>
        <div className="compare">
          <div className="compare-card">
            <h3>Baseline policy</h3>
            <div className="big">{percent(result.pd_raw)}</div>
            <div className="small muted">raw PD · threshold {percent(result.baseline.threshold)}</div>
            <div className="row" style={{ marginTop: 8 }}>
              <Decision approve={result.baseline.approve} />
              <span className="small muted">expected value {money(result.baseline.expected_value)}</span>
            </div>
          </div>
          <div className="compare-card highlight">
            <h3>Second-look policy</h3>
            <div className="big">{percent(result.pd_calibrated)}</div>
            <div className="small muted">calibrated PD · threshold {percent(result.second_look.threshold)}</div>
            <div className="row" style={{ marginTop: 8 }}>
              <Decision approve={result.second_look.approve} />
              <span className="small muted">expected value {money(result.second_look.expected_value)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>What-if</h2>
          <div className="grid grid-2">
            {Object.entries(result.editable).map(([field, value]) => (
              <label className="field" key={field}>
                {FIELD_LABELS[field] || field}
                <input
                  type="number"
                  step="any"
                  value={field in changes ? (changes[field] ?? '') : (value ?? '')}
                  placeholder="missing"
                  onChange={(e) => setChanges({ ...changes, [field]: e.target.value === '' ? null : Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={onWhatIf}>Re-score</button>
            <button className="secondary" onClick={onReset}>Reset</button>
          </div>
          <h3 style={{ marginTop: 16 }}>Profile</h3>
          <div className="mono small">
            {Object.entries(result.profile).map(([k, v]) => (
              <div key={k}>{k}: {typeof v === 'number' ? Number(v.toFixed(4)) : String(v)}</div>
            ))}
          </div>
        </div>
        <Reasons reasons={result.reasons} />
      </div>
    </>
  )
}

function Reasons({ reasons }) {
  if (!reasons.length) {
    return (
      <div className="card">
        <h2>Why this score</h2>
        <p className="muted">Per-applicant reasons are available for LightGBM runs (SHAP values). Pick a LightGBM run to see them.</p>
      </div>
    )
  }
  const largest = Math.max(...reasons.map((r) => Math.abs(r.contribution)))
  return (
    <div className="card">
      <h2>Why this score</h2>
      <p className="small muted">How much each feature pushed the risk up (red) or down (green), in log-odds.</p>
      <div className="bar-list">
        {reasons.map((r) => (
          <div className="bar-item" key={r.feature}>
            <span className="label" title={r.feature}>
              <span className="mono">{r.feature}</span>
              <span className="muted"> = {r.value == null ? 'missing' : typeof r.value === 'number' ? Number(r.value.toFixed(3)) : r.value}</span>
            </span>
            <div className="track">
              <div className="fill" style={{
                width: `${(Math.abs(r.contribution) / largest) * 100}%`,
                background: r.contribution > 0 ? 'var(--bad)' : 'var(--good)',
              }} />
            </div>
            <span className={r.contribution > 0 ? 'delta-bad' : 'delta-good'}>
              {r.contribution > 0 ? '▲ +' : '▼ '}{r.contribution.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
