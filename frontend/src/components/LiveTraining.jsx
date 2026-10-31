import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api.js'
import { ChartTooltip, Legend } from './ui.jsx'
import { count } from '../format.js'

// Plain-English line for each training step
const STEP_HELP = [
  'Reading the feature table: one row per loan with 53 features (built once from the raw CSV files, then cached).',
  'Splitting the train file by week: fit the model on early weeks, check it on later weeks it has not seen.',
  'Optuna tries different settings. Each trial trains a quick model on a 25% sample and scores it on the model-validation weeks. It learns from earlier trials which settings look promising.',
  'Training the final model on all fit weeks.',
  'The finished model predicts a PD for every loan in the policy-validation weeks and in the test file.',
  'Calibrating PDs per segment, correcting for drift and choosing the approve / deny thresholds on the policy-validation weeks.',
  'Done. The run is saved and appears in Compare models, Policy lab and Insights.',
]

const TRAINING_HELP = {
  lightgbm: 'LightGBM adds one small tree at a time. Each tree fixes some of the mistakes the earlier trees still make. '
    + 'The line shows validation AUC after every tree. When 100 trees in a row bring no improvement, early stopping ends training '
    + 'and keeps the best point (the dashed line).',
  random_forest: 'Random Forest grows independent trees, each on a random 30% of the loans, and averages them. '
    + 'We grow 20 trees at a time and check validation AUC after each batch: it climbs quickly, then flattens once '
    + 'extra trees stop changing the average.',
  logreg: 'Logistic regression has no trees. It solves for one weight per feature in a single optimization '
    + '(the solver takes up to 300 small steps internally), so there is no curve to draw — it is usually done in a few seconds.',
}

const axisProps = { tick: { fontSize: 12, fill: 'var(--text-3)' }, stroke: 'var(--border)' }

export default function LiveTraining({ jobId }) {
  const [job, setJob] = useState(null)
  const [showLog, setShowLog] = useState(false)

  // Poll every second until the job finishes
  useEffect(() => {
    let timer
    const load = () => api.job(jobId).then((j) => {
      setJob(j)
      if (j.status === 'queued' || j.status === 'running') timer = setTimeout(load, 1000)
    })
    load()
    return () => clearTimeout(timer)
  }, [jobId])

  if (!job) return null
  const live = job.live || {}
  const settings = job.settings || {}
  const steps = live.steps || []
  const currentStep = job.status === 'done' ? steps.length : live.step ?? -1

  return (
    <div className="card live">
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Watching: {settings.name || settings.model_type}</h2>
        <span className={`badge ${{ done: 'good', failed: 'bad', running: 'warn', queued: 'neutral' }[job.status]}`}>{job.status}</span>
        <div className="spacer" />
        {job.status === 'done' && live.result && (
          <>
            <Link to="/models">Compare models →</Link>
            <Link to={`/insights?tab=model&run=${live.result.run_id}`}>Explain this model →</Link>
          </>
        )}
      </div>

      {job.status === 'queued' && <p className="muted">Waiting for the job before it to finish (one training at a time).</p>}
      {job.error && <div className="error">{job.error}</div>}

      <StepTracker steps={steps} current={currentStep} skipped={live.skipped || []} failed={job.status === 'failed'} />
      {currentStep >= 0 && currentStep < steps.length && (
        <p className="now-doing"><strong>Now:</strong> {STEP_HELP[currentStep]}</p>
      )}

      {live.split && <SplitBar split={live.split} />}
      {live.trials?.length > 0 && <OptunaChart trials={live.trials} total={settings.tune_trials} />}
      {currentStep >= 3 && <TrainingChart live={live} />}

      {job.status === 'done' && live.result && (
        <div className="note good-note" style={{ marginTop: 12 }}>
          <strong>Finished.</strong> Validation AUC {live.result.validation_auc.toFixed(4)}
          {live.result.best_iteration ? ` with ${live.result.best_iteration} trees` : ''}. The run is saved as {' '}
          <span className="mono">{live.result.run_id}</span>.
        </div>
      )}

      <button className="chip" style={{ marginTop: 12 }} onClick={() => setShowLog(!showLog)}>{showLog ? 'Hide log' : 'Show log'}</button>
      {showLog && <div className="logs" style={{ marginTop: 8 }}>{job.logs.join('\n')}</div>}
    </div>
  )
}

function StepTracker({ steps, current, skipped, failed }) {
  return (
    <ol className="step-tracker">
      {steps.map((name, i) => {
        let state = 'todo'
        if (skipped.includes(i)) state = 'skipped'
        else if (i < current) state = 'done'
        else if (i === current) state = failed ? 'failed' : 'current'
        const icon = { done: '✓', current: '●', failed: '✕', skipped: '–', todo: i + 1 }[state]
        return (
          <li key={name} className={state}>
            <span className="step-dot">{icon}</span>
            <span className="step-name">{name}{state === 'skipped' ? ' (off)' : ''}</span>
          </li>
        )
      })}
    </ol>
  )
}

function SplitBar({ split }) {
  const colors = ['var(--accent)', '#d98a1e', '#b8701a', '#c24a32']
  const total = split.reduce((sum, part) => sum + part.loans, 0)
  return (
    <div style={{ marginTop: 16 }}>
      <h3>Data used</h3>
      <div className="split-bar">
        {split.map((part, i) => (
          <div key={part.name} style={{ flex: Math.max(part.loans / total, 0.13), background: colors[i] }}>
            <strong>{part.name}</strong>
            <span>weeks {part.weeks} · {count(part.loans)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function OptunaChart({ trials, total }) {
  const best = trials.reduce((a, b) => (b.auc > a.auc ? b : a))
  return (
    <div style={{ marginTop: 16 }}>
      <h3>Optuna tuning — trial {trials.length} of {total}</h3>
      <Legend items={[
        { label: 'AUC of each trial', color: 'var(--series-established)' },
        { label: 'Best so far', color: 'var(--series-second-look)' },
      ]} />
      <div className="chart" style={{ height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={trials} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="trial" type="number" domain={[1, Math.max(total, 2)]} allowDecimals={false} {...axisProps} />
            <YAxis domain={['auto', 'auto']} tickFormatter={(v) => v.toFixed(4)} {...axisProps} width={60} />
            <Tooltip content={<ChartTooltip labelFormatter={(t) => `Trial ${t}`} valueFormatter={(v) => v.toFixed(4)} />} />
            <Line isAnimationActive={false} dataKey="auc" name="Trial AUC" stroke="none" dot={{ r: 4, fill: 'var(--series-established)' }} />
            <Line isAnimationActive={false} dataKey="best_auc" name="Best so far" type="stepAfter" stroke="var(--series-second-look)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="small muted">
        Best so far: trial {best.trial}, AUC {best.auc.toFixed(4)} with{' '}
        <span className="mono">{Object.entries(best.params).map(([k, v]) => `${k}=${typeof v === 'number' ? Number(v.toPrecision(3)) : v}`).join(', ')}</span>.
        Trials use a 25% sample, so their AUC is a little lower than the final model's.
      </p>
    </div>
  )
}

function TrainingChart({ live }) {
  const curve = live.curve || []
  const help = TRAINING_HELP[live.model_type]
  if (live.model_type === 'logreg' || curve.length === 0) {
    return (
      <div style={{ marginTop: 16 }}>
        <h3>Training the model</h3>
        <p className="muted">{help}</p>
      </div>
    )
  }
  const best = curve.reduce((a, b) => (b.auc > a.auc ? b : a))
  const latest = curve[curve.length - 1]
  return (
    <div style={{ marginTop: 16 }}>
      <h3>Training the model — {latest.trees} trees so far, validation AUC {latest.auc.toFixed(4)}</h3>
      <p className="muted">{help}</p>
      <div className="chart">
        <ResponsiveContainer>
          <LineChart data={curve} margin={{ top: 16, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="trees" type="number" domain={[0, 'dataMax']} {...axisProps} />
            <YAxis domain={['auto', 'auto']} tickFormatter={(v) => v.toFixed(4)} {...axisProps} width={60} />
            <ReferenceLine x={best.trees} stroke="var(--text-3)" strokeDasharray="4 4"
              label={{ value: `best so far: ${best.trees} trees`, position: 'insideBottomRight', fontSize: 11, fill: 'var(--text-2)' }} />
            <Tooltip content={<ChartTooltip labelFormatter={(t) => `${t} trees`} valueFormatter={(v) => v.toFixed(4)} />} />
            <Line isAnimationActive={false} dataKey="auc" name="Validation AUC" stroke="var(--series-established)" strokeWidth={2}
              dot={live.model_type === 'random_forest' ? { r: 3 } : false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
