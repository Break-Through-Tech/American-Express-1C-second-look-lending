import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../../api.js'
import { ChartTooltip, ErrorBox, Legend, NoRuns, RunPicker, Stat } from '../../components/ui.jsx'
import { useRuns } from '../../components/useRuns.js'
import { count, money, number, percent } from '../../format.js'
import { BigPicture, StepAlgorithm, StepInside, StepOnePrediction } from './Algorithm.jsx'

// One-line story for each model type
const MODEL_STORY = {
  logreg: {
    idea: 'Gives every feature a weight, adds them up into one score, and squashes the score into a probability between 0 and 1.',
    good: 'Simple, fast and easy to explain — the baseline every other model must beat.',
    limit: 'Can only draw straight-line relationships, so it misses interactions between features.',
  },
  random_forest: {
    idea: 'Builds many decision trees, each on a random part of the data, and averages their answers.',
    good: 'Captures interactions and handles missing values without extra preparation.',
    limit: 'Slow on 1M rows (we train on a sample) and its probabilities are often less sharp than boosting.',
  },
  lightgbm: {
    idea: 'Builds trees one after another; each new tree fixes the mistakes the previous trees still make.',
    good: 'Usually the most accurate on tables like this one; handles missing values and categories natively.',
    limit: 'Harder to explain than a single formula — we use feature importance and SHAP reasons to look inside.',
  },
}

const GLOSSARY = [
  ['PD (probability of default)', 'The model\'s estimate of the chance a loan will not be repaid, from 0 to 1.'],
  ['Thin-file', 'An applicant with no credit-bureau history (no rows in credit_bureau_a_1).'],
  ['AUC', 'How well the model ranks people: the chance that a random defaulter gets a higher PD than a random payer. 0.5 = guessing, 1 = perfect.'],
  ['LogLoss', 'How far the predicted probabilities are from what happened. Lower is better; it punishes confident wrong answers.'],
  ['Brier score', 'Average squared gap between PD and the outcome (0 or 1). Lower is better.'],
  ['Calibration', 'Whether a PD of 20% really means 20 out of 100 default. A model can rank well (good AUC) and still be badly calibrated.'],
  ['Epoch', 'One full pass over the training data — common in neural networks. These models do not use epochs: LightGBM adds one tree per round (boosting rounds), Random Forest builds each tree once, and logistic regression runs solver iterations (max_iter), each a pass over all loans.'],
  ['Early stopping', 'Stop adding trees when the score on validation data stops improving, so the model does not memorise the training data.'],
  ['Overfitting', 'Learning the training data too exactly, including its noise, so the model does worse on new data.'],
  ['Validation set', 'Data held back from training to check and tune. Here weeks 80–85 tune the model and weeks 86–91 tune the policy.'],
  ['Inclusion gap', 'Among applicants who actually repaid: approval rate of established minus approval rate of thin-file.'],
  ['Drift', 'The data changing over time. Here thin-file default risk falls week by week.'],
]

const axisProps = { tick: { fontSize: 12, fill: 'var(--text-3)' }, stroke: 'var(--border)' }

export default function ModelTab() {
  const { runs, selected, select, error: runsError } = useRuns()
  const [searchParams] = useSearchParams()

  // Support links like /insights?tab=model&run=<run_id>
  useEffect(() => {
    const fromUrl = searchParams.get('run')
    if (fromUrl && runs?.some((r) => r.run_id === fromUrl)) select(fromUrl)
  }, [runs])
  const [data, setData] = useState(null)
  const [algo, setAlgo] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!selected) return
    setData(null)
    setAlgo(null)
    setError(null)
    api.modelInsights(selected).then(setData).catch(setError)
    api.modelAlgorithm(selected).then(setAlgo).catch(setError)
  }, [selected])

  if (runsError) return <ErrorBox error={runsError} />
  if (!runs) return <div className="muted">Loading…</div>
  if (runs.length === 0) return <NoRuns />

  return (
    <>
      <div className="card">
        <label className="field" style={{ maxWidth: 420 }}>
          Model run to explain
          <RunPicker runs={runs} value={selected} onChange={select} />
        </label>
        <p className="small muted" style={{ marginTop: 8 }}>
          Everything below uses the validation weeks only, so nothing here peeks at the test set.
        </p>
      </div>
      <ErrorBox error={error} />
      {data && (
        <>
          <BigPicture modelType={data.run.model_type} modelName={data.run.model_name} />
          <StepInputs number={1} data={data} />
          <StepSplit number={2} split={data.split} />
          <StepModel number={3} data={data} />
          {algo && <StepAlgorithm number={4} modelType={data.run.model_type} algo={algo} Step={Step} />}
          <StepTraining number={5} data={data} />
          {algo && <StepInside number={6} modelType={data.run.model_type} algo={algo} Step={Step} />}
          {algo && <StepOnePrediction number={7} modelType={data.run.model_type} algo={algo} Step={Step} />}
          <StepLearned number={8} data={data} />
          <StepPredictions number={9} data={data} />
          <StepDecisions number={10} data={data} />
          <Glossary />
        </>
      )}
    </>
  )
}

function Step({ number: n, title, children }) {
  return (
    <div className="card step">
      <div className="step-number">{n}</div>
      <div className="step-body">
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

function StepInputs({ number: n, data }) {
  const largest = Math.max(...data.feature_groups.map((g) => g.features))
  return (
    <Step number={n} title={`What goes in: ${data.run.n_features} features per loan`}>
      <p className="muted">
        The model never sees the raw tables. It sees one row per loan, built in <span className="mono">features.py</span>.
        Here is where those features come from (details in the Raw data tab and <span className="mono">doc/DATA_DICTIONARY.md</span>).
      </p>
      <div className="bar-list">
        {data.feature_groups.map((g) => (
          <div className="bar-item" key={g.source}>
            <span className="label mono">{g.source}</span>
            <div className="track"><div className="fill" style={{ width: `${(g.features / largest) * 100}%` }} /></div>
            <span>{g.features} features</span>
          </div>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        Not used as inputs: case_id (just an id), the dates and week number (used only to split the data), and of course the target.
      </p>
    </Step>
  )
}

function StepSplit({ number: n, split }) {
  const total = split.reduce((sum, w) => sum + w.loans, 0)
  const colors = ['var(--accent)', '#d98a1e', '#b8701a', '#c24a32']
  return (
    <Step number={n} title="Split by time, not at random">
      <p className="muted">
        Real lending always predicts the future from the past, so we split by week. Each part has one job, and nothing is
        judged on data it was tuned on.
      </p>
      <div className="split-bar">
        {split.map((w, i) => (
          <div key={w.name} style={{ flex: Math.max(w.loans / total, 0.12), background: colors[i] }} title={`${w.name}: ${count(w.loans)} loans`}>
            <strong>{w.name}</strong>
            <span>weeks {w.weeks}</span>
          </div>
        ))}
      </div>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead><tr><th>Part</th><th>Weeks</th><th className="num">Loans</th><th className="num">Thin-file</th><th>Used for</th></tr></thead>
          <tbody>
            {split.map((w) => (
              <tr key={w.name}>
                <td><strong>{w.name}</strong></td>
                <td>{w.weeks}</td>
                <td className="num">{count(w.loans)}</td>
                <td className="num">{percent(w.thin_share)}</td>
                <td style={{ whiteSpace: 'normal' }}>{w.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Step>
  )
}

function StepModel({ number: n, data }) {
  const story = MODEL_STORY[data.run.model_type]
  return (
    <Step number={n} title={`The model: ${data.run.model_name}`}>
      <p><strong>Idea:</strong> {story.idea}</p>
      <div className="grid grid-2" style={{ margin: '12px 0' }}>
        <div className="note good-note"><strong>Good at:</strong> {story.good}</div>
        <div className="note warn-note"><strong>Watch out:</strong> {story.limit}</div>
      </div>
      <h3>Settings (hyperparameters) used in this run</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Setting</th><th>Value</th><th>What it means</th></tr></thead>
          <tbody>
            {data.params.map((p) => (
              <tr key={p.name}>
                <td className="mono">{p.name}</td>
                <td className="mono">{p.value == null ? 'None' : String(typeof p.value === 'number' ? Number(p.value.toFixed(4)) : p.value)}</td>
                <td style={{ whiteSpace: 'normal' }}>{p.help}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Step>
  )
}

function StepTraining({ number: n, data }) {
  const run = data.run
  const curve = data.learning_curve
  return (
    <Step number={n} title="Training: how it improved">
      <div className="grid grid-3" style={{ marginBottom: 12 }}>
        <Stat label="Loans used for training" value={count(run.n_train)} />
        <Stat label="Training time" value={`${run.train_seconds}s`} hint="everything: Optuna tuning (if any), training, scoring" />
        {run.best_iteration && <Stat label="Trees kept by early stopping" value={run.best_iteration} hint="boosting rounds (LightGBM's epochs)" />}
        {run.solver_iterations && <Stat label="Solver iterations" value={run.solver_iterations} hint="passes over all loans (like epochs)" />}
        {!run.best_iteration && !run.solver_iterations && <Stat label="Trained on" value={run.created_at.slice(0, 10)} />}
      </div>
      {curve.length > 0 ? (
        <>
          <p className="muted">
            {run.model_type === 'lightgbm'
              ? 'Each point is the validation AUC after adding one more tree. After the best point (dashed line), 100 more trees '
                + 'brought no improvement, so early stopping ended training and kept the model at its best point.'
              : 'The forest was grown 20 trees at a time; each point is the validation AUC after that batch. AUC climbs with the '
                + 'first trees, then flattens: extra trees stop changing the average much.'}
            {' '}The y-axis is zoomed in: the whole climb is only {(Math.max(...curve.map((p) => p.auc)) - curve[0].auc).toFixed(3)} AUC —
            most of the skill comes from the first trees.
          </p>
          <div className="chart">
            <ResponsiveContainer>
              <LineChart data={curve} margin={{ top: 16, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="trees" type="number" domain={[0, 'dataMax']} {...axisProps} />
                <YAxis domain={['auto', 'auto']} tickFormatter={(v) => v.toFixed(4)} {...axisProps} width={60} />
                {run.best_iteration && (
                  <ReferenceLine x={run.best_iteration} stroke="var(--text-3)" strokeDasharray="4 4"
                    label={{ value: `best: ${run.best_iteration} trees`, position: 'insideBottomRight', fontSize: 11, fill: 'var(--text-2)' }} />
                )}
                <Tooltip content={<ChartTooltip labelFormatter={(t) => `${t} trees`} valueFormatter={(v) => v.toFixed(4)} />} />
                <Line isAnimationActive={false} dataKey="auc" name="Validation AUC" stroke="var(--series-established)" strokeWidth={2}
                  dot={run.model_type === 'random_forest' ? { r: 3 } : false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <p className="muted">
          {run.model_type === 'logreg'
            ? 'Logistic regression is solved in one go (one weight per feature), so there are no trees and no learning curve.'
            : 'This run was trained before learning curves were saved. Train it again to see how AUC grew as trees were added.'}
        </p>
      )}
    </Step>
  )
}

function StepLearned({ number: n, data }) {
  const largest = data.importance[0]?.importance || 1
  return (
    <Step number={n} title="What the model learned to look at">
      <p className="muted">
        The features the model relied on most. {data.run.model_type === 'logreg'
          ? 'For logistic regression this is the size of each weight on the scaled inputs.'
          : 'For tree models this is how much each feature improved the trees\' splits.'}
        {' '}Bureau features usually top the list — which is exactly why thin-file applicants are harder to score.
      </p>
      <div className="importance-list">
        {data.importance.map((f) => (
          <div key={f.feature} className="importance-item">
            <div className="row" style={{ gap: 8 }}>
              <span className="mono">{f.feature}</span>
              <span className="badge neutral">{f.source}</span>
              <div className="spacer" />
              <strong>{percent(f.importance)}</strong>
            </div>
            <div className="track"><div className="fill" style={{ width: `${(f.importance / largest) * 100}%` }} /></div>
            <div className="small muted">{f.meaning}</div>
          </div>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        Want the reasons for one specific applicant? Use <Link to="/applicant">Score applicant</Link> with a LightGBM run.
      </p>
    </Step>
  )
}

function StepPredictions({ number: n, data }) {
  const [view, setView] = useState('raw')
  const m = data.metrics
  const legend = [
    { label: 'Established', color: 'var(--series-established)' },
    { label: 'Thin-file', color: 'var(--series-thin)' },
  ]
  return (
    <Step number={n} title="How good are the predictions?">
      <div className="table-wrap">
        <table>
          <thead><tr><th>Validation weeks</th><th className="num">AUC</th><th className="num">LogLoss</th><th className="num">Brier</th><th>In plain words</th></tr></thead>
          <tbody>
            {[['established', 'Established'], ['thin_file', 'Thin-file']].map(([key, label]) => (
              <tr key={key}>
                <td>{label}</td>
                <td className="num">{number(m[key].auc)}</td>
                <td className="num">{number(m[key].logloss)}</td>
                <td className="num">{number(m[key].brier)}</td>
                <td style={{ whiteSpace: 'normal' }}>
                  A random defaulter gets a higher PD than a random payer {percent(m[key].auc, 0)} of the time.
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 12 }}>
        The model ranks thin-file applicants less well: it has less information about them. Worse, its PDs for them are
        <strong> too high on average</strong>, because thin-file risk kept falling after the training weeks.
      </p>

      <div className="grid grid-3" style={{ margin: '12px 0' }}>
        {[['established', 'Established'], ['thin_file', 'Thin-file']].map(([key, label]) => (
          <Stat key={key} label={`${label}: average PD vs reality`}
            value={`${percent(data.mean_pd[key].raw)} → ${percent(data.mean_pd[key].calibrated)}`}
            hint={`raw → calibrated · actual default rate ${percent(data.mean_pd[key].actual)}`} />
        ))}
        <Stat label="Second-look thresholds" value={`${percent(data.thresholds.established)} / ${percent(data.thresholds.thin_file)}`} hint="established / thin-file" />
      </div>

      <div className="row" style={{ marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}>Spread of PDs per segment</h3>
        <div className="spacer" />
        <div className="tabs">
          <button className={view === 'raw' ? 'active' : ''} onClick={() => setView('raw')}>Raw model PD</button>
          <button className={view === 'calibrated' ? 'active' : ''} onClick={() => setView('calibrated')}>Calibrated PD</button>
        </div>
      </div>
      <Legend items={legend} />
      <div className="chart">
        <ResponsiveContainer>
          <LineChart data={data.pd_distribution} margin={{ top: 20, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="pd" type="number" domain={[0, 0.8]} tickFormatter={(v) => percent(v, 0)} {...axisProps} />
            <YAxis tickFormatter={(v) => percent(v, 0)} {...axisProps} width={44} />
            <ReferenceLine x={0.2} stroke="var(--text-3)" strokeDasharray="4 4" label={{ value: '20% rule', position: 'top', fontSize: 11, fill: 'var(--text-3)' }} />
            <Tooltip content={<ChartTooltip labelFormatter={(v) => `PD around ${percent(v, 0)}`} valueFormatter={(v) => `${percent(v)} of segment`} />} />
            <Line isAnimationActive={false} dataKey={`established_${view}`} name="Established" stroke="var(--series-established)" strokeWidth={2} dot={false} />
            <Line isAnimationActive={false} dataKey={`thin_file_${view}`} name="Thin-file" stroke="var(--series-thin)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="small muted">
        Share of each segment's applicants in each 4%-wide PD band. Everyone left of the dashed line is approved by the
        20% rule. The bumps come from groups the model treats alike (education level is a strong signal). Switch to
        "Calibrated PD" to see the thin-file curve move left once its PDs are corrected.
      </p>
    </Step>
  )
}

function StepDecisions({ number: n, data }) {
  const [segment, setSegment] = useState('thin_file')
  return (
    <Step number={n} title="From PD to decisions — and what they are worth">
      <p className="muted">
        Every decision lands in one of four boxes. Approving a payer earns <strong>+$2,000</strong>; approving a defaulter
        costs <strong>−$8,000</strong>; denying is $0 either way, but denying a payer loses a good customer.
      </p>
      <div className="tabs" style={{ marginBottom: 12 }}>
        <button className={segment === 'thin_file' ? 'active' : ''} onClick={() => setSegment('thin_file')}>Thin-file</button>
        <button className={segment === 'established' ? 'active' : ''} onClick={() => setSegment('established')}>Established</button>
      </div>
      <div className="grid grid-2">
        <OutcomeMatrix title="Baseline: raw PD < 20%" cells={data.outcomes.baseline[segment]} />
        <OutcomeMatrix title="Second-look policy" cells={data.outcomes.second_look[segment]} highlight />
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        Validation weeks only. Try other settings in the <Link to="/policy">Policy lab</Link>.
      </p>
    </Step>
  )
}

function OutcomeMatrix({ title, cells, highlight }) {
  return (
    <div className={`compare-card ${highlight ? 'highlight' : ''}`}>
      <h3 style={{ marginBottom: 4 }}>{title}</h3>
      <div className="small muted" style={{ marginBottom: 10 }}>approve if PD &lt; {percent(cells.threshold)}</div>
      <div className="matrix">
        <div />
        <div className="matrix-head">Repaid</div>
        <div className="matrix-head">Defaulted</div>
        <div className="matrix-head side">Approved</div>
        <div className="matrix-cell good">✓ {count(cells.approved_repaid)}<span>earned {money(cells.approved_repaid * 2000)}</span></div>
        <div className="matrix-cell bad">✕ {count(cells.approved_defaulted)}<span>lost {money(cells.approved_defaulted * 8000)}</span></div>
        <div className="matrix-head side">Denied</div>
        <div className="matrix-cell warn">! {count(cells.denied_repaid)}<span>good customers turned away</span></div>
        <div className="matrix-cell neutral">✓ {count(cells.denied_defaulted)}<span>losses avoided</span></div>
      </div>
      <div style={{ marginTop: 10 }}>Profit: <strong>{money(cells.profit)}</strong></div>
    </div>
  )
}

function Glossary() {
  return (
    <div className="card">
      <h2>Glossary</h2>
      <dl className="glossary">
        {GLOSSARY.map(([term, meaning]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{meaning}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
