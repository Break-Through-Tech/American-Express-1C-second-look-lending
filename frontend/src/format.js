export const money = (value) => {
  if (value == null) return '—'
  const sign = value < 0 ? '−' : ''
  const abs = Math.abs(value)
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}k`
  return `${sign}$${abs.toFixed(0)}`
}

export const percent = (value, digits = 1) => (value == null ? '—' : `${(value * 100).toFixed(digits)}%`)

export const points = (value) => (value == null ? '—' : `${value.toFixed(1)} pts`)

export const number = (value, digits = 4) => (value == null ? '—' : Number(value).toFixed(digits))

export const count = (value) => (value == null ? '—' : Number(value).toLocaleString())
