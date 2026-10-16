import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { PulseLayout, PulseMetrics } from '../types'
import { DASH, fmtMs, fmtPct, fmtLeft, fmtRate, fmtResetAt, fmtUsed, sparkline } from './format'
import {
  applyLimits,
  cacheAvg,
  EMPTY,
  endStep,
  recordLive,
  recordStop,
  resetSession,
  speedAvg,
  median,
  startStep,
  stepTimer,
  ttftAvg,
} from './metrics'
import { statusLine } from './status'
import { describe, renderSvg } from './svg'

const LIVE_MS = 400
const LIMITS_MS = 60_000
const PANE = 'pulse'

// bump the shape when stored metrics must be dropped (a schema change, or figures measured wrong)
const LAYOUT_KEY = 'layout'
const layoutAtom = atom({ plugin: 'Pulse', key: 'layout' } as const, 'full' as PulseLayout)

const metrics = atom({ plugin: 'Pulse', key: 'metrics' } as const, EMPTY, { shape: '2' })

let hasReportedSaveError = false
// mirrors the layout atom so every status write uses it without a read; persisted in $.store
let layout: PulseLayout = 'full'

const save = ($: EngineInterface, change: (m: PulseMetrics) => PulseMetrics) =>
  update($, metrics, change).then(
    m => $.ui.status(statusLine(m, Date.now(), layout)),
    (error: unknown) => {
      if (!hasReportedSaveError) {
        hasReportedSaveError = true
        $.ui.log(`Pulse: metrics could not be saved, the status line stops updating (${String(error)})`)
      }
    },
  )

const refreshLimits = async ($: EngineInterface) => {
  try {
    const usage = await $.session.usage()
    await save($, m => applyLimits(m, usage.rateLimits))
  } catch {
    // usage is best effort: a session without rate-limit readings keeps the last ones
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pulse', description: 'Open the Pulse details pane' })
    const result = await next(e)
    layout = (await $.store.get(LAYOUT_KEY)) === 'compact' ? 'compact' : 'full'
    await update($, layoutAtom, () => layout)
    $.ui.status(statusLine(await read($, metrics), Date.now(), layout))
    void refreshLimits($)
    $.clock.every(LIMITS_MS, () => void refreshLimits($))
    return result
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await save($, resetSession)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    if (e.agentId !== undefined) {
      return yield* stream
    }

    const typicalTtft = median((await read($, metrics)).ttftHistory)
    const timer = stepTimer(Date.now(), LIVE_MS)
    let ttft: number | null = null
    let stopAt: number | null = null
    let usage: TurnUsage | null = null
    let isSettled = false

    const settle = async () => {
      if (isSettled) {
        return
      }
      isSettled = true
      const genMs = stopAt === null ? null : timer.genMs(stopAt, typicalTtft)
      const final = usage
      // a request that failed has no usage; its first chunk was the error, not a token
      await save($, m => (final === null ? endStep(m) : recordStop(m, final, genMs, ttft)))
      void refreshLimits($)
    }

    await save($, startStep)
    try {
      for await (const chunk of stream) {
        const now = Date.now()
        if (chunk.kind === 'stop') {
          stopAt = now
          usage = chunk.usage
        }
        const text =
          chunk.kind === 'text' || chunk.kind === 'thinking'
            ? chunk.text
            : chunk.kind === 'input'
              ? chunk.json
              : chunk.kind === 'tool'
                ? chunk.name
                : undefined
        const timing = timer.chunk(chunk.kind, now, text)
        ttft ??= timing.ttft ?? null
        const live = timing.live
        const change = live === undefined ? null : (m: PulseMetrics) => recordLive(m, live)

        yield chunk
        if (change !== null) {
          await save($, change)
        }
      }

      const result = await stream.result
      usage ??= result.usage
      stopAt ??= Date.now()
      await settle()
      return result
    } finally {
      await settle()
    }
  })

  on('command.run', { command: 'pulse' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Pulse', focus: true, closeOnEscape: true })
    return { text: 'Pulse opened.' }
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const target: PulseLayout = (await read($, layoutAtom)) === 'full' ? 'compact' : 'full'
    const toggle = async () => {
      layout = target
      await update($, layoutAtom, () => target)
      $.ui.status(statusLine(await read($, metrics), Date.now(), target))
      await $.store.set(LAYOUT_KEY, target)
    }
    return (
      <Box flexDirection="row">
        {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')} </Text>}
        <Button key="layout" plain dimColor label={target === 'compact' ? '−' : '+'} onPress={() => void toggle()} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const m = await read($, metrics)
    const now = Date.now()
    const row = (key: string, value: string) => ({ key, value })
    const rows = [
      row('Model', m.model ?? DASH),
      row('Requests measured', String(m.ttftCount)),
      row('TTFT', `Last ${fmtMs(m.ttftLast)} · Avg ${fmtMs(ttftAvg(m))} · Trend ${sparkline(m.ttftHistory, 16) || DASH}`),
      row(
        'Output',
        `Last ${fmtRate(m.speedLast)} tok/s · Avg ${fmtRate(speedAvg(m))} tok/s · ${m.outTokens.toLocaleString('en-US')} tokens`,
      ),
      row(
        'Cache hit',
        `Last ${fmtPct(m.cacheLast)} · Session ${fmtPct(cacheAvg(m))} (${m.cacheRead.toLocaleString('en-US')} of ${m.cacheTotal.toLocaleString('en-US')} prompt tokens)`,
      ),
      row('5-hour', `${fmtLeft(m.fiveHour?.pct ?? null)} left (${fmtUsed(m.fiveHour?.pct ?? null)} used) · Resets ${fmtResetAt(m.fiveHour?.resetsAt ?? null, now) || DASH}`),
      row('Weekly', `${fmtLeft(m.week?.pct ?? null)} left (${fmtUsed(m.week?.pct ?? null)} used) · Resets ${fmtResetAt(m.week?.resetsAt ?? null, now) || DASH}`),
    ]

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          {rows.map(r => (
            <Box flexDirection="row">
              <Box width={20} flexShrink={0}>
                <Text dimColor>{r.key}</Text>
              </Box>
              <Text>{r.value}</Text>
            </Box>
          ))}
        </Box>
      )
    }

    const { Box, Svg, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" gap={1}>
        <Svg source={renderSvg(m, now)} alt={describe(m)} />
        {rows.map(r => (
          <Box flexDirection="row">
            <Box width={20} flexShrink={0}>
              <Text dimColor>{r.key}</Text>
            </Box>
            <Text>{r.value}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
