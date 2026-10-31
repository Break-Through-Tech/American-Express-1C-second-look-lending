import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { ErrorBox, NoRuns } from '../components/ui.jsx'
import { useRuns } from '../components/useRuns.js'
import { money, number, points } from '../format.js'

export default function Models() {
  const { runs, selected, select, reload, error } = useRuns()
  const [split, setSplit] = useState('validation')

  if (error) return <ErrorBox error={error} />
  if (!runs) return <div className="muted">Loading…</div>

  const baselineAuc = runs.find((r) => r.model_type === 'logreg')?.metrics[split].all.auc

  return (
    <>
      <div className="page-head">
        <h1>Compare models</h1>
        <p>
          Each model outputs a probability of default (PD). Higher AUC = better ranking, lower LogLoss and Brier = better
          probabilities. Metrics are shown separately for thin-file applicants so the average never hides them.
        </p>
      </div>
      {runs.length === 0 ? <NoRuns /> : (
        <>
          <div className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>All runs</h2>
              <div className="spacer" />
              <div className="tabs">
                <button className={split === 'validation' ? 'active' : ''} onClick={() => setSplit('validation')}>Validation</button>
                <button className={split === 'test' ? 'active' : ''} onClick={() => setSplit('test')}>Test (final check)</button>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Run</th>
                    <th className="num">AUC</th>
                    <th className="num">vs LR</th>
                    <th className="num">LogLoss</th>
                    <th className="num">Brier</th>
                    <th className="num">AUC established</th>
                    <th className="num">AUC thin-file</th>
                    <th className="num">Second-look profit (test)</th>
                    <th className="num">Gap after (test)</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const m = run.metrics[split]
                    const diff = baselineAuc ? m.all.auc - baselineAuc : null
                    return (
                      <tr key={run.run_id} className={`clickable ${run.run_id === selected ? 'selected' : ''}`} onClick={() => select(run.run_id)}>
                        <td><strong>{run.name}</strong><div className="small muted">{run.model_name} · {run.created_at}</div></td>
                        <td className="num">{number(m.all.auc)}</td>
                        <td className="num">{diff == null || run.model_type === 'logreg' ? '—' : <span className={diff > 0 ? 'delta-good' : 'delta-bad'}>{diff > 0 ? '+' : ''}{diff.toFixed(4)}</span>}</td>
                        <td className="num">{number(m.all.logloss)}</td>
                        <td className="num">{number(m.all.brier)}</td>
                        <td className="num">{number(m.established.auc)}</td>
                        <td className="num">{number(m.thin_file.auc)}</td>
                        <td className="num">{money(run.policy_summary?.second_look_profit)}</td>
                        <td className="num">{points(run.policy_summary?.second_look_gap_pts)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="card-note">Click a row to see its details. Profit and gap are on the test set with the default policy settings.</p>
          </div>
          {selected && <RunDetail runId={selected} onDeleted={reload} />}
        </>
      )}
    </>
  )
}

function RunDetail({ runId, onDeleted }) {
  const [run, setRun] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    setRun(null)
    setError(null)
    api.run(runId).then(setRun).catch(setError)
  }, [runId])

  const remove = async () => {
    if (!window.confirm('Delete this run and its saved model?')) return
    await api.deleteRun(runId)
    onDeleted()
  }

  if (error) return <ErrorBox error={error} />
  if (!run) return null

  const maxImportance = run.feature_importance[0]?.importance || 1

  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>{run.name}</h2>
          <div className="spacer" />
          <button className="danger chip" onClick={remove}>Delete</button>
        </div>
        <p className="muted small">
          {run.model_name} · trained on {run.n_train.toLocaleString()} rows · {run.n_features} features · {run.train_seconds}s
          {run.best_iteration && ` · ${run.best_iteration} trees`}
        </p>
        <SegmentTable title={`Validation (policy weeks ${run.settings.policy_start_week ?? 80}–91, never seen by the model)`} metrics={run.metrics.validation} />
        <SegmentTable title="Out-of-time test" metrics={run.metrics.test} />
        <h3>Hyperparameters</h3>
        <div className="mono small">
          {Object.entries(run.params).map(([k, v]) => <div key={k}>{k}: {String(v)}</div>)}
        </div>
      </div>

      <div className="card">
        <h2>Top features</h2>
        <div className="bar-list">
          {run.feature_importance.map((f) => (
            <div className="bar-item" key={f.feature}>
              <span className="label mono" title={f.feature}>{f.feature}</span>
              <div className="track"><div className="fill" style={{ width: `${(f.importance / maxImportance) * 100}%` }} /></div>
              <span className="num">{(f.importance * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
        <p className="card-note">
          {run.model_type === 'logreg' ? 'Share of total |coefficient| (scaled inputs).' : 'Share of total importance (gain for LightGBM).'}
        </p>
      </div>
    </div>
  )
}

function SegmentTable({ title, metrics }) {
  return (
    <>
      <h3 style={{ marginTop: 12 }}>{title}</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Segment</th><th className="num">AUC</th><th className="num">LogLoss</th><th className="num">Brier</th><th className="num">Mean PD</th><th className="num">Actual default</th></tr>
          </thead>
          <tbody>
            {[['all', 'All'], ['established', 'Established'], ['thin_file', 'Thin-file']].map(([key, label]) => (
              <tr key={key}>
                <td>{label}</td>
                <td className="num">{number(metrics[key].auc)}</td>
                <td className="num">{number(metrics[key].logloss)}</td>
                <td className="num">{number(metrics[key].brier)}</td>
                <td className="num">{(metrics[key].mean_pd * 100).toFixed(1)}%</td>
                <td className="num">{(metrics[key].default_rate * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
