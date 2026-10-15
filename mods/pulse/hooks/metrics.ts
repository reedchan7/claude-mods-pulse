import type { ModelUsage, SessionRateLimit } from 'claude-code'

import type { PulseLimit, PulseMetrics } from '../types'

const HISTORY = 24
const MIN_GEN_MS = 120
// Anthropic decode throughput never reaches this; above it the window was mismeasured
const MAX_TOK_PER_SEC = 250
const LATE_FACTOR = 2

export const EMPTY: PulseMetrics = {
  ttftLast: null,
  ttftSum: 0,
  ttftCount: 0,
  ttftHistory: [],
  speedLive: null,
  speedLast: null,
  speedHistory: [],
  outTokens: 0,
  genMs: 0,
  cacheLast: null,
  cacheRead: 0,
  cacheTotal: 0,
  isStreaming: false,
  fiveHour: null,
  week: null,
  model: null,
}

const push = (list: number[], value: number) => [...list, value].slice(-HISTORY)

const WIDE = /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g

export const estimateTokens = (text: string) => {
  const wide = text.match(WIDE)?.length ?? 0
  return wide + (text.length - wide) / 3.6
}

export type StepTimer = {
  chunk: (kind: string, now: number, text?: string) => { ttft?: number; live?: number }
  genMs: (stopAt: number, typicalTtft: number | null) => number | null
}

// output_tokens counts hidden thinking, so the window must start when generation did: at the
// first chunk of any kind, or, when even that waits out the thinking (--thinking-display
// omitted sometimes streams nothing until it ends), at the session's typical TTFT once the
// first chunk is more than twice as late as that
export const stepTimer = (startedAt: number, liveMs: number): StepTimer => {
  let firstAt: number | null = null
  let visibleAt: number | null = null
  let lastLive = 0
  let tokens = 0
  return {
    chunk: (kind, now, text) => {
      const out: { ttft?: number; live?: number } = {}
      if (firstAt === null) {
        firstAt = now
        out.ttft = now - startedAt
      }
      if (kind === 'engine' || kind === 'stop') {
        return out
      }
      if (visibleAt === null) {
        visibleAt = now
        lastLive = now
      }
      tokens += estimateTokens(text ?? '')
      if (out.ttft === undefined && now - lastLive >= liveMs) {
        lastLive = now
        const elapsed = now - visibleAt
        if (elapsed >= MIN_GEN_MS && tokens > 0) {
          out.live = (tokens / elapsed) * 1000
        }
      }
      return out
    },
    genMs: (stopAt, typicalTtft) => {
      if (firstAt === null) {
        return null
      }
      const isLate = typicalTtft !== null && firstAt - startedAt > LATE_FACTOR * typicalTtft
      return stopAt - (isLate ? startedAt + typicalTtft : firstAt)
    },
  }
}

export const median = (values: readonly number[]) => {
  if (values.length === 0) {
    return null
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export const startStep = (m: PulseMetrics): PulseMetrics => ({
  ...m,
  isStreaming: true,
  speedLive: null,
})

const recordTtft = (m: PulseMetrics, ttft: number): PulseMetrics => ({
  ...m,
  ttftLast: ttft,
  ttftSum: m.ttftSum + ttft,
  ttftCount: m.ttftCount + 1,
  ttftHistory: push(m.ttftHistory, ttft),
})

export const recordLive = (m: PulseMetrics, speed: number): PulseMetrics => ({ ...m, speedLive: speed })

export const recordStop = (
  m: PulseMetrics,
  usage: (ModelUsage & { model?: string }) | null,
  genMs: number | null,
  ttft: number | null = null,
): PulseMetrics => {
  let next: PulseMetrics = { ...m, isStreaming: false, speedLive: null }
  if (usage === null) {
    return next
  }
  if (ttft !== null) {
    next = recordTtft(next, ttft)
  }

  const out = usage.output_tokens
  const speed = genMs !== null && genMs >= MIN_GEN_MS && out > 0 ? (out / genMs) * 1000 : null
  if (genMs !== null && speed !== null && speed <= MAX_TOK_PER_SEC) {
    next = {
      ...next,
      speedLast: speed,
      speedHistory: push(next.speedHistory, speed),
      outTokens: next.outTokens + out,
      genMs: next.genMs + genMs,
    }
  }

  const prompt = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  if (prompt > 0) {
    next = {
      ...next,
      cacheLast: usage.cache_read_input_tokens / prompt,
      cacheRead: next.cacheRead + usage.cache_read_input_tokens,
      cacheTotal: next.cacheTotal + prompt,
    }
  }

  return usage.model ? { ...next, model: usage.model } : next
}

export const endStep = (m: PulseMetrics): PulseMetrics =>
  m.isStreaming ? { ...m, isStreaming: false, speedLive: null } : m

const toLimit = (limit: SessionRateLimit | undefined): PulseLimit | null => {
  if (limit === undefined) {
    return null
  }
  const resetsAt = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN
  return { pct: limit.percentUsed, resetsAt: Number.isNaN(resetsAt) ? null : resetsAt }
}

export const applyLimits = (m: PulseMetrics, limits: readonly SessionRateLimit[]): PulseMetrics => ({
  ...m,
  fiveHour: toLimit(limits.find(l => l.kind === 'five_hour')) ?? m.fiveHour,
  week: toLimit(limits.find(l => l.kind === 'seven_day')) ?? m.week,
})

export const resetSession = (m: PulseMetrics): PulseMetrics => ({
  ...EMPTY,
  fiveHour: m.fiveHour,
  week: m.week,
})

export const ttftAvg = (m: PulseMetrics) => (m.ttftCount > 0 ? m.ttftSum / m.ttftCount : null)

export const speedAvg = (m: PulseMetrics) => (m.genMs > 0 ? (m.outTokens / m.genMs) * 1000 : null)

export const cacheAvg = (m: PulseMetrics) => (m.cacheTotal > 0 ? m.cacheRead / m.cacheTotal : null)
