import test from 'node:test'
import assert from 'node:assert'
import {
  computeSpeechScrollStep,
  resolveSpeechTargetLineCenter,
  shouldRejectLargeRewind,
  shouldReleaseResumeGate,
  updateVirtualTarget,
} from '../src/utils/speechFollowMotion.js'

const DEFAULT_CONFIG = {
  targetBlend: 0.24,
  targetMaxStepPx: 68,
  targetDeadbandPx: 5,
  pursuitStiffness: 0.032,
  pursuitDamping: 0.18,
  rewindStiffness: 0.046,
  recoverySnapThreshold: 1.1,
  maxSpeed: 14,
  rewindMinSpeed: -3.25,
  nearPauseSpeed: 0.02,
  idleCrawlSpeed: 0.035,
  matchLossGraceMs: 900,
  matchLossPauseMs: 2400,
  resumeGateSilenceMs: 900,
  resumeReacquireConfidence: 0.46,
  resumeReacquireMaxDistance: 2,
  maxSoftRewindLines: 6,
  hardRewindConfidence: 0.88,
  hardRewindStableCount: 3,
}

test('updateVirtualTarget bounds small successive target updates', () => {
  const first = updateVirtualTarget({
    previousTarget: 100,
    rawTarget: 104,
    source: 'token_rect',
    previousSource: 'token_rect',
    config: DEFAULT_CONFIG,
  })

  assert.strictEqual(first.targetLineCenter, 100)

  const second = updateVirtualTarget({
    previousTarget: 100,
    rawTarget: 180,
    source: 'token_rect',
    previousSource: 'token_rect',
    config: DEFAULT_CONFIG,
  })

  assert.ok(second.targetLineCenter > 100)
  assert.ok(second.targetLineCenter < 180)
  assert.ok(second.targetLineCenter <= 100 + DEFAULT_CONFIG.targetMaxStepPx * DEFAULT_CONFIG.targetBlend + 0.001)
})

test('updateVirtualTarget smooths source transitions instead of replacing the target', () => {
  const next = updateVirtualTarget({
    previousTarget: 300,
    rawTarget: 360,
    source: 'anchor_fallback',
    previousSource: 'token_rect',
    config: DEFAULT_CONFIG,
  })

  assert.match(next.targetSourceTransition, /token_rect->anchor_fallback/)
  assert.ok(next.targetLineCenter > 300)
  assert.ok(next.targetLineCenter < 330)
})

test('resolveSpeechTargetLineCenter prefers live overlay geometry', () => {
  const result = resolveSpeechTargetLineCenter({
    speechTarget: { index: 1 },
    speechOverlayRect: {
      anchorIndex: 1,
      lineTop: 420,
      lineHeight: 32,
      source: 'token_rect',
    },
    anchors: [],
  })

  assert.strictEqual(result.rawTargetLineCenter, 436)
  assert.strictEqual(result.targetSource, 'token_rect')
})

test('computeSpeechScrollStep keeps nearby target transitions in pursuit mode', () => {
  const result = computeSpeechScrollStep({
    scrollTop: 200,
    clientHeight: 400,
    scrollHeight: 4000,
    eyelineOffset: 150,
    currentSpeed: 1.2,
    baseSpeed: 1,
    virtualTargetLineCenter: 380,
    liveTargetLineCenter: 382,
    targetDirection: 'forward',
    targetConfidence: 0.68,
    recoveryScrollTop: null,
    canAutoAdjust: true,
    config: DEFAULT_CONFIG,
  })

  assert.strictEqual(result.controllerMode, 'pursuit')
  assert.ok(result.nextSpeed > 0)
})

test('computeSpeechScrollStep uses rewind glide for committed rewinds', () => {
  const result = computeSpeechScrollStep({
    scrollTop: 500,
    clientHeight: 420,
    scrollHeight: 4000,
    eyelineOffset: 160,
    currentSpeed: 0.8,
    baseSpeed: 0.9,
    virtualTargetLineCenter: 420,
    liveTargetLineCenter: 418,
    targetDirection: 'rewind',
    targetConfidence: 0.85,
    recoveryScrollTop: 360,
    canAutoAdjust: true,
    config: DEFAULT_CONFIG,
  })

  assert.strictEqual(result.controllerMode, 'rewind_glide')
  assert.ok(result.nextSpeed < 0)
  assert.ok(result.desiredSpeed >= DEFAULT_CONFIG.rewindMinSpeed)
})

test('computeSpeechScrollStep escalates to recovery snap only for large desyncs', () => {
  const result = computeSpeechScrollStep({
    scrollTop: 100,
    clientHeight: 400,
    scrollHeight: 4000,
    eyelineOffset: 150,
    currentSpeed: 0.4,
    baseSpeed: 0.8,
    virtualTargetLineCenter: null,
    liveTargetLineCenter: null,
    targetDirection: 'forward',
    targetConfidence: 0.9,
    recoveryScrollTop: 900,
    canAutoAdjust: true,
    config: DEFAULT_CONFIG,
  })

  assert.strictEqual(result.controllerMode, 'recovery_snap')
  assert.strictEqual(result.recoveryActive, true)
  assert.ok(result.nextScrollTop > 100)
})

test('computeSpeechScrollStep slows when speech continues without a suitable match', () => {
  const result = computeSpeechScrollStep({
    scrollTop: 220,
    clientHeight: 420,
    scrollHeight: 4000,
    eyelineOffset: 160,
    currentSpeed: 1.1,
    baseSpeed: 1,
    virtualTargetLineCenter: null,
    liveTargetLineCenter: null,
    targetDirection: 'forward',
    targetConfidence: 0,
    recoveryScrollTop: null,
    timeSinceGoodMatchMs: 1500,
    canAutoAdjust: true,
    config: DEFAULT_CONFIG,
  })

  assert.strictEqual(result.controllerMode, 'match_lost_glide')
  assert.strictEqual(result.matchLossActive, true)
  assert.ok(result.desiredSpeed < 1)
  assert.ok(result.desiredSpeed > 0)
})

test('computeSpeechScrollStep pauses after a longer period without a suitable match', () => {
  const result = computeSpeechScrollStep({
    scrollTop: 220,
    clientHeight: 420,
    scrollHeight: 4000,
    eyelineOffset: 160,
    currentSpeed: 0.6,
    baseSpeed: 1,
    virtualTargetLineCenter: null,
    liveTargetLineCenter: null,
    targetDirection: 'forward',
    targetConfidence: 0,
    recoveryScrollTop: 900,
    timeSinceGoodMatchMs: 3200,
    canAutoAdjust: true,
    config: DEFAULT_CONFIG,
  })

  assert.strictEqual(result.controllerMode, 'match_lost_hold')
  assert.strictEqual(result.matchLossActive, true)
  assert.strictEqual(result.recoveryActive, false)
  assert.ok(result.desiredSpeed <= 0.001)
})

test('shouldReleaseResumeGate requires a believable nearby match', () => {
  assert.strictEqual(
    shouldReleaseResumeGate({
      match: {
        matchedAnchor: { index: 8 },
        candidateIndex: 8,
        confidence: 0.52,
        selectedHighlightToken: 'workflow',
      },
      currentAnchorIndex: 7,
      config: DEFAULT_CONFIG,
    }),
    true,
  )

  assert.strictEqual(
    shouldReleaseResumeGate({
      match: {
        matchedAnchor: { index: 12 },
        candidateIndex: 12,
        confidence: 0.52,
        selectedHighlightToken: 'workflow',
      },
      currentAnchorIndex: 7,
      config: DEFAULT_CONFIG,
    }),
    false,
  )
})

test('shouldRejectLargeRewind blocks far backwards jumps without very strong evidence', () => {
  assert.strictEqual(
    shouldRejectLargeRewind({
      match: {
        matchedAnchor: { index: 2 },
        candidateIndex: 2,
        direction: 'rewind',
        confidence: 0.73,
        selectedHighlightToken: 'start',
      },
      currentAnchorIndex: 14,
      stableMatchCount: 2,
      config: DEFAULT_CONFIG,
    }),
    true,
  )

  assert.strictEqual(
    shouldRejectLargeRewind({
      match: {
        matchedAnchor: { index: 2 },
        candidateIndex: 2,
        direction: 'rewind',
        confidence: 0.91,
        selectedHighlightToken: 'start',
      },
      currentAnchorIndex: 14,
      stableMatchCount: 3,
      config: DEFAULT_CONFIG,
    }),
    false,
  )
})
