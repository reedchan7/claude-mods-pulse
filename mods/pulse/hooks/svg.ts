import type { PulseLimit, PulseMetrics } from '../types'
import { DASH, fmtMs, fmtPct, fmtLeft, fmtRate, fmtResetAt, splitMs, usageLevel } from './format'
import { cacheAvg, speedAvg, ttftAvg } from './metrics'

const W = 760
const H = 60
const PAD = 16
const LABEL_Y = 23
const VALUE_Y = 45

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const STYLE = `
svg{--fg:#1f1e1d;--muted:#8b877f;--line:rgba(31,30,29,.09);--bg:rgba(31,30,29,.022);--track:rgba(31,30,29,.08);--accent:#d97757;--warn:#c98a1b;--hot:#d2553f}
@media (prefers-color-scheme:dark){svg{--fg:#eceae4;--muted:#8f8b84;--line:rgba(236,234,228,.1);--bg:rgba(236,234,228,.03);--track:rgba(236,234,228,.1)}}
text{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Inter",system-ui,sans-serif;font-feature-settings:"tnum" 1;font-variant-numeric:tabular-nums}
.l{font-size:10px;font-weight:600;letter-spacing:.09em;fill:var(--muted)}
.v{font-size:18px;font-weight:600;letter-spacing:-.01em;fill:var(--fg)}
.u{font-size:11px;font-weight:500;fill:var(--muted)}
.s{font-size:11px;font-weight:450;fill:var(--muted)}
.live{fill:var(--accent)}
`

type Cell = { width: number; body: (w: number) => string }

const label = (text: string, extra = '') =>
  `<text class="l" x="${PAD}" y="${LABEL_Y}">${esc(text)}${extra}</text>`

const value = (main: string, unit: string, sub: string, cls = 'v') =>
  `<text x="${PAD}" y="${VALUE_Y}"><tspan class="${cls}">${esc(main)}</tspan>` +
  (unit ? `<tspan class="u" dx="2">${esc(unit)}</tspan>` : '') +
  (sub ? `<tspan class="s" dx="8">${esc(sub)}</tspan>` : '') +
  `</text>`

const spark = (values: readonly number[], right: number) => {
  const tail = values.slice(-16)
  if (tail.length < 2) {
    return ''
  }
  const w = 48
  const h = 12
  const x0 = right - w
  const y0 = LABEL_Y - h + 1
  const low = Math.min(...tail)
  const span = Math.max(...tail) - low || 1
  const pts = tail.map((v, i) => [x0 + (i / (tail.length - 1)) * w, y0 + h - ((v - low) / span) * h] as const)
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const [lx, ly] = pts[pts.length - 1]!
  return (
    `<polyline points="${line}" fill="none" stroke="var(--muted)" stroke-opacity=".7" stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2" fill="var(--accent)"/>`
  )
}

const ring = (ratio: number | null, cx: number, cy: number) => {
  const r = 6
  const c = 2 * Math.PI * r
  const dash = ratio === null ? 0 : Math.max(0, Math.min(1, ratio)) * c
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--track)" stroke-width="2.5"/>` +
    (dash > 0
      ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${dash.toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`
      : '')
  )
}

const LEVEL_COLOR = { calm: 'var(--fg)', warn: 'var(--warn)', hot: 'var(--hot)' } as const

const limitCell = (name: string, limit: PulseLimit | null, now: number): Cell => ({
  width: 154,
  body: w => {
    const pct = limit?.pct ?? null
    const left = pct === null ? null : Math.max(0, 100 - pct)
    const countdown = fmtResetAt(limit?.resetsAt ?? null, now)
    const level = usageLevel(pct)
    const x0 = PAD + 50
    const barW = w - PAD - x0
    const fill = left === null ? 0 : Math.min(1, left / 100) * barW
    return (
      label(name) +
      (countdown
        ? `<text class="s" x="${w - PAD}" y="${LABEL_Y}" text-anchor="end">↻ ${esc(countdown)}</text>`
        : '') +
      `<text x="${PAD}" y="${VALUE_Y}"><tspan class="v" style="fill:${level === 'calm' ? 'var(--fg)' : LEVEL_COLOR[level]}">${esc(fmtLeft(pct))}</tspan></text>` +
      `<rect x="${x0}" y="${VALUE_Y - 8.5}" width="${barW}" height="5" rx="2.5" fill="var(--track)"/>` +
      (fill > 0
        ? `<rect x="${x0}" y="${VALUE_Y - 8.5}" width="${Math.max(5, fill).toFixed(1)}" height="5" rx="2.5" fill="${LEVEL_COLOR[level]}" fill-opacity="${level === 'calm' ? 0.72 : 1}"/>`
        : '')
    )
  },
})

export const renderSvg = (m: PulseMetrics, now: number) => {
  const [ttftMain, ttftUnit] = splitMs(m.ttftLast)
  const ttftMean = ttftAvg(m)
  const speedMean = speedAvg(m)
  const isLive = m.isStreaming && m.speedLive !== null
  const speedNow = isLive ? m.speedLive : m.speedLast

  const cells: Cell[] = [
    {
      width: 150,
      body: w =>
        label('TTFT') +
        spark(m.ttftHistory, w - PAD) +
        value(ttftMain, ttftUnit, ttftMean === null ? '' : `Avg ${fmtMs(ttftMean)}`),
    },
    {
      width: 160,
      body: w =>
        label('OUTPUT', isLive ? `<tspan class="live" dx="6">● LIVE</tspan>` : '') +
        (isLive ? '' : spark(m.speedHistory, w - PAD)) +
        value(
          speedNow === null ? DASH : `${isLive ? '~' : ''}${fmtRate(speedNow)}`,
          speedNow === null ? '' : 'tok/s',
          speedMean === null ? '' : `Avg ${fmtRate(speedMean)}`,
        ),
    },
    {
      width: 142,
      body: w => {
        const mean = cacheAvg(m)
        return (
          label('CACHE HIT') +
          ring(m.cacheLast, w - PAD - 6, LABEL_Y - 4) +
          value(fmtPct(m.cacheLast), '', mean === null ? '' : `Avg ${fmtPct(mean)}`)
        )
      },
    },
    limitCell('5H LEFT', m.fiveHour, now),
    limitCell('WEEKLY LEFT', m.week, now),
  ]

  let x = 0
  const groups = cells.map((cell, i) => {
    const g =
      (i > 0 ? `<line x1="${x}" y1="14" x2="${x}" y2="${H - 14}" stroke="var(--line)"/>` : '') +
      `<g transform="translate(${x} 0)">${cell.body(cell.width)}</g>`
    x += cell.width
    return g
  })

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<style>${STYLE}</style>` +
    `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="12" fill="var(--bg)" stroke="var(--line)"/>` +
    groups.join('') +
    `</svg>`
  )
}

export const describe = (m: PulseMetrics) =>
  [
    `TTFT ${fmtMs(m.ttftLast)} (avg ${fmtMs(ttftAvg(m))})`,
    `output ${fmtRate(m.isStreaming ? m.speedLive : m.speedLast)} tok/s (avg ${fmtRate(speedAvg(m))})`,
    `cache hit ${fmtPct(m.cacheLast)} (avg ${fmtPct(cacheAvg(m))})`,
    `5-hour ${fmtLeft(m.fiveHour?.pct ?? null)} left`,
    `weekly ${fmtLeft(m.week?.pct ?? null)} left`,
  ].join(', ')
