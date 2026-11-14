// Turns model features into words an applicant understands (first matching rule wins)
const PHRASES = [
  [/^riskassesment|^description_5085714M|^has_bureau_summary/, 'Your credit bureau record'],
  [/^numberofqueries/, 'Recent credit checks on your file'],
  [/^bureau_pmts_dpd|^bureau_dpd/, 'How on time past loan payments were'],
  [/^bureau_overdue|^payments_/, 'Overdue amounts on past loans'],
  [/^bureau_/, 'Your past credit with other lenders'],
  [/^thin_file|^external_coverage|^bureau_rowcount/, 'How much credit history we could find'],
  [/^annuity_to_income/, 'Your monthly payment compared to your income'],
  [/^credit_to_income/, 'The loan amount compared to your income'],
  [/^mainoccupationinc|^person_mainoccupationinc|^household/, 'Your income'],
  [/^credamount/, 'The loan amount'],
  [/^annuity/, 'Your monthly payment'],
  [/^days_employed|^person_empl/, 'How long you have been employed'],
  [/^tax_/, 'Your declared income records'],
  [/^prev_|^has_prior_app/, 'Your earlier applications with us'],
  [/^education/, 'Your education'],
  [/^maritalstatus|^person_count/, 'Your household'],
  [/^housingtype/, 'Your housing situation'],
  [/^age_years/, 'Your age'],
]

// Bureau features say nothing useful to someone who has no bureau record, so they get one honest phrase
const BUREAU = /^riskassesment|^description_5085714M|^has_bureau_summary|^numberofqueries|^bureau_|^payments_|^thin_file|^external_coverage/

export function phraseFor(feature, thinFile) {
  if (thinFile && BUREAU.test(feature)) return 'No credit history on file yet'
  const match = PHRASES.find(([pattern]) => pattern.test(feature))
  return match ? match[1] : 'Other details on your application'
}

// Adds up the model's reasons per phrase, then splits them into what helped and what held it back
export function plainReasons(reasons, thinFile) {
  const totals = new Map()
  for (const r of reasons) {
    const phrase = phraseFor(r.feature, thinFile)
    totals.set(phrase, (totals.get(phrase) || 0) + r.contribution)  // positive = more risk
  }
  const sorted = [...totals.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  return {
    helped: sorted.filter(([, total]) => total < 0).slice(0, 3).map(([phrase]) => phrase),
    heldBack: sorted.filter(([, total]) => total > 0).slice(0, 3).map(([phrase]) => phrase),
  }
}
