// The "how the algorithm works" steps of Insights → Model, all drawn from the real trained model
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartTooltip } from '../../components/ui.jsx'
import { count, percent } from '../../format.js'

const ALGORITHM_NAMES = {
  lightgbm: 'Gradient boosted decision trees (LightGBM)',
  random_forest: 'Random forest of decision trees (scikit-learn)',
  logreg: 'Logistic regression (scikit-learn)',
}

const nice = (value) => Number(Number(value).toPrecision(3))

// Training loop per algorithm, filled in with this run's settings
function trainingLoop(modelType, params, baseRate) {
  if (modelType === 'lightgbm') {
    return {
      repeat: `Back to step 2 for the next tree (one round = one tree, LightGBM's version of an epoch). Stop when validation AUC `
        + `has not improved for ${params.early_stopping_rounds ?? 100} trees in a row, or after ${params.n_estimators} trees.`,
      steps: [
        ['Start', `Every loan starts with the same guess: the average default rate, ${percent(baseRate)}.`],
        ['Measure the errors', 'For each loan, compare the current PD with what really happened (defaulted = 1, repaid = 0). Big gap = big error.'],
        ['Fit a small tree to the errors', `Build one tree (up to ${params.num_leaves} leaves, each with at least ${params.min_child_samples} loans) that groups loans with similar errors, e.g. "low risk score but PD still too high".`],
        ['Nudge every PD', `Add the tree's correction, shrunk by the learning rate (${nice(params.learning_rate)}), to every loan's score. Small steps keep training steady.`],
        ['Check on new weeks', 'Measure AUC on the model-validation weeks (80–85) to see if the new tree helped on loans it never trained on.'],
      ],
    }
  }
  if (modelType === 'random_forest') {
    return {
      repeat: `Back to step 1 until there are ${params.n_estimators} trees. Each tree is built once, on its own, and never sees the others — so there are no epochs.`,
      steps: [
        ['Draw a random sample', 'Pick a random 30% of the training loans (with replacement). Every tree gets a different sample.'],
        ['Ask the best question', 'At each split, look at a random handful of features (about 7 of 53) and pick the yes/no question that best separates defaulters from payers.'],
        ['Stop and count', `Stop splitting when a group would get fewer than ${params.min_samples_leaf} loans or the tree is ${params.max_depth} questions deep. The share of defaulters in each final group is that tree's PD.`],
        ['Average the trees', 'To score an applicant, every tree gives its own PD and the forest takes the average.'],
      ],
    }
  }
  return {
    repeat: `Back to step 3 until the weights stop changing (at most ${params.max_iter ?? 300} times). Each pass over all loans is like one epoch.`,
    steps: [
      ['Prepare the numbers', 'Cap outliers, fill missing values (plus a "was missing" flag), log-transform amounts, scale everything to a similar size, and turn each category into 0/1 columns.'],
      ['Start with zero weights', 'Every feature gets weight 0, so every loan starts at the same PD.'],
      ['Measure how wrong it is', 'Compute LogLoss: how far each PD is from what really happened, averaged over all training loans.'],
      ['Adjust the weights', `Move every weight a little in the direction that lowers LogLoss. A penalty (${params.penalty}, C = ${nice(params.C)}) stops weights from growing too large.`],
    ],
  }
}

export function StepAlgorithm({ number, modelType, algo, Step }) {
  const loop = trainingLoop(modelType, algo.params, algo.base_rate)
  return (
    <Step number={number} title={`The algorithm: ${ALGORITHM_NAMES[modelType]}`}>
      <p className="muted">How this model was trained, step by step, with the settings this run actually used.</p>
      <div className="loop">
        {loop.steps.map(([title, text], i) => (
          <div className="loop-item" key={title}>
            <div className="loop-step">
              <div className="loop-number">{i + 1}</div>
              <div>
                <strong>{title}</strong>
                <p>{text}</p>
              </div>
            </div>
            {i < loop.steps.length - 1 && <div className="loop-arrow" aria-hidden="true">→</div>}
          </div>
        ))}
      </div>
      <div className="loop-repeat">↻ {loop.repeat}</div>
    </Step>
  )
}

export function StepInside({ number, modelType, algo, Step }) {
  if (modelType === 'logreg') return <LogregWeights number={number} weights={algo.weights} Step={Step} />
  const isBoosting = modelType === 'lightgbm'
  return (
    <Step number={number} title="Look inside: the first tree">
      <p className="muted">
        This is the real first tree of the trained model, cut after {3} levels of questions. Start at the top: follow "yes" to the
        left and "no" to the right until you reach a box at the bottom. Each box shows how many training loans landed there and
        their PD.{' '}
        {isBoosting
          ? `In boosting one tree only nudges the starting PD a little (the learning rate keeps steps small); the final model adds up ${algo.n_trees} trees like this one.`
          : `In a random forest each tree is a complete model on its own; the final model averages ${algo.n_trees} trees like this one.`}
      </p>
      <div className="tree-scroll">
        <div className="tree">
          <TreeNode node={algo.tree} />
        </div>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        Hover a question to see what the feature means. "missing → no" tells you which way an applicant goes when that value is
        missing — this is how thin-file applicants, who have no bureau data, travel through the tree.
      </p>
    </Step>
  )
}

function TreeNode({ node, branch }) {
  return (
    <div className="tree-node">
      {branch && <span className={`tree-branch ${branch}`}>{branch}</span>}
      {node.leaf ? (
        <div className="tree-leaf">
          <strong>PD {percent(node.pd)}</strong>
          <span>{count(node.loans)} loans</span>
          {node.more && <span className="muted">more questions below…</span>}
        </div>
      ) : (
        <>
          <div className="tree-question" title={node.meaning}>
            <strong className="mono">{node.question}</strong>
            <span>{count(node.loans)} loans · PD here {percent(node.pd)}</span>
            <span className="muted">missing → {node.missing_goes}</span>
          </div>
          <div className="tree-children">
            <TreeNode node={node.yes} branch="yes" />
            <TreeNode node={node.no} branch="no" />
          </div>
        </>
      )}
    </div>
  )
}

function LogregWeights({ number, weights, Step }) {
  const largest = Math.max(...weights.top.map((w) => Math.abs(w.weight)))
  return (
    <Step number={number} title="Look inside: the learned weights">
      <p className="muted">
        Logistic regression learned one weight for each of its {weights.n_weights} prepared input columns, plus a starting value
        (intercept) of {weights.intercept.toFixed(3)}. A positive weight pushes the PD <strong>up</strong> when the value is high;
        a negative weight pushes it <strong>down</strong>. Inputs are scaled, so weights can be compared. These are the largest:
      </p>
      <div className="weight-list">
        {weights.top.map((w) => (
          <div key={w.feature} className="weight-row" title={w.meaning}>
            <span className="mono label">{w.feature}</span>
            <div className="weight-track">
              <div className={`weight-fill ${w.weight > 0 ? 'up' : 'down'}`}
                style={{ width: `${(Math.abs(w.weight) / largest) * 50}%`, [w.weight > 0 ? 'left' : 'right']: '50%' }} />
            </div>
            <span className={w.weight > 0 ? 'delta-bad' : 'delta-good'}>{w.weight > 0 ? '▲ +' : '▼ '}{w.weight.toFixed(3)}</span>
          </div>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        Columns like <span className="mono">education_927M_f937ecaa</span> are 0/1 columns made from one category value.
        Hover a row to see its meaning.
      </p>
    </Step>
  )
}

export function StepOnePrediction({ number, modelType, algo, Step }) {
  const [kind, setKind] = useState('thin_file')
  const example = algo.examples[kind]
  return (
    <Step number={number} title="How one prediction is made">
      <div className="row" style={{ marginBottom: 8 }}>
        <p className="muted" style={{ margin: 0 }}>
          The same two applicants you followed in the Raw data tab. Applicant <span className="mono">{example.case_id}</span>{' '}
          actually {example.defaulted ? <span className="badge bad">✕ defaulted</span> : <span className="badge good">✓ repaid</span>}.
        </p>
        <div className="spacer" />
        <div className="tabs">
          <button className={kind === 'thin_file' ? 'active' : ''} onClick={() => setKind('thin_file')}>Thin-file applicant</button>
          <button className={kind === 'established' ? 'active' : ''} onClick={() => setKind('established')}>Established applicant</button>
        </div>
      </div>
      {modelType === 'lightgbm' && <BoostingPath example={example} />}
      {modelType === 'random_forest' && <ForestVotes example={example} />}
      {modelType === 'logreg' && <LogregSum example={example} />}
      <div className="note good-note" style={{ marginTop: 12 }}>
        <strong>Final PD: {percent(example.final_pd)}</strong> — the same number the model gives this applicant everywhere else in the app.
        With the plain 20% rule this applicant would be {example.final_pd < 0.2 ? 'approved' : 'denied'}.
      </div>
    </Step>
  )
}

const axisProps = { tick: { fontSize: 12, fill: 'var(--text-3)' }, stroke: 'var(--border)' }

function BoostingPath({ example }) {
  return (
    <>
      <p>
        Tree 1 starts this applicant near the average ({percent(example.path[0].pd)}). Every next tree looks at the applicant's
        features and nudges the score a little up or down. Here is the PD after each number of trees:
      </p>
      <div className="chart" style={{ height: 240 }}>
        <ResponsiveContainer>
          <LineChart data={example.path} margin={{ top: 16, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="trees" type="category" {...axisProps} label={{ value: 'number of trees', position: 'insideBottom', offset: -2, fontSize: 11, fill: 'var(--text-3)' }} height={36} />
            <YAxis tickFormatter={(v) => percent(v, 0)} domain={['auto', 'auto']} {...axisProps} width={48} />
            <ReferenceLine y={0.2} stroke="var(--text-3)" strokeDasharray="4 4" label={{ value: '20% rule', position: 'insideTopRight', fontSize: 11, fill: 'var(--text-3)' }} />
            <Tooltip content={<ChartTooltip labelFormatter={(t) => `After ${t} trees`} valueFormatter={(v) => percent(v)} />} />
            <Line isAnimationActive={false} dataKey="pd" name="PD" stroke="var(--series-thin)" strokeWidth={2} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <h3>What the first 5 trees did (in log-odds, the model's internal score)</h3>
      <div className="row">
        {example.first_trees.map((t) => (
          <span key={t.tree} className="suffix-chip">
            Tree {t.tree}: <strong className={t.tree > 1 ? (t.change > 0 ? 'delta-bad' : 'delta-good') : ''}>
              {t.tree === 1 ? `start at ${t.change.toFixed(3)}` : `${t.change > 0 ? '+' : ''}${t.change.toFixed(4)}`}
            </strong>
          </span>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 6 }}>
        The final score is the sum of all trees, turned into a probability with PD = 1 / (1 + e<sup>−score</sup>).
      </p>
    </>
  )
}

function ForestVotes({ example }) {
  return (
    <>
      <p>
        Each of the {example.n_trees} trees answers on its own. For this applicant their PDs range from {percent(example.lowest)} to{' '}
        {percent(example.highest)}. No single tree is trusted — the forest takes the average.
      </p>
      <div className="chart" style={{ height: 240 }}>
        <ResponsiveContainer>
          <BarChart data={example.votes} margin={{ top: 16, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="pd" type="number" domain={[0, 1]} tickFormatter={(v) => percent(v, 0)} {...axisProps}
              label={{ value: "one tree's PD", position: 'insideBottom', offset: -2, fontSize: 11, fill: 'var(--text-3)' }} height={36} />
            <YAxis allowDecimals={false} {...axisProps} width={40} />
            <ReferenceLine x={example.final_pd} stroke="var(--series-second-look)" strokeWidth={2}
              label={{ value: `average ${percent(example.final_pd)}`, position: 'top', fontSize: 11, fill: 'var(--text-2)' }} />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip labelFormatter={(v) => `PD around ${percent(v, 0)}`} valueFormatter={(v) => `${v} trees`} />} />
            <Bar isAnimationActive={false} dataKey="trees" name="Trees" fill="var(--series-established)" radius={[4, 4, 0, 0]} barSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}

function LogregSum({ example }) {
  const largest = Math.max(...example.contributions.map((c) => Math.abs(c.contribution)), Math.abs(example.others))
  return (
    <>
      <p>
        The score is a sum: start at the intercept, then add <span className="mono">weight × value</span> for every input.
        The biggest parts for this applicant:
      </p>
      <div className="weight-list">
        <SumRow label="intercept (starting value)" value={example.intercept} largest={largest} />
        {example.contributions.map((c) => (
          <SumRow key={c.feature} label={c.feature} detail={`${c.weight.toFixed(3)} × ${c.value.toFixed(2)}`} value={c.contribution} largest={largest} />
        ))}
        <SumRow label="all other inputs" value={example.others} largest={largest} />
      </div>
      <div className="formula-box">
        score = {example.score.toFixed(3)} → PD = 1 / (1 + e<sup>−({example.score.toFixed(3)})</sup>) = <strong>{percent(example.final_pd)}</strong>
      </div>
    </>
  )
}

function SumRow({ label, detail, value, largest }) {
  return (
    <div className="weight-row">
      <span className="mono label" title={detail}>{label}{detail && <span className="muted"> ({detail})</span>}</span>
      <div className="weight-track">
        <div className={`weight-fill ${value > 0 ? 'up' : 'down'}`}
          style={{ width: `${(Math.abs(value) / largest) * 50}%`, [value > 0 ? 'left' : 'right']: '50%' }} />
      </div>
      <span className={value > 0 ? 'delta-bad' : 'delta-good'}>{value > 0 ? '+' : ''}{value.toFixed(3)}</span>
    </div>
  )
}

// Raw tables to decisions in one diagram, with the training loop in the middle
const LOOP_TEXT = {
  lightgbm: { a: 'Add one tree that fixes the current mistakes', b: 'Check AUC on weeks 80–85', repeat: 'repeat until no gain for 100 trees' },
  random_forest: { a: 'Grow 20 more independent trees', b: 'Check AUC on weeks 80–85', repeat: 'repeat until all trees are grown' },
  logreg: { a: 'Adjust every weight a little', b: 'Measure LogLoss on all fit loans', repeat: 'repeat until the weights stop changing' },
}

export function BigPicture({ modelType, modelName }) {
  const loop = LOOP_TEXT[modelType]
  const box = (title, text, step, kind = '') => (
    <div className={`flow-box ${kind}`}>
      <strong>{title}</strong>
      <span>{text}</span>
      {step && <span className="flow-step">step {step}</span>}
    </div>
  )
  return (
    <div className="card">
      <h2>The big picture: how a model gets trained</h2>
      <p className="muted">
        Read left to right. The green box is where the actual learning happens; the numbered steps below explain each part.
      </p>
      <div className="flow">
        {box('8 raw tables', '15.6M rows, joined by case_id', null, 'data')}
        <div className="flow-arrow" aria-hidden="true">→</div>
        {box('Feature table', '1 row per loan, 53 features', 1, 'data')}
        <div className="flow-arrow" aria-hidden="true">→</div>
        {box('Split by week', 'fit 0–79 · check 80–85 · policy 86–91 · test 92–107', 2, 'data')}
        <div className="flow-arrow" aria-hidden="true">→</div>
        <div className="flow-loop">
          <div className="flow-loop-title">Training loop · {modelName}</div>
          <div className="flow-loop-body">
            {box('Learn', loop.a, 4, 'learn')}
            <div className="flow-cycle" aria-hidden="true">⇄</div>
            {box('Check', loop.b, 5, 'learn')}
          </div>
          <div className="flow-loop-repeat">↻ {loop.repeat}</div>
        </div>
      </div>
      <div className="flow-turn" aria-hidden="true">↓ then</div>
      <div className="flow">
        {box('Trained model', 'gives every loan a PD', 6)}
        <div className="flow-arrow" aria-hidden="true">→</div>
        {box('Calibrate + thresholds', 'fix thin-file PDs, pick cut-offs on weeks 86–91', 9)}
        <div className="flow-arrow" aria-hidden="true">→</div>
        {box('Approve / deny', 'scored once on the test weeks', 10, 'decision')}
      </div>
    </div>
  )
}
