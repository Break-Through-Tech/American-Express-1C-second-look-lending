import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../../api.js'
import { ErrorBox } from '../../components/ui.jsx'
import { money } from '../../format.js'
import { plainReasons } from './reasons.js'

export default function Decision() {
  const { caseId } = useParams()
  const [searchParams] = useSearchParams()
  const justApplied = searchParams.get('new') === '1'
  const [original, setOriginal] = useState(null)
  const [current, setCurrent] = useState(null)
  const [share, setShare] = useState(1)  // what-if loan size as a share of the original amount
  const [error, setError] = useState(null)

  useEffect(() => {
    setOriginal(null)
    setShare(1)
    api.portalScore(Number(caseId))
      .then((result) => { setOriginal(result); setCurrent(result) })
      .catch(setError)
  }, [caseId])

  // Re-score shortly after the slider stops moving
  useEffect(() => {
    if (!original) return
    const amount = original.editable.credamount_770A
    const payment = original.editable.annuity_780A
    const timer = setTimeout(() => {
      const changes = share === 1 ? {} : {
        credamount_770A: Math.round(amount * share),
        annuity_780A: payment == null ? null : Math.round(payment * share),
      }
      api.portalScore(original.case_id, changes).then(setCurrent).catch(setError)
    }, 300)
    return () => clearTimeout(timer)
  }, [share, original])

  if (error) {
    return (
      <>
        <BackLink />
        <ErrorBox error={error.message.includes('not found') ? 'We could not find that application number.' : error} />
      </>
    )
  }
  if (!original || !current) return <p className="muted">Loading your decision…</p>

  // The real stage comes from the pipeline; the slider shows where a different amount would land
  const stage = original.workflow?.status
  const whatIf = share === 1 ? original.workflow : current.workflow
  const view = STAGE_VIEW[stage] || STAGE_VIEW.declined_second_look
  const reasons = plainReasons(current.reasons, current.thin_file)
  const amount = original.editable.credamount_770A
  const payment = original.editable.annuity_780A
  const approvedAmount = original.workflow?.approved_amount
  const details = original.application  // only for applications made through the online form

  return (
    <>
      <BackLink />
      {justApplied && (
        <div className="card received-note">
          <strong>Thanks{details ? `, ${details.first_name}` : ''} — we've received your application.</strong>{' '}
          Your application number is <strong className="mono">#{original.case_id}</strong>. Keep it to check your status later.
        </div>
      )}
      <div className={`decision-card ${view.tone}`}>
        <span className="decision-icon" aria-hidden="true">{view.icon}</span>
        <div>
          <span className="portal-tag">Application #{original.case_id}</span>
          <h1>{view.title}</h1>
          <p>
            {money(approvedAmount || amount)} loan
            {payment && !approvedAmount ? ` · about ${money(payment)} ${details ? 'a month' : 'per payment'}` : ''}
            {approvedAmount && approvedAmount !== amount ? ` (you asked for ${money(amount)})` : ''}
            {details ? ` · ${details.term_months} months · ${details.purpose}` : ''}
          </p>
          {stage === 'approved_second_look' && (
            <div className="second-look-note">
              <strong>Approved through Second Look.</strong>{' '}
              {original.thin_file
                ? 'We found no credit history for you, so we looked more closely at your income, job and records with us — and they support this loan.'
                : 'Our first check said no, so a second, more detailed model looked again — and it supports this loan.'}
            </div>
          )}
          {view.text && <p className="small">{view.text}</p>}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>What helped</h2>
          <ReasonList items={reasons.helped} kind="good" empty="Nothing stood out in your favour." />
        </div>
        <div className="card">
          <h2>What held it back</h2>
          <ReasonList items={reasons.heldBack} kind="bad" empty="Nothing stood out against it." />
        </div>
      </div>
      {current.reasons.length === 0 && (
        <p className="small muted">Detailed reasons are not available for the model in use right now.</p>
      )}

      <div className="card">
        <h2>What if you borrowed a different amount?</h2>
        <p className="muted">Move the slider to see how the decision changes. Your payment changes with it.</p>
        <label className="field">
          <span>Loan amount: <strong>{money(amount * share)}</strong> ({Math.round(share * 100)}% of what you asked for)</span>
          <input type="range" min={0.2} max={1.5} step={0.05} value={share} onChange={(e) => setShare(Number(e.target.value))} />
        </label>
        <div className="row" style={{ marginTop: 10 }}>
          <WhatIfBadge status={whatIf?.status} />
          {share !== 1 && <button className="chip" onClick={() => setShare(1)}>Back to my original amount</button>}
        </div>
      </div>

      {view.tone !== 'approved' && (
        <div className="card">
          <h2>What you can do next</h2>
          <ul className="takeaways">
            <li>Try a smaller loan amount or a lower payment (see the slider above).</li>
            <li>Make sure your income and tax records with us are up to date.</li>
            <li>You can ask for a person to review this decision.</li>
          </ul>
        </div>
      )}

      <p className="small muted">
        Decisions are made by a credit model and a lending policy that is checked for fairness between new and established
        borrowers. You can always ask for a human review.
      </p>
    </>
  )
}

// What the applicant sees at each stage of the pipeline
const STAGE_VIEW = {
  approved_primary: { tone: 'approved', icon: '✓', title: 'Your loan is approved' },
  approved_second_look: { tone: 'approved', icon: '✓', title: 'Your loan is approved' },
  approved_review: { tone: 'approved', icon: '✓', title: 'Your loan is approved',
    text: 'A member of our team reviewed your application and approved it.' },
  in_review: { tone: 'pending', icon: '…', title: 'Your application is with our review team',
    text: 'It came very close to our limit, so a person is looking at it rather than a computer saying no. We will get back to you soon.' },
  awaiting_second_look: { tone: 'pending', icon: '…', title: "We're taking a second look at your application",
    text: 'Our first check could not approve it, so it is waiting for a more detailed second look.' },
  declined_second_look: { tone: 'declined', icon: '!', title: "We can't approve this loan right now",
    text: 'Our first check and our more detailed second look both found the risk too high for this amount.' },
  declined_review: { tone: 'declined', icon: '!', title: "We can't approve this loan right now",
    text: 'A member of our team reviewed your application and could not approve it this time.' },
}

function WhatIfBadge({ status }) {
  if (status === 'approved_primary' || status === 'approved_second_look') {
    return <span className="badge good">✓ This amount would be approved</span>
  }
  if (status === 'in_review') return <span className="badge warn">… This amount would go to our review team</span>
  return <span className="badge bad">✕ This amount would not be approved</span>
}

function BackLink() {
  return <Link to="/apply/status" className="back-link">← Check another application</Link>
}

function ReasonList({ items, kind, empty }) {
  if (items.length === 0) return <p className="muted">{empty}</p>
  return (
    <ul className="reason-list">
      {items.map((item) => (
        <li key={item}><span className={`badge ${kind}`}>{kind === 'good' ? '✓' : '✕'}</span>{item}</li>
      ))}
    </ul>
  )
}
