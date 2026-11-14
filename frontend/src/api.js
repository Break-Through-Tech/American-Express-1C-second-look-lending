async function request(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    // Form validation errors come back as a list; show the first one
    const detail = Array.isArray(data?.detail) ? data.detail[0]?.msg : data?.detail
    throw new Error(detail || `Request failed: ${response.status}`)
  }
  return data
}

export const api = {
  health: () => request('GET', '/api/health'),
  buildFeatures: () => request('POST', '/api/features/build'),

  overview: () => request('GET', '/api/eda/overview'),
  featureList: () => request('GET', '/api/eda/features'),
  rawTable: (name, params) => request('GET', `/api/eda/raw-table/${name}?${new URLSearchParams(params)}`),
  trainingSample: (params) => request('GET', `/api/eda/training-sample?${new URLSearchParams(params)}`),
  featureSignal: (name) => request('GET', `/api/eda/feature/${name}`),

  modelOptions: () => request('GET', '/api/models'),
  train: (settings) => request('POST', '/api/train', settings),
  jobs: () => request('GET', '/api/jobs'),
  job: (id) => request('GET', `/api/jobs/${id}`),

  runs: () => request('GET', '/api/runs'),
  run: (id) => request('GET', `/api/runs/${id}`),
  deleteRun: (id) => request('DELETE', `/api/runs/${id}`),

  policy: (id) => request('GET', `/api/runs/${id}/policy`),
  // save: false = preview only, true = publish to live decisions
  updatePolicy: (id, options, save = false) => request('POST', `/api/runs/${id}/policy`, { ...options, save }),

  rawInsights: () => request('GET', '/api/insights/raw'),
  modelInsights: (id) => request('GET', `/api/runs/${id}/insights`),
  modelAlgorithm: (id) => request('GET', `/api/runs/${id}/algorithm`),

  // Which run is the primary model and which is the second-look model
  modelRoles: () => request('GET', '/api/model-roles'),
  setModelRole: (role, runId) => request('PUT', '/api/model-roles', { role, run_id: runId }),
  businessDashboard: () => request('GET', '/api/business/dashboard'),

  // Decision pipeline: primary -> Second Look -> human review
  workflowSettings: () => request('GET', '/api/workflow/settings'),
  saveWorkflowSettings: (changes) => request('PUT', '/api/workflow/settings', changes),
  workflowSummary: () => request('GET', '/api/workflow/summary'),
  processWeek: (week) => request('POST', '/api/workflow/process', { week }),
  sendToSecondLook: (caseIds = []) => request('POST', '/api/workflow/second-look', { case_ids: caseIds }),
  workflowCases: (params) => request('GET', `/api/workflow/cases?${new URLSearchParams(params)}`),
  workflowCase: (id) => request('GET', `/api/workflow/cases/${id}`),
  rescoreCase: (id, changes) => request('POST', `/api/workflow/cases/${id}/rescore`, { changes }),
  decideCase: (id, body) => request('POST', `/api/workflow/cases/${id}/decide`, body),
  resetWorkflow: () => request('POST', '/api/workflow/reset', {}),

  apply: (form) => request('POST', '/api/portal/apply', form),
  portalShowcase: () => request('GET', '/api/portal/showcase'),
  portalScore: (caseId, changes = {}) => request('POST', '/api/portal/score', { case_id: caseId, changes }),

}
