function normalizeWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9'\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

export function countIncrementalTranscriptWords(previousTranscript = '', nextTranscript = '') {
  const previousWords = normalizeWords(previousTranscript)
  const nextWords = normalizeWords(nextTranscript)
  if (!nextWords.length) return 0
  if (!previousWords.length) return nextWords.length

  const maxOverlap = Math.min(previousWords.length, nextWords.length)
  let overlap = 0

  for (let size = maxOverlap; size >= 1; size -= 1) {
    const previousTail = previousWords.slice(previousWords.length - size).join(' ')
    const nextHead = nextWords.slice(0, size).join(' ')
    if (previousTail !== nextHead) continue
    overlap = size
    break
  }

  return Math.max(0, nextWords.length - overlap)
}

export function trimSpeechPaceSamples(samples = [], nowMs = Date.now(), windowMs = 4000) {
  return samples.filter((sample) => (nowMs - sample.timeMs) <= windowMs)
}

export function computeRollingWordsPerMinute(samples = [], nowMs = Date.now(), windowMs = 4000) {
  const recent = trimSpeechPaceSamples(samples, nowMs, windowMs)
  if (!recent.length) return 0

  const words = recent.reduce((sum, sample) => sum + Math.max(0, sample.wordCount || 0), 0)
  if (!words) return 0

  const earliestTime = recent[0]?.timeMs ?? nowMs
  const elapsedMs = Math.max(1000, nowMs - earliestTime)
  return (words * 60000) / elapsedMs
}

export function mapWpmToSpeedFactor(wpm = 0, config = {}) {
  const {
    referenceWpm = 145,
    minSpeedFactor = 0.9,
    maxSpeedFactor = 2.15,
    speedCurve = 0.8,
  } = config

  if (!Number.isFinite(wpm) || wpm <= 0) return 1

  const normalized = Math.max(0.1, wpm / Math.max(1, referenceWpm))
  const curved = normalized >= 1
    ? Math.pow(normalized, speedCurve)
    : Math.pow(normalized, speedCurve * 0.55)

  return Math.min(maxSpeedFactor, Math.max(minSpeedFactor, curved))
}
