import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../../api.js'
import { ErrorBox } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'

const STEPS = ['Your loan', 'About you', 'Income & work', 'Credit history', 'Review & submit']
const TERMS = [6, 12, 18, 24, 36, 48]
const PURPOSES = ['home improvement', 'car', 'education', 'medical', 'debt consolidation', 'other']
const EMPLOYMENT = ['employed', 'self-employed', 'retired', 'student', 'not working']
// Credit score bands as most lenders show them
const RATINGS = [
  ['excellent', 'Excellent', '800 or higher'],
  ['very good', 'Very good', '740 – 799'],
  ['good', 'Good', '670 – 739'],
  ['fair', 'Fair', '580 – 669'],
  ['poor', 'Poor', 'below 580'],
]
// The worst late payment, as a choice instead of an exact number of days
const LATE = [[0, 'Never late'], [15, 'Up to 30 days'], [45, '31–60 days'], [75, 'More than 60 days']]
const ANNUAL_RATE = 0.12  // same estimate as the backend

const EMPTY = {
  loan_amount: 15000, term_months: 24, purpose: 'car',
  first_name: '', last_name: '', email: '', date_of_birth: '',
  employment: 'employed', years_employed: '', annual_income: '', tax_declared_income: '',
  has_credit_history: null, credit_rating: '', credit_accounts: 2, worst_days_late: 0, credit_checks_last_year: 1,
  previous_loans: 0, consent: false,
}

// Made-up people for the "simulated customer" option (not real customers)
const FIRST_NAMES = ['Alex', 'Jordan', 'Sam', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie', 'Avery', 'Quinn', 'Drew', 'Robin']
const LAST_NAMES = ['Sample', 'Example', 'Tester', 'Demo', 'Placeholder', 'Mock']

const pick = (list) => list[Math.floor(Math.random() * list.length)]
const between = (low, high, step = 1) => low + step * Math.floor(Math.random() * ((high - low) / step + 1))

// A random, realistic applicant so nobody has to type every field
function simulatedCustomer() {
  const first = pick(FIRST_NAMES)
  const last = pick(LAST_NAMES)
  const employment = pick(['employed', 'employed', 'employed', 'employed', 'self-employed', 'self-employed', 'retired', 'student', 'not working'])
  const working = employment === 'employed' || employment === 'self-employed'
  const income = working ? between(14000, 80000, 500) : between(6000, 24000, 500)
  const hasHistory = Math.random() < 0.7
  const born = new Date()
  born.setFullYear(born.getFullYear() - between(21, 66), between(0, 11), between(1, 28))
  return {
    loan_amount: between(3000, 40000, 500),
    term_months: pick(TERMS),
    purpose: pick(PURPOSES),
    first_name: first,
    last_name: last,
    email: `${first}.${last}@example.com`.toLowerCase(),
    date_of_birth: born.toISOString().slice(0, 10),
    employment,
    years_employed: working ? between(1, 30) / 2 : 0,
    annual_income: income,
    tax_declared_income: Math.random() < 0.7 ? Math.round((income * between(85, 100)) / 100 / 100) * 100 : '',
    has_credit_history: hasHistory,
    credit_rating: hasHistory ? pick(['excellent', 'very good', 'good', 'good', 'fair', 'fair', 'poor']) : '',
    credit_accounts: hasHistory ? between(1, 6) : 2,
    worst_days_late: hasHistory ? pick([0, 0, 0, 15, 15, 45, 75]) : 0,
    credit_checks_last_year: hasHistory ? between(0, 5) : 1,
    previous_loans: between(0, 3),
    consent: true,
  }
}

const usd = (v) => `$${Math.round(v).toLocaleString()}`

function monthlyPayment(amount, months) {
  const rate = ANNUAL_RATE / 12
  return (amount * rate) / (1 - (1 + rate) ** -months)
}

function age(dateOfBirth) {
  return (Date.now() - new Date(dateOfBirth)) / (365.25 * 24 * 3600 * 1000)
}

// The first problem on a step, or null when the step is complete
function checkStep(step, f) {
  if (step === 0) {
    if (!(f.loan_amount >= 1000 && f.loan_amount <= 100000)) return 'Choose a loan amount between $1,000 and $100,000.'
  }
  if (step === 1) {
    if (!f.first_name.trim() || !f.last_name.trim()) return 'Enter your first and last name.'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return 'Enter a valid email address.'
    if (!f.date_of_birth || age(f.date_of_birth) < 18) return 'You must be at least 18 to apply.'
  }
  if (step === 2) {
    if (f.annual_income === '') return 'Enter your yearly income before tax.'
    if (f.years_employed === '') return 'Enter how long you have been in your current job (0 if not working).'
  }
  if (step === 3) {
    if (f.has_credit_history === null) return 'Tell us whether you have any credit history.'
    if (f.has_credit_history && !f.credit_rating) return 'Choose your credit score band.'
  }
  if (step === 4 && !f.consent) return 'Please agree to the credit check to submit.'
  return null
}

// Empty optional numbers go to the API as null; the rest as numbers
function toRequest(f) {
  const num = (v) => (v === '' || v == null ? null : Number(v))
  return {
    ...f,
    loan_amount: num(f.loan_amount),
    years_employed: num(f.years_employed),
    annual_income: num(f.annual_income),
    tax_declared_income: num(f.tax_declared_income),
    credit_rating: f.has_credit_history ? f.credit_rating : null,
    credit_accounts: f.has_credit_history ? Number(f.credit_accounts) : 0,
    worst_days_late: f.has_credit_history ? Number(f.worst_days_late) : 0,
    credit_checks_last_year: f.has_credit_history ? Number(f.credit_checks_last_year) : 0,
    previous_loans: Number(f.previous_loans),
  }
}

export default function Apply() {
  const [form, setForm] = useState(EMPTY)
  const [step, setStep] = useState(0)
  const [problem, setProblem] = useState(null)
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)
  const [simulated, setSimulated] = useState(false)
  const navigate = useNavigate()

  const set = (field) => (event) => {
    const { type, value, checked } = event.target
    setForm({ ...form, [field]: type === 'checkbox' ? checked : value })
  }
  const choose = (field, value) => setForm({ ...form, [field]: value })

  // Ticking the box fills every step; unticking clears the form again
  const toggleSimulated = (on) => {
    setSimulated(on)
    setForm(on ? simulatedCustomer() : EMPTY)
    setProblem(null)
  }

  const next = () => {
    const issue = checkStep(step, form)
    setProblem(issue)
    if (!issue) setStep(step + 1)
  }

  const submit = async () => {
    const issue = checkStep(step, form)
    setProblem(issue)
    if (issue) return
    setSending(true)
    setError(null)
    try {
      const result = await api.apply(toRequest(form))
      navigate(`/apply/${result.case.case_id}?new=1`)
    } catch (err) {
      setError(err)
      setSending(false)
    }
  }

  const payment = monthlyPayment(Number(form.loan_amount) || 0, form.term_months)

  return (
    <>
      <div className="apply-head">
        <div>
          <span className="portal-tag">Personal loan</span>
          <h1>Apply for a personal loan</h1>
          <p className="muted">About 5 minutes. No credit history? You can still apply.</p>
          <div className="trust-row">
            <span><Icon name="clock" size={16} />Decision as soon as you submit</span>
            <span><Icon name="check" size={16} />Reasons in plain language</span>
            <span><Icon name="shield" size={16} />First-time borrowers welcome</span>
          </div>
        </div>
        <Link to="/apply/status" className="button-link">Already applied? Check your status →</Link>
      </div>

      <ol className="apply-steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? 'current' : i < step ? 'done' : ''}>
            <span className="apply-step-dot">{i < step ? '✓' : i + 1}</span>{label}
          </li>
        ))}
      </ol>

      <div className="apply-layout">
        <div className="card apply-form">
          {(step === 0 || simulated) && <div className={`simulate-bar ${simulated ? 'on' : ''}`}>
            {step === 0 ? (
              <label className="check">
                <input type="checkbox" checked={simulated} onChange={(e) => toggleSimulated(e.target.checked)} />
                <span><strong>Use a simulated customer</strong>
                  <span className="small muted"> · fills every step with made-up details, so you don't have to type</span></span>
              </label>
            ) : (
              <span className="small"><strong>Simulated customer</strong> · all details are made up; change anything you like</span>
            )}
            {simulated && <button type="button" className="chip" onClick={() => toggleSimulated(true)}>New customer</button>}
          </div>}
          {step === 0 && (
            <>
              <h2>How much would you like to borrow?</h2>
              <label className="field">
                Loan amount
                <input type="number" min={1000} max={100000} step={500} value={form.loan_amount} onChange={set('loan_amount')} />
              </label>
              <input type="range" min={1000} max={60000} step={500} value={form.loan_amount} onChange={set('loan_amount')}
                aria-label="Loan amount slider" />
              <div className="field">
                <span>Repay over</span>
                <div className="option-row">
                  {TERMS.map((t) => (
                    <button key={t} type="button" className={`option ${form.term_months === t ? 'selected' : ''}`}
                      onClick={() => choose('term_months', t)}>{t} months</button>
                  ))}
                </div>
              </div>
              <label className="field">
                What is the loan for?
                <select value={form.purpose} onChange={set('purpose')}>
                  {PURPOSES.map((p) => <option key={p} value={p}>{capital(p)}</option>)}
                </select>
              </label>
            </>
          )}

          {step === 1 && (
            <>
              <h2>About you</h2>
              <div className="form-grid">
                <label className="field">First name<input value={form.first_name} onChange={set('first_name')} autoComplete="given-name" /></label>
                <label className="field">Last name<input value={form.last_name} onChange={set('last_name')} autoComplete="family-name" /></label>
                <label className="field">Email<input type="email" value={form.email} onChange={set('email')} autoComplete="email" /></label>
                <label className="field">Date of birth<input type="date" value={form.date_of_birth} onChange={set('date_of_birth')} /></label>
              </div>
              <p className="small muted">Your name and email are only used to contact you. The credit models never see them.</p>
            </>
          )}

          {step === 2 && (
            <>
              <h2>Income & work</h2>
              <div className="form-grid">
                <label className="field">
                  Employment
                  <select value={form.employment} onChange={set('employment')}>
                    {EMPLOYMENT.map((e) => <option key={e} value={e}>{capital(e)}</option>)}
                  </select>
                </label>
                <label className="field">
                  Years in your current job
                  <input type="number" min={0} max={50} step={0.5} value={form.years_employed} onChange={set('years_employed')} />
                </label>
                <label className="field">
                  Yearly income before tax ($)
                  <input type="number" min={0} value={form.annual_income} onChange={set('annual_income')} />
                </label>
                <label className="field">
                  Income on your last tax return ($, optional)
                  <input type="number" min={0} value={form.tax_declared_income} onChange={set('tax_declared_income')} />
                </label>
              </div>
              <p className="small muted">Income that matches your tax records helps, especially if you are new to credit.</p>
            </>
          )}

          {step === 3 && (
            <>
              <h2>Your credit history</h2>
              <div className="field">
                <span>Do you have any credit history — loans, credit cards, or a mortgage, now or in the past?</span>
                <div className="option-row">
                  <button type="button" className={`option ${form.has_credit_history === true ? 'selected' : ''}`}
                    onClick={() => choose('has_credit_history', true)}>Yes</button>
                  <button type="button" className={`option ${form.has_credit_history === false ? 'selected' : ''}`}
                    onClick={() => choose('has_credit_history', false)}>No, this would be my first</button>
                </div>
              </div>

              {form.has_credit_history === false && (
                <div className="second-look-note">
                  <strong>That's fine.</strong> First-time borrowers get a Second Look: we judge you on your income, job and
                  records with us instead of a credit history you don't have yet.
                </div>
              )}

              {form.has_credit_history && (
                <>
                  <div className="field">
                    <span>Your credit score (your best estimate is fine)</span>
                    <div className="rating-grid">
                      {RATINGS.map(([value, label, hint]) => (
                        <button key={value} type="button" className={`option rating ${form.credit_rating === value ? 'selected' : ''}`}
                          onClick={() => choose('credit_rating', value)}>
                          <strong>{label}</strong><span>{hint}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="form-grid">
                    <label className="field">
                      Credit accounts (loans and cards)
                      <input type="number" min={1} max={8} value={form.credit_accounts} onChange={set('credit_accounts')} />
                    </label>
                    <label className="field">
                      Longest you've ever been late on a payment
                      <select value={form.worst_days_late} onChange={set('worst_days_late')}>
                        {LATE.map(([days, label]) => <option key={days} value={days}>{label}</option>)}
                      </select>
                    </label>
                    <label className="field">
                      Credit applications in the last 12 months
                      <input type="number" min={0} max={15} value={form.credit_checks_last_year} onChange={set('credit_checks_last_year')} />
                    </label>
                  </div>
                </>
              )}

              <label className="field">
                Loans you've had with us before
                <select value={form.previous_loans} onChange={set('previous_loans')}>
                  {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n === 4 ? '4 or more' : n}</option>)}
                </select>
              </label>
            </>
          )}

          {step === 4 && (
            <>
              <h2>Check your answers</h2>
              <ReviewTable form={form} payment={payment} goTo={setStep} />
              <label className="check" style={{ marginTop: 14 }}>
                <input type="checkbox" checked={form.consent} onChange={set('consent')} />
                I confirm these details are true and agree that you check my credit record.
              </label>
            </>
          )}

          {problem && <p className="form-problem" role="alert">{problem}</p>}
          <ErrorBox error={error} />

          <div className="row apply-nav">
            {step > 0 && <button type="button" className="secondary" onClick={() => { setProblem(null); setStep(step - 1) }}>← Back</button>}
            <span className="spacer" />
            {step < STEPS.length - 1
              ? <button type="button" onClick={next}>Continue →</button>
              : <button type="button" onClick={submit} disabled={sending}>{sending ? 'Getting your decision…' : 'Submit application'}</button>}
          </div>
        </div>

        <aside className="card apply-summary">
          <span className="stat-label">Your loan</span>
          <div className="stat-value">{usd(Number(form.loan_amount) || 0)}</div>
          <p className="muted small">over {form.term_months} months</p>
          <div className="apply-payment">
            <span>Estimated monthly payment</span>
            <strong>{usd(payment)}</strong>
          </div>
          <p className="small muted">Estimate at {ANNUAL_RATE * 100}% a year. Your final rate is confirmed with your offer.</p>
        </aside>
      </div>
    </>
  )
}

function ReviewTable({ form, payment, goTo }) {
  const late = LATE.find(([days]) => days === Number(form.worst_days_late))?.[1]
  const sections = [
    [0, 'Your loan', [
      ['Amount', usd(form.loan_amount)],
      ['Term', `${form.term_months} months (about ${usd(payment)} a month)`],
      ['Purpose', capital(form.purpose)],
    ]],
    [1, 'About you', [
      ['Name', `${form.first_name} ${form.last_name}`],
      ['Email', form.email],
      ['Date of birth', form.date_of_birth],
    ]],
    [2, 'Income & work', [
      ['Employment', `${capital(form.employment)}, ${form.years_employed} years`],
      ['Yearly income', usd(form.annual_income)],
      ['Income on tax return', form.tax_declared_income === '' ? 'Not given' : usd(form.tax_declared_income)],
    ]],
    [3, 'Credit history', form.has_credit_history ? [
      ['Credit score', `${capital(form.credit_rating)} (${RATINGS.find(([v]) => v === form.credit_rating)?.[2]})`],
      ['Credit accounts', form.credit_accounts],
      ['Longest late payment', late],
      ['Credit applications (12 months)', form.credit_checks_last_year],
      ['Loans with us before', form.previous_loans],
    ] : [
      ['Credit history', 'None yet (first-time borrower)'],
      ['Loans with us before', form.previous_loans],
    ]],
  ]
  return (
    <div className="review-sections">
      {sections.map(([stepIndex, title, rows]) => (
        <div key={title}>
          <div className="row"><h3>{title}</h3><span className="spacer" />
            <button type="button" className="chip" onClick={() => goTo(stepIndex)}>Edit</button></div>
          <table><tbody>{rows.map(([k, v]) => <tr key={k}><td className="muted">{k}</td><td>{v}</td></tr>)}</tbody></table>
        </div>
      ))}
    </div>
  )
}

function capital(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : ''
}
