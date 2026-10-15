import type { PulseLimit, PulseMetrics } from '../types'
import { fmtLeft, fmtMs, fmtPct, fmtRate, fmtResetAt } from './format'
import { speedAvg, ttftAvg } from './metrics'

// en spaces survive the desktop's whitespace collapsing, so groups keep their air
const GAP = '  │  '
const IN = ' · '

const limit = (name: string, value: PulseLimit | null, now: number) => {
  const at = fmtResetAt(value?.resetsAt ?? null, now)
  const pct = value?.pct ?? null
  return `${name} ${pct === null ? fmtLeft(pct) : `${fmtLeft(pct)} left`}${at ? `${IN}Resets ${at}` : ''}`
}

export const statusLine = (m: PulseMetrics, now: number) => {
  const isLive = m.isStreaming && m.speedLive !== null
  const speed = isLive ? `● ${fmtRate(m.speedLive)}` : fmtRate(m.speedLast)
  return [
    `TTFT ${fmtMs(m.ttftLast)}${IN}Avg ${fmtMs(ttftAvg(m))}`,
    `${speed} tok/s${IN}Avg ${fmtRate(speedAvg(m))}`,
    `Cache Hit ${fmtPct(m.cacheLast)}`,
    limit('5H', m.fiveHour, now),
    limit('Weekly', m.week, now),
  ].join(GAP)
}
