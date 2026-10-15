export const DASH = '—'

export const splitMs = (ms: number | null): [string, string] => {
  if (ms === null) {
    return [DASH, '']
  }
  if (ms < 1000) {
    return [String(Math.round(ms)), 'ms']
  }
  return [(ms / 1000).toFixed(ms < 10_000 ? 2 : 1), 's']
}

export const fmtMs = (ms: number | null) => splitMs(ms).join('')

export const fmtRate = (rate: number | null) =>
  rate === null ? DASH : rate >= 100 ? String(Math.round(rate)) : rate.toFixed(1)

export const fmtPct = (ratio: number | null) => {
  if (ratio === null) {
    return DASH
  }
  const pct = ratio * 100
  return `${(pct < 100 ? Math.min(pct, 99.9) : 100).toFixed(1)}%`
}

export const fmtUsed = (pct: number | null) => (pct === null ? DASH : `${Math.round(pct)}%`)

export const fmtLeft = (pct: number | null) => (pct === null ? DASH : `${Math.max(0, Math.round(100 - pct))}%`)


const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const pad = (n: number) => String(n).padStart(2, '0')

export const fmtResetAt = (resetsAt: number | null, now: number) => {
  if (resetsAt === null) {
    return ''
  }
  const at = new Date(resetsAt)
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  if (at.toDateString() === new Date(now).toDateString()) {
    return time
  }
  if (resetsAt - now < 6 * 86_400_000) {
    return `${DAYS[at.getDay()]} ${time}`
  }
  return `${at.getMonth() + 1}/${at.getDate()} ${time}`
}

export type Level = 'calm' | 'warn' | 'hot'

export const usageLevel = (pct: number | null): Level =>
  pct === null || pct < 60 ? 'calm' : pct < 85 ? 'warn' : 'hot'

const BLOCKS = '▁▂▃▄▅▆▇█'

export const sparkline = (values: readonly number[], width: number) => {
  const tail = values.slice(-width)
  if (tail.length < 2) {
    return ''
  }
  const low = Math.min(...tail)
  const span = Math.max(...tail) - low || 1
  return tail.map(v => BLOCKS[Math.round(((v - low) / span) * (BLOCKS.length - 1))]).join('')
}

