import test from 'node:test'
import assert from 'node:assert'
import {
  computeRollingWordsPerMinute,
  countIncrementalTranscriptWords,
  mapWpmToSpeedFactor,
  trimSpeechPaceSamples,
} from '../src/utils/speechPacing.js'

test('countIncrementalTranscriptWords ignores overlapping partial transcript text', () => {
  assert.strictEqual(
    countIncrementalTranscriptWords(
      'we are going to walk through',
      'going to walk through the workflow today',
    ),
    3,
  )
})

test('trimSpeechPaceSamples keeps only recent pacing samples', () => {
  const trimmed = trimSpeechPaceSamples([
    { timeMs: 1000, wordCount: 2 },
    { timeMs: 2500, wordCount: 2 },
    { timeMs: 4200, wordCount: 3 },
  ], 5000, 2000)

  assert.deepStrictEqual(trimmed, [
    { timeMs: 4200, wordCount: 3 },
  ])
})

test('computeRollingWordsPerMinute converts recent word events into a rolling pace', () => {
  const wpm = computeRollingWordsPerMinute([
    { timeMs: 1000, wordCount: 4 },
    { timeMs: 2500, wordCount: 4 },
    { timeMs: 4000, wordCount: 4 },
  ], 5000, 5000)

  assert.ok(wpm > 120)
  assert.ok(wpm < 200)
})

test('mapWpmToSpeedFactor scales up faster speech while preserving a floor', () => {
  assert.strictEqual(mapWpmToSpeedFactor(0), 1)
  assert.ok(mapWpmToSpeedFactor(95) >= 0.9)
  assert.ok(mapWpmToSpeedFactor(210) > 1.2)
})
