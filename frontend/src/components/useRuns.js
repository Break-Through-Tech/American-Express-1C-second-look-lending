import { useEffect, useState } from 'react'
import { api } from '../api.js'

// Loads the trained runs and remembers which one is selected
export function useRuns() {
  const [runs, setRuns] = useState(null)
  const [selected, setSelected] = useState(() => localStorageGet('selectedRun'))
  const [error, setError] = useState(null)

  const reload = () =>
    api.runs()
      .then((list) => {
        setRuns(list)
        const stillExists = list.some((run) => run.run_id === selected)
        if (!stillExists && list.length > 0) setSelected(bestRun(list).run_id)
      })
      .catch(setError)

  useEffect(() => { reload() }, [])

  const select = (runId) => {
    setSelected(runId)
    localStorageSet('selectedRun', runId)
  }

  // A remembered run may have been deleted since, so only return one that exists
  const validSelected = runs && runs.some((run) => run.run_id === selected) ? selected : null

  return { runs, selected: validSelected, select, reload, error }
}

function bestRun(runs) {
  return [...runs].sort((a, b) => b.metrics.validation.all.auc - a.metrics.validation.all.auc)[0]
}

function localStorageGet(key) {
  try { return localStorage.getItem(key) } catch { return null }
}

function localStorageSet(key, value) {
  try { localStorage.setItem(key, value) } catch { /* private mode or blocked storage */ }
}
