function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^a-z0-9'\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeText(text) {
  const normalized = normalizeText(text);
  return normalized ? normalized.split(' ') : [];
}

function calculateOrderedOverlap(candidateTokens, transcriptTokens) {
  if (!candidateTokens.length || !transcriptTokens.length) return 0;

  let cursor = 0;
  let matched = 0;

  for (const token of transcriptTokens) {
    const index = candidateTokens.indexOf(token, cursor);
    if (index === -1) continue;
    matched += 1;
    cursor = index + 1;
  }

  return matched / transcriptTokens.length;
}

function calculateTokenCoverage(candidateTokens, transcriptTokens) {
  if (!candidateTokens.length || !transcriptTokens.length) return 0;

  const candidateCounts = new Map();
  for (const token of candidateTokens) {
    candidateCounts.set(token, (candidateCounts.get(token) || 0) + 1);
  }

  let matched = 0;
  for (const token of transcriptTokens) {
    const remaining = candidateCounts.get(token) || 0;
    if (!remaining) continue;
    matched += 1;
    candidateCounts.set(token, remaining - 1);
  }

  return matched / transcriptTokens.length;
}

function buildAnchorCandidate(anchors, index) {
  const current = anchors[index];
  const next = anchors[index + 1];
  if (!current) return null;

  const texts = [current.normalizedText];
  const tokens = [...current.tokens];

  if (next && current.tokens.length <= 2 && next.tokens.length <= 18) {
    texts.push(next.normalizedText);
    tokens.push(...next.tokens);
  }

  return {
    anchor: current,
    index,
    combinedText: texts.filter(Boolean).join(' '),
    combinedTokens: tokens,
  };
}

function scoreCandidate({
  candidate,
  transcriptTokens,
  transcriptNormalized,
  currentAnchorIndex,
  allowRewind,
  rewindPenalty = 0.18,
}) {
  if (!candidate || !transcriptTokens.length) {
    return { confidence: 0, direction: 'unknown' };
  }

  const tokenCoverage = calculateTokenCoverage(
    candidate.combinedTokens,
    transcriptTokens,
  );
  const orderedOverlap = calculateOrderedOverlap(
    candidate.combinedTokens,
    transcriptTokens,
  );
  const substringBoost =
    transcriptNormalized && candidate.combinedText.includes(transcriptNormalized)
      ? 0.2
      : 0;
  const distance = Math.abs(candidate.index - currentAnchorIndex);
  const proximityPenalty = Math.min(distance * 0.035, 0.22);
  const rewindPenaltyValue =
    allowRewind && candidate.index < currentAnchorIndex ? rewindPenalty : 0;

  const confidence = Math.max(
    0,
    tokenCoverage * 0.55 +
      orderedOverlap * 0.3 +
      substringBoost -
      proximityPenalty -
      rewindPenaltyValue,
  );

  let direction = 'hold';
  if (candidate.index > currentAnchorIndex) direction = 'forward';
  if (candidate.index < currentAnchorIndex) direction = 'rewind';

  return { confidence, direction, tokenCoverage, orderedOverlap };
}


function clampRange(start, end, max) {
  return {
    start: Math.max(0, start),
    end: Math.min(max, end),
  };
}

function getSearchRanges(currentAnchorIndex, anchorCount, config = {}) {
  const {
    forwardWindow = 6,
    backwardWindow = 3,
    recoveryForwardWindow = 18,
  } = config;

  const local = clampRange(
    currentAnchorIndex - backwardWindow,
    currentAnchorIndex + forwardWindow + 1,
    anchorCount,
  );

  const recovery = clampRange(
    currentAnchorIndex - backwardWindow,
    currentAnchorIndex + recoveryForwardWindow + 1,
    anchorCount,
  );

  return [local, recovery, { start: 0, end: anchorCount }];
}

export function buildAlignmentAnchorsFromNodes(nodes) {
  return nodes
    .map((node, index) => {
      const text = node?.textContent?.trim() || '';
      const normalizedText = normalizeText(text);
      const tokens = tokenizeText(text);
      if (!tokens.length) return null;

      return {
        index,
        text,
        normalizedText,
        tokens,
        element: node,
      };
    })
    .filter(Boolean);
}

export function findNearestAnchorIndex(anchors, scrollTop, viewportHeight = 0, targetRatio = 0.32) {
  if (!anchors.length) return 0;

  const target = scrollTop + viewportHeight * targetRatio;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  anchors.forEach((anchor, index) => {
    const elementTop = anchor.element?.offsetTop || 0;
    const distance = Math.abs(elementTop - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

export function matchTranscriptToAnchors({
  anchors,
  transcript,
  currentAnchorIndex = 0,
  config = {},
}) {
  if (!anchors?.length) {
    return { matchedAnchor: null, confidence: 0, direction: 'unknown' };
  }

  const transcriptTokens = tokenizeText(transcript);
  const transcriptNormalized = normalizeText(transcript);
  if (!transcriptTokens.length) {
    return {
      matchedAnchor: anchors[currentAnchorIndex] || anchors[0],
      confidence: 0,
      direction: 'unknown',
    };
  }

  const ranges = getSearchRanges(currentAnchorIndex, anchors.length, config);
  let bestMatch = {
    matchedAnchor: anchors[currentAnchorIndex] || anchors[0],
    confidence: 0,
    direction: 'unknown',
    candidateIndex: currentAnchorIndex,
    tokenCoverage: 0,
    orderedOverlap: 0,
    anchorTextSnippet: anchors[currentAnchorIndex]?.text || anchors[0]?.text || '',
    selectedHighlightToken: '',
  };

  for (const range of ranges) {
    for (let index = range.start; index < range.end; index += 1) {
      const candidate = buildAnchorCandidate(anchors, index);
      const scored = scoreCandidate({
        candidate,
        transcriptTokens,
        transcriptNormalized,
        currentAnchorIndex,
        allowRewind: true,
      });

      if (scored.confidence <= bestMatch.confidence) continue;
      bestMatch = {
        matchedAnchor: candidate.anchor,
        confidence: scored.confidence,
        direction: scored.direction,
        candidateIndex: candidate.index,
        tokenCoverage: scored.tokenCoverage,
        orderedOverlap: scored.orderedOverlap,
        anchorTextSnippet: candidate.anchor?.text || '',
        selectedHighlightToken: selectHighlightToken({
          transcript,
          anchor: candidate.anchor,
        }),
      };
    }

    if (bestMatch.confidence >= 0.7) break;
  }

  return bestMatch;
}

export function shouldCommitAlignment({
  match,
  currentAnchorIndex,
  stableMatchCount = 1,
  config = {},
}) {
  if (!match?.matchedAnchor) return false;

  const nextIndex = match.matchedAnchor.index;
  const isRewind = nextIndex < currentAnchorIndex;
  const minConfidence = isRewind
    ? config.rewindCommitConfidence ?? 0.68
    : config.forwardCommitConfidence ?? 0.52;
  const minStableCount = isRewind
    ? config.rewindStableCount ?? 2
    : config.forwardStableCount ?? 1;

  return match.confidence >= minConfidence && stableMatchCount >= minStableCount;
}

export function buildRollingTranscript(segments, maxLength = 140) {
  const cleanedSegments = segments
    .map((segment) => String(segment || '').trim())
    .filter(Boolean);

  if (!cleanedSegments.length) return '';

  const merged = [];

  for (const segment of cleanedSegments) {
    if (!merged.length) {
      merged.push(segment);
      continue;
    }

    const previousWords = merged.join(' ').trim().split(/\s+/).filter(Boolean);
    const nextWords = segment.split(/\s+/).filter(Boolean);
    const maxOverlap = Math.min(previousWords.length, nextWords.length);
    let overlap = 0;

    for (let size = maxOverlap; size >= 1; size -= 1) {
      const previousTail = previousWords
        .slice(previousWords.length - size)
        .map(normalizeText)
        .join(' ');
      const nextHead = nextWords
        .slice(0, size)
        .map(normalizeText)
        .join(' ');

      if (!previousTail || previousTail !== nextHead) continue;
      overlap = size;
      break;
    }

    if (overlap >= nextWords.length) continue;
    merged.push(nextWords.slice(overlap).join(' '));
  }

  const text = merged.join(' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;

  const sliceStart = text.length - maxLength;
  const nextBoundary = text.indexOf(' ', sliceStart);
  return text.slice(nextBoundary === -1 ? sliceStart : nextBoundary + 1);
}

export function selectHighlightToken({ transcript = '', anchor = null } = {}) {
  const transcriptTokens = tokenizeText(transcript);
  const anchorTokens = anchor?.tokens?.length ? anchor.tokens : tokenizeText(anchor?.text || '');
  if (!transcriptTokens.length || !anchorTokens.length) return '';

  const anchorTokenSet = new Set(anchorTokens);
  for (let index = transcriptTokens.length - 1; index >= 0; index -= 1) {
    const token = transcriptTokens[index];
    if (anchorTokenSet.has(token)) return token;
  }

  return '';
}

export { normalizeText, tokenizeText };




