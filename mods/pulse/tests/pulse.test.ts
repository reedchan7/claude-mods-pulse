import { expect, test } from 'claude-code/testing'
import type { On, TurnStepChunk, TurnStepResult } from 'claude-code'

import { fmtLeft, fmtMs, fmtPct, fmtResetAt, sparkline } from '../hooks/format'
import { applyLimits, cacheAvg, EMPTY, estimateTokens, median, recordStop, speedAvg, stepTimer } from '../hooks/metrics'
import { statusLine } from '../hooks/status'

declare const setTimeout: (fn: () => void, ms: number) => unknown

const near = (actual: number | null, expected: number) =>
  expect(actual !== null && Math.abs(actual - expected) < 1e-6).toBe(true)

const USAGE = {
  model: 'claude-opus-5-5',
  input_tokens: 200,
  output_tokens: 300,
  cache_read_input_tokens: 9_000,
  cache_creation_input_tokens: 800,
}

const RESULT: TurnStepResult = {
  turnId: 't1',
  index: 0,
  answer: 'hello world',
  toolUses: [],
  stopReason: 'end_turn',
  usage: USAGE,
}

const STEP = { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

const watchStatus = (on: On) => {
  const lines: (string | undefined)[] = []
  on('ui.status', (_, e) => {
    lines.push(e.text)
    return { value: undefined }
  })
  return () => lines[lines.length - 1] ?? ''
}


const PANE = {
  plugin: 'Pulse',
  component: 'Pane',
  requestId: 'pulse',
  props: { title: 'Pulse', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('cache hit and speed come from the step usage', async () => {
  const m = recordStop(EMPTY, USAGE, 1_500, 640)
  near(m.cacheLast, 9_000 / 10_000)
  near(m.speedLast, 200)
  near(speedAvg(m), 200)
  near(cacheAvg(m), 0.9)
  expect(m.ttftLast).toBe(640)
  expect(m.model).toBe('claude-opus-5-5')
})

test('too-short generations do not skew speed', async () => {
  const m = recordStop(EMPTY, USAGE, 40)
  expect(m.speedLast).toBe(null)
  expect(m.outTokens).toBe(0)
  near(m.cacheLast, 0.9)
})

test('rate limits map to the five-hour and weekly windows', async () => {
  const m = applyLimits(EMPTY, [
    { kind: 'five_hour', percentUsed: 34.5, resetsAt: '2026-10-15T12:00:00Z' },
    { kind: 'seven_day', percentUsed: 12 },
  ])
  expect(m.fiveHour).toEqual({ pct: 34.5, resetsAt: Date.parse('2026-10-15T12:00:00Z') })
  expect(m.week).toEqual({ pct: 12, resetsAt: null })
})

test('formatting', async () => {
  expect(fmtMs(820)).toBe('820ms')
  expect(fmtMs(1_234)).toBe('1.23s')
  const now = new Date(2026, 9, 15, 10, 0).getTime()
  expect(fmtResetAt(new Date(2026, 9, 15, 15, 27).getTime(), now)).toBe('15:27')
  expect(fmtResetAt(new Date(2026, 9, 16, 9, 0).getTime(), now)).toBe('Fri 09:00')
  expect(fmtResetAt(new Date(2026, 9, 25, 9, 0).getTime(), now)).toBe('10/25 09:00')
  expect(fmtResetAt(null, now)).toBe('')
  expect(sparkline([1, 2, 3], 8)).toBe('▁▅█')
  expect(estimateTokens('你好世界')).toBe(4)
})

test('the status line spells out every figure', async () => {
  const now = new Date(2026, 9, 15, 10, 0).getTime()
  const m = applyLimits(recordStop(EMPTY, USAGE, 1_500, 640), [
    { kind: 'five_hour', percentUsed: 34, resetsAt: new Date(2026, 9, 15, 15, 27).toISOString() },
    { kind: 'seven_day', percentUsed: 92, resetsAt: new Date(2026, 9, 16, 9, 0).toISOString() },
  ])
  const gap = '\u2002\u2002│\u2002\u2002'
  expect(statusLine(m, now)).toBe(
    ['TTFT 640ms · Avg 640ms', '200 tok/s · Avg 200', 'Cache Hit 90.0%', '5H 66% left · Resets 15:27', 'Weekly 8% left · Resets Fri 09:00'].join(gap),
  )
  expect(statusLine({ ...m, isStreaming: true, speedLive: 63.24 }, now)).toContain('● 63.2 tok/s')
  expect(statusLine(EMPTY, now)).toBe(
    ['TTFT — · Avg —', '— tok/s · Avg —', 'Cache Hit —', '5H —', 'Weekly —'].join(gap),
  )
})

test('remaining usage is the complement of what is used', async () => {
  expect(fmtLeft(34)).toBe('66%')
  expect(fmtLeft(104)).toBe('0%')
  expect(fmtLeft(null)).toBe('—')
})

test('a near-total cache hit is never rounded up to 100%', async () => {
  expect(fmtPct(0.9978)).toBe('99.8%')
  expect(fmtPct(0.99996)).toBe('99.9%')
  expect(fmtPct(1)).toBe('100.0%')
})

test('a main-thread step records TTFT, speed and cache hit', async ($, on) => {
  const status = watchStatus(on)
  on('turn.step', async function* () {
    await pause(60)
    const chunks: TurnStepChunk[] = [
      { kind: 'text', index: 0, text: 'hello ' },
      { kind: 'text', index: 0, text: 'world' },
    ]
    for (const chunk of chunks) {
      yield chunk
      await pause(150)
    }
    yield { kind: 'stop', stopReason: 'end_turn', usage: { ...USAGE, output_tokens: 30 } }
    return RESULT
  })
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200_000 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 41 }],
    },
  }))

  const stream = $.turn.step(STEP)
  const seen: TurnStepChunk[] = []
  let step = await stream.next()
  while (!step.done) {
    seen.push(step.value)
    step = await stream.next()
  }
  expect(step.value).toEqual(RESULT)
  expect(seen.map(c => c.kind)).toEqual(['text', 'text', 'stop'])

  await pause(20)
  expect(status().split('\u2002\u2002│\u2002\u2002')).toEqual([
    expect.stringMatching(/^TTFT \d+ms · Avg \d+ms$/),
    expect.stringMatching(/^\d+(\.\d)? tok\/s · Avg \d+(\.\d)?$/),
    'Cache Hit 90.0%',
    '5H 59% left',
    'Weekly —',
  ])
})

test('hidden thinking counts toward the generation window, not just the visible text', async () => {
  const timer = stepTimer(1_000, 400)
  expect(timer.chunk('engine', 2_000)).toEqual({ ttft: 1_000 })
  expect(timer.chunk('text', 8_000, 'done')).toEqual({})
  expect(timer.chunk('stop', 9_000)).toEqual({})
  expect(timer.genMs(9_000, null)).toBe(7_000)
  const m = recordStop(EMPTY, { ...USAGE, output_tokens: 700 }, timer.genMs(9_000, null))
  near(m.speedLast, 100)
})

test('a stream that waits out hidden thinking starts its window at the typical TTFT', async () => {
  // a real request of this session: nothing arrived for 9.4s, then text until 14.0s
  const timer = stepTimer(0, 400)
  expect(timer.chunk('engine', 9_407)).toEqual({ ttft: 9_407 })
  timer.chunk('text', 9_412, 'answer')
  timer.chunk('stop', 13_990)
  expect(timer.genMs(13_990, 1_000)).toBe(12_990)
  expect(timer.genMs(13_990, null)).toBe(4_583)
  near(recordStop(EMPTY, { ...USAGE, output_tokens: 1_224 }, timer.genMs(13_990, 1_000)).speedLast, (1_224 / 12_990) * 1000)
})

test('an early first chunk is not moved by the typical TTFT', async () => {
  const timer = stepTimer(0, 400)
  timer.chunk('engine', 1_092)
  expect(timer.genMs(5_000, 976)).toBe(3_908)
})

test('implausible speeds are dropped, not averaged', async () => {
  const m = recordStop(EMPTY, { ...USAGE, output_tokens: 3_000 }, 1_000)
  expect(m.speedLast).toBe(null)
  expect(m.outTokens).toBe(0)
  near(m.cacheLast, 0.9)
  expect(median([9_407, 1_000, 950, 1_100])).toBe(1_050)
  expect(median([])).toBe(null)
})

test('the live estimate counts only visible text over visible time', async () => {
  const timer = stepTimer(0, 400)
  timer.chunk('engine', 100)
  timer.chunk('text', 1_000, 'a'.repeat(36))
  expect(timer.chunk('text', 1_500, 'a'.repeat(36))).toEqual({ live: 40 })
})

test('no live estimate before any visible token', async () => {
  const timer = stepTimer(0, 400)
  timer.chunk('engine', 100)
  timer.chunk('thinking', 200, '')
  expect(timer.chunk('thinking', 900, '')).toEqual({})
})

test('a failed request records no TTFT', async ($, on) => {
  const status = watchStatus(on)
  on('turn.step', async function* () {
    yield { kind: 'stop', stopReason: null, usage: null }
    return { ...RESULT, stopReason: null, usage: null }
  })
  const stream = $.turn.step(STEP)
  for await (const _ of stream) {
    // drain
  }
  await pause(20)
  expect(status()).toMatch(/^TTFT — · Avg —/)
})

test('subagent steps are left out', async ($, on) => {
  const status = watchStatus(on)
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'sub' }
    return RESULT
  })

  const stream = $.turn.step({ ...STEP, agentId: 'a1' })
  for await (const _ of stream) {
    // drain
  }
  expect(status()).not.toMatch(/\d+ms/)
})

test('/pulse opens the details pane', async ($, on) => {
  const opened: string[] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  await $.command.run({
    command: 'pulse',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  expect(opened).toEqual(['pulse'])
})

test('the details pane draws the card on desktop and rows on terminal', async $ => {
  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desktop.find({ type: 'Svg' })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: /Requests measured/ })).toBeDefined()
  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await terminal.find({ type: 'Text', text: /Weekly/ })).toBeDefined()
})
