import { Link } from 'react-router-dom'

const SECTIONS = [
  ['overview', 'Project overview'],
  ['workspaces', 'The three workspaces'],
  ['applicant', 'Applicant how-to'],
  ['business', 'Business how-to'],
  ['tech', 'Tech team how-to'],
  ['decisions', 'How decisions are made'],
  ['glossary', 'Glossary'],
  ['faq', 'FAQ'],
  ['setup', 'Setup & links'],
]

const GLOSSARY = [
  ['PD (probability of default)', "The model's estimate of the chance a loan won't be repaid, from 0% to 100%."],
  ['Thin-file / first-time borrower', 'Someone with no credit-bureau history. About 30% of applicants.'],
  ['Established', 'An applicant with credit-bureau history.'],
  ['Inclusion gap', 'Among people who actually repaid: the approval rate of established applicants minus that of first-time ones. 0 is fair.'],
  ['Second Look', 'Our policy: fix first-time borrowers\' risk scores, correct for change over time, and use one cut-off per group.'],
  ['Calibration', 'Adjusting scores so a 20% risk really means 20 in 100 default.'],
  ['Drift', 'The data changing over time. First-time borrowers\' risk falls week by week in this data.'],
  ['AUC', 'How well a model ranks risky above safe applicants. 0.5 is guessing, 1 is perfect.'],
  ['LogLoss / Brier', 'How far the predicted risks are from what really happened. Lower is better.'],
  ['Primary model', 'The model that decides every application first, with one cut-off (20% by default).'],
  ['Second-look model', 'The model that looks again at what the primary model declined, with the published Second Look policy.'],
  ['Human review', 'Borderline Second Look declines go to a person, who can change the terms, re-score, and approve or decline.'],
  ['Review band', 'How close to the cut-off a Second Look decline must be to go to a person instead of being declined automatically.'],
  ['Override', 'A reviewer approving even though the model still says no. It always needs a written reason and is recorded.'],
  ['Validation weeks', 'Recent weeks held back from training and used to tune the model and policy.'],
  ['Inclusive Profit Score', 'Profit minus a penalty for the inclusion gap — the number the policy optimizes.'],
]

const FAQ = [
  ['Is this real customer data?', 'No. The dataset is synthetic: it copies the structure of a credit bureau but contains no real people.'],
  ['Which models decide applications?', 'Two: the primary model decides first, and the second-look model reviews its declines. The tech team sets both on Compare models; until then the app uses the run with the best validation AUC for both.'],
  ['What happens when the primary model declines someone?', 'The application goes to Second Look — automatically, or when a business user sends it (Work queue → Manual). If Second Look also declines but the case is close to the cut-off, a person reviews it.'],
  ['Can a reviewer approve against the model?', 'Yes, but only with a written reason. Every step — the models, the reviewer, the changed terms — is kept in the audit trail.'],
  ['Does Preview in the Policy lab change live decisions?', 'No. Preview only shows what would happen. Only "Publish to live decisions" changes how applications are decided.'],
  ['How can a typed-in application be scored?', 'The models were trained on credit-bureau and internal records a form cannot collect. So we start from a typical recent applicant like you (same credit-history group) and replace what you told us: loan, income, job, tax income, credit score band, late payments and so on. Reasons only mention things you told us. Your name and email are never given to the models.'],
  ['Why does my income change so little when I have a credit history?', 'In this dataset the credit-bureau score carries almost all of the risk signal for people with a credit history, so the credit score band matters most. For first-time borrowers there is no bureau score, so income, time in your job and tax records count for more.'],
  ['Why can the inclusion gap be negative?', 'It means first-time borrowers who repaid are approved slightly more often than established ones. The fairness penalty pushes the gap towards 0 from either side.'],
  ['Where are the epochs?', 'These models don\'t use epochs. LightGBM adds one tree per round (stopped early when validation stops improving), Random Forest builds each tree once, and logistic regression runs solver iterations.'],
  ['Why do we split data by week and not at random?', 'Lending predicts the future from the past. A time split copies that, and nothing is judged on data it was tuned on.'],
  ['Why does an applicant see no risk numbers?', 'Applicants get the decision, plain-language reasons and what they could change. Scores and cut-offs are internal; the business sees them when reviewing a case from the Work queue.'],
]

export default function Help() {
  return (
    <div className="help">
      <div className="page-head">
        <h1>Help & project overview</h1>
        <p>Everything you need to understand and use Second-Look Lending, whichever workspace you work in.</p>
      </div>

      <nav className="help-toc" aria-label="Help sections">
        {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
      </nav>

      <section id="overview" className="card">
        <h2>Project overview</h2>
        <p>
          Second-Look Lending decides who gets a loan. A model estimates each applicant's <strong>probability of default
          (PD)</strong>, and a lending policy turns that into approve or deny. A repaid loan earns <strong>+$2,000</strong>, a
          default costs <strong>−$8,000</strong>, so approving only pays off when the risk is below <strong>20%</strong>.
        </p>
        <p>
          The catch: <strong>first-time borrowers</strong> (no credit history, 30% of applicants) look riskier to the model
          than they are, because their real risk keeps falling over time. A flat 20% rule turns many of them away even though
          they would repay. Second Look fixes their scores and gives each group its own cut-off.
        </p>
        <div className="grid grid-3" style={{ marginTop: 12 }}>
          <div className="stat"><div className="stat-label">Profit (most recent weeks)</div><div className="stat-value">$147.7M → $154.0M</div><div className="stat-hint">primary model only → with Second Look</div></div>
          <div className="stat"><div className="stat-label">Inclusion gap</div><div className="stat-value">36.9 → −2.5 pts</div><div className="stat-hint">closer to 0 is fairer</div></div>
          <div className="stat"><div className="stat-label">First-time borrowers who repaid, approved</div><div className="stat-value">41% → 81%</div><div className="stat-hint">19,407 more good customers</div></div>
        </div>
      </section>

      <section id="workspaces" className="card">
        <h2>The three workspaces</h2>
        <div className="connect-flow">
          <div><strong>Tech team</strong><span>trains models, picks the primary and second-look models</span></div>
          <span className="connect-arrow" aria-hidden="true">→</span>
          <div><strong>Business</strong><span>runs the pipeline, reviews borderline cases, publishes the policy</span></div>
          <span className="connect-arrow" aria-hidden="true">→</span>
          <div><strong>Applicants</strong><span>see the decision and why</span></div>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>Switch workspace any time with the tabs at the top of the screen.</p>
      </section>

      <section id="applicant" className="card">
        <h2>Applicant how-to</h2>
        <ol className="help-steps">
          <li>Open <Link to="/apply">Applicant</Link> and fill in the five steps: your loan, about you, income & work, credit history, then review and submit.</li>
          <li>You get a decision and an application number straight away. "Approved through Second Look" means a second, closer look approved what the first check declined.</li>
          <li>Later, use <Link to="/apply/status">Check your status</Link> with that number, or open one of the example decisions from the dataset.</li>
          <li>Check <em>What helped</em> and <em>What held it back</em> for the main reasons, in plain words.</li>
          <li>Move the loan-amount slider to see whether a different amount would be approved.</li>
        </ol>
      </section>

      <section id="business" className="card">
        <h2>Business how-to</h2>
        <ol className="help-steps">
          <li><Link to="/business/pipeline">Work queue</Link>: online applications go through the pipeline the moment they are submitted (week shows "Online"). You can also process a week of applications from the dataset. Choose <strong>Automatic</strong> (declines go straight to Second Look) or <strong>Manual</strong> (select them and press <em>Send to Second Look</em>).</li>
          <li>Open a case from the <strong>Human review</strong> list. Change the terms (amount, payment, verified income), press <em>Re-score</em>, then approve or decline. Approving against the model needs a reason.</li>
          <li><Link to="/business/statistics">Statistics</Link>: how many the primary model approved or declined, how many went through Second Look, how many are waiting for a person, and how each route's approvals repaid.</li>
          <li><Link to="/business">Dashboard</Link>: expected profit and fairness across all recent weeks, primary model alone vs with Second Look.</li>
          <li><Link to="/business/policy">Policy lab</Link>: change the Second Look policy and press <strong>Preview</strong>; <strong>Publish</strong> makes it live.</li>
        </ol>
      </section>

      <section id="tech" className="card">
        <h2>Tech team how-to</h2>
        <ol className="help-steps">
          <li><Link to="/tech">Data overview</Link> and <Link to="/tech/insights">Insights</Link>: explore the 8 tables, follow one applicant from raw rows to features, and see how a model works inside.</li>
          <li><Link to="/tech/train">Train models</Link>: pick a model, hover ⓘ on any setting, press Start and watch each step live.</li>
          <li><Link to="/tech/models">Compare models</Link>: compare runs on <strong>validation</strong> (the test tab is a final check only).</li>
          <li>Open a run and press <strong>Set as primary</strong> or <strong>Set as second look</strong>. Live decisions use them from then on.</li>
        </ol>
      </section>

      <section id="decisions" className="card">
        <h2>How decisions are made</h2>
        <div className="connect-flow">
          <div><strong>1 · Primary model</strong><span>approve if risk is below 20%</span></div>
          <span className="connect-arrow" aria-hidden="true">→</span>
          <div><strong>2 · Second Look</strong><span>declines get an adjusted score and a cut-off per group</span></div>
          <span className="connect-arrow" aria-hidden="true">→</span>
          <div><strong>3 · Human review</strong><span>borderline declines go to a person</span></div>
          <span className="connect-arrow" aria-hidden="true">→</span>
          <div><strong>4 · Decision</strong><span>approved or declined, with an audit trail</span></div>
        </div>
        <p style={{ marginTop: 12 }}>
          Second Look's cut-offs are chosen on recent validation weeks to maximize profit minus a fairness penalty, while keeping
          the default rate of approved loans under a limit. Clearly risky declines are final; only borderline ones (within the
          review band, 2 points by default) reach a person.
        </p>
      </section>

      <section id="glossary" className="card">
        <h2>Glossary</h2>
        <dl className="glossary">
          {GLOSSARY.map(([term, meaning]) => (
            <div key={term}><dt>{term}</dt><dd>{meaning}</dd></div>
          ))}
        </dl>
      </section>

      <section id="faq" className="card">
        <h2>FAQ</h2>
        {FAQ.map(([question, answer]) => (
          <details key={question} className="faq">
            <summary>{question}</summary>
            <p>{answer}</p>
          </details>
        ))}
      </section>

      <section id="setup" className="card">
        <h2>Setup & links</h2>
        <pre className="logs">{`cd backend && .venv/bin/uvicorn app.main:app --port 8000
cd frontend && npm run dev      # or: npm run build, then use port 8000`}</pre>
        <ul className="takeaways" style={{ marginTop: 10 }}>
          <li><a href="/guide" target="_blank" rel="noreferrer">Full project guide</a> — architecture and flow diagrams, setup, code walkthrough.</li>
          <li><a href="/docs" target="_blank" rel="noreferrer">API documentation</a> — every endpoint, try them in the browser.</li>
          <li>The dataset goes in <code>data/synth_home_credit</code> (it is never committed).</li>
        </ul>
      </section>
    </div>
  )
}
