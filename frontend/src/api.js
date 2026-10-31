async function request(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(data?.detail || `Request failed: ${response.status}`)
  }
  return data
}

export const api = {
  health: () => request('GET', '/api/health'),
  buildFeatures: () => request('POST', '/api/features/build'),

  overview: () => request('GET', '/api/eda/overview'),
  featureList: () => request('GET', '/api/eda/features'),
  featureSignal: (name) => request('GET', `/api/eda/feature/${name}`),

  modelOptions: () => request('GET', '/api/models'),
  train: (settings) => request('POST', '/api/train', settings),
  jobs: () => request('GET', '/api/jobs'),
  job: (id) => request('GET', `/api/jobs/${id}`),

  runs: () => request('GET', '/api/runs'),
  run: (id) => request('GET', `/api/runs/${id}`),
  deleteRun: (id) => request('DELETE', `/api/runs/${id}`),

  policy: (id) => request('GET', `/api/runs/${id}/policy`),
  updatePolicy: (id, options) => request('POST', `/api/runs/${id}/policy`, options),

  rawInsights: () => request('GET', '/api/insights/raw'),
  modelInsights: (id) => request('GET', `/api/runs/${id}/insights`),
  modelAlgorithm: (id) => request('GET', `/api/runs/${id}/algorithm`),

  randomApplicants: () => request('GET', '/api/applicants/random'),
  score: (id, caseId, changes) => request('POST', `/api/runs/${id}/score`, { case_id: caseId, changes }),
}
