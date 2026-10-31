import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import LiveTraining from '../components/LiveTraining.jsx'
import { ErrorBox, InfoTip } from '../components/ui.jsx'

const MODEL_HELP = {
  logreg: 'Baseline. Gives every feature a weight and adds them up. Linear, fast and easy to explain — the bar every other model must beat.',
  random_forest: 'Many independent decision trees, each trained on a random part of the data, averaged together. Captures interactions and handles missing values.',
  lightgbm: 'Gradient boosting: trees built one after another, each fixing the mistakes of the previous ones. Usually the best on tables like this. Stops itself with early stopping.',
}

// Tooltips for the data and tuning fields
const DATA_HELP = {
  name: {
    what: 'A label so you can find this run later in Compare models and Policy lab.',
  },
  sample: {
    what: 'Share of the fit-week loans used for training. The sample keeps the same mix of thin-file / established and default / repaid.',
    range: '5% – 100%',
    effect: 'Smaller = much faster but slightly less accurate. Random Forest is slow on all rows, so it starts at 50%.',
  },
  trials: {
    what: 'How many different hyperparameter combinations Optuna tries before the final training. 0 = use the values on the left as they are.',
    range: '0, or 10 – 50',
    effect: 'More trials = better chance of finding good settings, but each trial is a full (smaller) training. 20 trials of LightGBM take about a minute.',
  },
  valWeek: {
    what: 'First week of model validation. Weeks before it are used to fit the model.',
    range: '20 – 88 (default 80)',
    effect: 'Used for early stopping and Optuna scores. A later week leaves more data for fitting but less for checking.',
  },
  policyWeek: {
    what: 'First week of policy validation (must be after the model-validation week). Runs to week 91.',
    range: 'default 86',
    effect: 'These weeks are never seen by the model. They are used to calibrate PDs, pick thresholds and report validation scores.',
  },
}

// These models don't use epochs, so explain the closest thing for each
const EPOCH_NOTE = {
  lightgbm: 'LightGBM trains in boosting rounds: each round adds one tree. n_estimators is the most rounds allowed and '
    + 'early_stopping_rounds is the patience — training stops when validation AUC has not improved for that many rounds.',
  random_forest: 'There are no epochs. Every tree is built once, on its own random sample, and the trees are averaged. '
    + 'The only "train more" setting is n_estimators (more trees).',
  logreg: 'The nearest thing is max_iter. Each solver iteration goes over all training loans once and adjusts every weight '
    + '(like one epoch). The solver stops by itself when the weights stop changing.',
}

// Starting sample size per model, to keep training quick on a laptop
const DEFAULT_SAMPLE = { logreg: 1, random_forest: 0.5, lightgbm: 1 }

export default function Train() {
  const [options, setOptions] = useState(null)
  const [modelType, setModelType] = useState('lightgbm')
  const [params, setParams] = useState({})
  const [name, setName] = useState('')
  const [sampleFraction, setSampleFraction] = useState(1)
  const [valStartWeek, setValStartWeek] = useState(80)
  const [policyStartWeek, setPolicyStartWeek] = useState(86)
  const [tuneTrials, setTuneTrials] = useState(0)
  const [jobs, setJobs] = useState([])
  const [watchedJob, setWatchedJob] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.modelOptions().then((o) => {
      setOptions(o)
      setParams(o.default_params.lightgbm)
      setValStartWeek(o.val_start_week)
      setPolicyStartWeek(o.policy_start_week)
    }).catch(setError)
  }, [])

  // Refresh the job list every 1.5s
  useEffect(() => {
    const load = () => api.jobs().then(setJobs).catch(setError)
    load()
    const timer = setInterval(load, 1500)
    return () => clearInterval(timer)
  }, [])

  // Watch the running job by default, otherwise the newest
  useEffect(() => {
    if (watchedJob || jobs.length === 0) return
    const running = jobs.find((j) => j.status === 'running')
    setWatchedJob((running || jobs[0]).job_id)
  }, [jobs, watchedJob])

  const changeModel = (type) => {
    setModelType(type)
    setParams(options.default_params[type])
    setSampleFraction(DEFAULT_SAMPLE[type])
  }

  const changeParam = (key, value) => setParams({ ...params, [key]: value })

  const submit = async () => {
    setError(null)
    try {
      const job = await api.train({
        model_type: modelType,
        name: name || null,
        params,
        sample_fraction: Number(sampleFraction),
        val_start_week: Number(valStartWeek),
        policy_start_week: Number(policyStartWeek),
        tune_trials: Number(tuneTrials),
      })
      setWatchedJob(job.job_id)
      setJobs(await api.jobs())
    } catch (e) {
      setError(e)
    }
  }

  if (!options) return <ErrorBox error={error} />
  const paramHelp = options.param_help[modelType] || {}

  return (
    <>
      <div className="page-head">
        <h1>Train models</h1>
        <p>
          Pick a model, read what each setting does, and press Start. Training runs on the API server and the panel below shows
          every step live. The train file is split by week: fit the model, model validation (early stopping, Optuna) and policy
          validation (calibration, thresholds). The test set is only scored at the end.
        </p>
      </div>
      <ErrorBox error={error} />

      <div className="grid grid-2">
        <div className="card">
          <h2>1. Choose a model</h2>
          <div className="tabs" style={{ marginBottom: 10 }}>
            {Object.entries(options.models).map(([type, label]) => (
              <button key={type} className={type === modelType ? 'active' : ''} onClick={() => changeModel(type)}>
                {label}
              </button>
            ))}
          </div>
          <p className="muted">{MODEL_HELP[modelType]}</p>

          <h2 style={{ marginTop: 16 }}>2. Hyperparameters</h2>
          <p className="small muted">Settings chosen before training (the model does not learn them). Defaults work well. Hover ⓘ for details.</p>
          <div className="grid grid-2">
            {Object.entries(params).map(([key, value]) => (
              <ParamInput key={key} name={key} value={value} help={paramHelp[key]} onChange={(v) => changeParam(key, v)} />
            ))}
          </div>
          <div className="note warn-note" style={{ marginTop: 14 }}>
            <strong>Where are the epochs?</strong> {EPOCH_NOTE[modelType]}
          </div>
        </div>

        <div className="card">
          <h2>3. Data and tuning</h2>
          <div className="grid grid-2">
            <Field label="Run name (optional)" help={DATA_HELP.name}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. LightGBM v2" />
            </Field>
            <Field label={`Train sample: ${Math.round(sampleFraction * 100)}%`} help={DATA_HELP.sample}>
              <input type="range" min={0.05} max={1} step={0.05} value={sampleFraction} onChange={(e) => setSampleFraction(e.target.value)} />
            </Field>
            <Field label="Optuna tuning trials (0 = off)" help={DATA_HELP.trials}>
              <input type="number" min={0} max={100} value={tuneTrials} onChange={(e) => setTuneTrials(e.target.value)} />
            </Field>
            <Field label="Model validation starts at week" help={DATA_HELP.valWeek}>
              <input type="number" min={20} max={88} value={valStartWeek} onChange={(e) => setValStartWeek(e.target.value)} />
            </Field>
            <Field label="Policy validation starts at week" help={DATA_HELP.policyWeek}>
              <input type="number" min={21} max={89} value={policyStartWeek} onChange={(e) => setPolicyStartWeek(e.target.value)} />
            </Field>
          </div>
          <p className="card-note">
            Weeks 0–{valStartWeek - 1}: fit · weeks {valStartWeek}–{policyStartWeek - 1}: model validation ·
            weeks {policyStartWeek}–91: policy validation · weeks 92–107: test
          </p>
          <button onClick={submit} style={{ marginTop: 12 }}>Start training</button>
        </div>
      </div>

      {watchedJob && <LiveTraining key={watchedJob} jobId={watchedJob} />}

      <div className="card">
        <h2>Training jobs</h2>
        {jobs.length === 0 && <p className="muted">No jobs yet in this server session.</p>}
        {jobs.map((job) => (
          <JobRow key={job.job_id} job={job} watched={job.job_id === watchedJob} onWatch={() => setWatchedJob(job.job_id)} />
        ))}
      </div>
    </>
  )
}

function Field({ label, help, children }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {help && (
          <InfoTip>
            <span>{help.what}</span>
            {help.range && <span><strong>Typical:</strong> {help.range}</span>}
            {help.effect && <span><strong>Effect:</strong> {help.effect}</span>}
          </InfoTip>
        )}
      </span>
      {children}
    </label>
  )
}

function ParamInput({ name, value, help, onChange }) {
  let input = <input type="number" step="any" value={value} onChange={(e) => onChange(Number(e.target.value))} />
  if (name === 'penalty') {
    input = (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="l2">l2</option>
        <option value="l1">l1</option>
      </select>
    )
  }
  if (name === 'class_weight') {
    input = (
      <select value={value || ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">none</option>
        <option value="balanced">balanced</option>
      </select>
    )
  }
  return (
    <Field label={<span className="mono">{name}</span>} help={help}>
      {input}
    </Field>
  )
}

function JobRow({ job, watched, onWatch }) {
  const statusClass = { done: 'good', failed: 'bad', running: 'warn', queued: 'neutral' }[job.status]
  const settings = job.settings || {}

  return (
    <div className={`job-row ${watched ? 'watched' : ''}`}>
      <div className="row">
        <span className={`badge ${statusClass}`}>{job.status}</span>
        <strong>{settings.name || settings.model_type || job.kind}</strong>
        <span className="muted small">
          {settings.model_type} · sample {Math.round((settings.sample_fraction || 1) * 100)}%
          {settings.tune_trials > 0 && ` · ${settings.tune_trials} Optuna trials`} · {job.created_at}
        </span>
        <div className="spacer" />
        {job.status === 'done' && job.result?.run_id && <Link to="/models">View results →</Link>}
        <button className="chip" onClick={onWatch} disabled={watched}>{watched ? 'Watching' : 'Watch'}</button>
      </div>
      <div className="progress" style={{ margin: '8px 0' }}><div style={{ width: `${job.progress * 100}%` }} /></div>
      {job.error && <div className="error">{job.error}</div>}
      <div className="small muted mono">{job.logs[job.logs.length - 1]}</div>
    </div>
  )
}
