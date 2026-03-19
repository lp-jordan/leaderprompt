function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function shouldReleaseResumeGate({
  match = null,
  currentAnchorIndex = 0,
  config = {},
} = {}) {
  const {
    resumeReacquireConfidence = 0.46,
    resumeReacquireMaxDistance = 2,
  } = config

  if (!match?.matchedAnchor || !(match.selectedHighlightToken || '')) return false
  if ((match.confidence ?? 0) < resumeReacquireConfidence) return false

  const candidateIndex = match.candidateIndex ?? match.matchedAnchor.index ?? currentAnchorIndex
  return Math.abs(candidateIndex - currentAnchorIndex) <= resumeReacquireMaxDistance
}

export function shouldRejectLargeRewind({
  match = null,
  currentAnchorIndex = 0,
  stableMatchCount = 0,
  config = {},
} = {}) {
  const {
    maxSoftRewindLines = 6,
    hardRewindConfidence = 0.88,
    hardRewindStableCount = 3,
  } = config

  if (!match?.matchedAnchor || match.direction !== 'rewind') return false

  const rewindDistance = currentAnchorIndex - (match.candidateIndex ?? match.matchedAnchor.index)
  if (rewindDistance <= maxSoftRewindLines) return false

  return !(
    (match.confidence ?? 0) >= hardRewindConfidence &&
    stableMatchCount >= hardRewindStableCount &&
    (match.selectedHighlightToken || '')
  )
}

export function updateVirtualTarget({
  previousTarget = null,
  rawTarget = null,
  source = '',
  previousSource = '',
  config = {},
} = {}) {
  if (!Number.isFinite(rawTarget)) {
    return {
      targetLineCenter: previousTarget,
      targetSource: previousSource || source || '',
      targetSourceTransition: previousSource && source && previousSource !== source
        ? `${previousSource}->${source}`
        : previousSource || source || '',
    }
  }

  if (!Number.isFinite(previousTarget)) {
    return {
      targetLineCenter: rawTarget,
      targetSource: source || previousSource || '',
      targetSourceTransition: source || previousSource || '',
    }
  }

  const {
    targetBlend = 0.24,
    targetMaxStepPx = 72,
    targetDeadbandPx = 5,
  } = config

  const sourceChanged = Boolean(source && previousSource && source !== previousSource)
  const sourceTransition = sourceChanged ? `${previousSource}->${source}` : (source || previousSource || '')
  const transitionBlend = sourceChanged ? Math.max(0.16, targetBlend * 0.6) : targetBlend
  const delta = rawTarget - previousTarget

  if (Math.abs(delta) <= targetDeadbandPx) {
    return {
      targetLineCenter: previousTarget,
      targetSource: source || previousSource || '',
      targetSourceTransition: sourceTransition,
    }
  }

  const boundedTarget = previousTarget + clamp(delta, -targetMaxStepPx, targetMaxStepPx)
  const nextTarget = previousTarget + (boundedTarget - previousTarget) * transitionBlend

  return {
    targetLineCenter: nextTarget,
    targetSource: source || previousSource || '',
    targetSourceTransition: sourceTransition,
  }
}

export function resolveSpeechTargetLineCenter({
  speechTarget = null,
  speechOverlayRect = null,
  anchors = [],
} = {}) {
  if (!speechTarget) {
    return { rawTargetLineCenter: null, targetSource: '' }
  }

  if (
    speechOverlayRect &&
    speechOverlayRect.anchorIndex === speechTarget.index &&
    Number.isFinite(speechOverlayRect.lineTop) &&
    Number.isFinite(speechOverlayRect.lineHeight)
  ) {
    return {
      rawTargetLineCenter: speechOverlayRect.lineTop + speechOverlayRect.lineHeight / 2,
      targetSource: speechOverlayRect.source || 'overlay',
    }
  }

  const anchorElement = anchors[speechTarget.index]?.element
  if (!anchorElement) {
    return { rawTargetLineCenter: null, targetSource: '' }
  }

  return {
    rawTargetLineCenter:
      (anchorElement.offsetTop || 0) + Math.max(anchorElement.offsetHeight || 0, 24) / 2,
    targetSource: 'anchor_fallback',
  }
}

export function computeSpeechScrollStep({
  scrollTop = 0,
  clientHeight = 0,
  scrollHeight = 0,
  eyelineOffset = 0,
  currentSpeed = 0,
  baseSpeed = 0,
  virtualTargetLineCenter = null,
  liveTargetLineCenter = null,
  targetDirection = 'hold',
  targetConfidence = 0,
  recoveryScrollTop = null,
  timeSinceGoodMatchMs = Number.POSITIVE_INFINITY,
  canAutoAdjust = true,
  config = {},
} = {}) {
  const {
    pursuitStiffness = 0.035,
    pursuitDamping = 0.2,
    rewindStiffness = 0.05,
    recoverySnapThreshold = 1.15,
    maxSpeed = 14,
    rewindMinSpeed = -3.25,
    nearPauseSpeed = 0.02,
    idleCrawlSpeed = 0.035,
    matchLossGraceMs = 900,
    matchLossPauseMs = 2400,
  } = config

  if (!canAutoAdjust) {
    return {
      nextScrollTop: scrollTop,
      nextSpeed: currentSpeed + (0 - currentSpeed) * pursuitDamping,
      desiredSpeed: 0,
      controllerMode: 'manual-hold',
      correctionReason: 'manual_hold',
      correctionAmount: 0,
      eyelineDelta: 0,
      rawEyelineDelta: 0,
      recoveryActive: false,
      recoverySettled: false,
    }
  }

  const eyelineContentTop = scrollTop + eyelineOffset
  const hasVirtualTarget = Number.isFinite(virtualTargetLineCenter)
  const hasRecoveryTarget = Number.isFinite(recoveryScrollTop)
  const hasRecentGoodMatch = Number.isFinite(timeSinceGoodMatchMs)
  const matchLossActive =
    !hasVirtualTarget &&
    hasRecentGoodMatch &&
    timeSinceGoodMatchMs > matchLossGraceMs
  const matchLossProgress = matchLossActive
    ? clamp(
      (timeSinceGoodMatchMs - matchLossGraceMs) / Math.max(1, matchLossPauseMs - matchLossGraceMs),
      0,
      1,
    )
    : 0
  const allowRecoveryTarget = hasRecoveryTarget && !matchLossActive
  const recoveryLineCenter = hasRecoveryTarget ? recoveryScrollTop + eyelineOffset : null
  const effectiveTarget = hasVirtualTarget
    ? virtualTargetLineCenter
    : allowRecoveryTarget
      ? recoveryLineCenter
      : null

  if (!Number.isFinite(effectiveTarget)) {
    const desiredSpeed = matchLossActive
      ? baseSpeed * (1 - matchLossProgress)
      : clamp(baseSpeed, rewindMinSpeed, maxSpeed)
    const nextSpeed = currentSpeed + (desiredSpeed - currentSpeed) * pursuitDamping
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight)
    const nextScrollTop = clamp(scrollTop + nextSpeed, 0, maxScrollTop)
    return {
      nextScrollTop,
      nextSpeed,
      desiredSpeed,
      controllerMode: matchLossProgress >= 1 ? 'match_lost_hold' : matchLossActive ? 'match_lost_glide' : 'cruising',
      correctionReason: matchLossProgress >= 1 ? 'match_lost_hold' : matchLossActive ? 'match_lost_decay' : 'baseline',
      correctionAmount: desiredSpeed - baseSpeed,
      eyelineDelta: 0,
      rawEyelineDelta: 0,
      recoveryActive: false,
      recoverySettled: false,
      matchLossActive,
      matchLossProgress,
    }
  }

  const rawEyelineDelta = effectiveTarget - eyelineContentTop
  const liveEyelineDelta = Number.isFinite(liveTargetLineCenter)
    ? liveTargetLineCenter - eyelineContentTop
    : rawEyelineDelta
  const thresholdPx = clientHeight * recoverySnapThreshold
  const recoveryActive = allowRecoveryTarget && Math.abs(rawEyelineDelta) > Math.max(thresholdPx * 0.18, 18)
  const useRecoveryTuning = recoveryActive && Math.abs(rawEyelineDelta) > thresholdPx

  let desiredSpeed = baseSpeed + rawEyelineDelta * pursuitStiffness
  let controllerMode = 'pursuit'
  let correctionReason = 'pursuit'

  if (targetDirection === 'rewind') {
    desiredSpeed = -Math.max(
      nearPauseSpeed,
      Math.min(Math.abs(rewindMinSpeed), Math.abs(rawEyelineDelta) * rewindStiffness),
    )
    controllerMode = 'rewind_glide'
    correctionReason = 'rewind_glide'
  } else if (useRecoveryTuning) {
    desiredSpeed = baseSpeed + rawEyelineDelta * (pursuitStiffness * 1.85)
    controllerMode = 'recovery_snap'
    correctionReason = 'recovery_snap'
  } else if (Math.abs(rawEyelineDelta) < 8) {
    desiredSpeed = Math.max(idleCrawlSpeed, baseSpeed + rawEyelineDelta * (pursuitStiffness * 0.25))
    controllerMode = 'pursuit_hold'
    correctionReason = 'pursuit_hold'
  }

  if (targetDirection === 'rewind' && targetConfidence >= 0.82) {
    desiredSpeed -= Math.min(0.75, Math.abs(rawEyelineDelta) * 0.008)
  }

  desiredSpeed = clamp(desiredSpeed, rewindMinSpeed, maxSpeed)
  let damping = useRecoveryTuning ? Math.min(0.34, pursuitDamping * 1.5) : pursuitDamping
  if (controllerMode === 'rewind_glide') {
    damping = Math.max(damping, 0.42)
  }
  const nextSpeed = currentSpeed + (desiredSpeed - currentSpeed) * damping
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight)
  const nextScrollTop = clamp(scrollTop + nextSpeed, 0, maxScrollTop)
  const recoverySettled =
    allowRecoveryTarget &&
    Math.abs((recoveryScrollTop ?? 0) - nextScrollTop) <= Math.max(10, clientHeight * 0.035)

  return {
    nextScrollTop,
    nextSpeed,
    desiredSpeed,
    controllerMode,
    correctionReason,
    correctionAmount: desiredSpeed - baseSpeed,
    eyelineDelta: rawEyelineDelta,
    rawEyelineDelta: liveEyelineDelta,
    recoveryActive,
    recoverySettled,
    matchLossActive,
    matchLossProgress,
  }
}
