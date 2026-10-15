export type PulseLimit = {
  pct: number
  resetsAt: number | null
}

export type PulseMetrics = {
  ttftLast: number | null
  ttftSum: number
  ttftCount: number
  ttftHistory: number[]
  speedLive: number | null
  speedLast: number | null
  speedHistory: number[]
  outTokens: number
  genMs: number
  cacheLast: number | null
  cacheRead: number
  cacheTotal: number
  isStreaming: boolean
  fiveHour: PulseLimit | null
  week: PulseLimit | null
  model: string | null
}

declare module 'claude-code' {
  interface PluginState {
    Pulse: { metrics: Shaped<PulseMetrics> }
  }
}
