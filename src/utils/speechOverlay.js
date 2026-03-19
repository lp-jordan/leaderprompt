export function normalizeSpeechToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9']+/g, '')
    .trim()
}

export function findTokenMatchRanges(text, token) {
  const normalizedTarget = normalizeSpeechToken(token)
  if (!normalizedTarget) return []

  const matches = []
  const normalizedText = String(text || '').replace(/[\u2018\u2019]/g, "'")
  const wordPattern = /[\p{L}\p{N}']+/gu
  let match
  while ((match = wordPattern.exec(normalizedText)) !== null) {
    if (normalizeSpeechToken(match[0]) !== normalizedTarget) continue
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
    })
  }

  return matches
}

function collectTextNodes(root) {
  if (!root) return []

  const nodes = []
  const visit = (node) => {
    if (!node) return
    if (node.nodeType === 3) {
      if (node.textContent?.trim()) nodes.push(node)
      return
    }
    if (!node.childNodes?.length) return
    Array.from(node.childNodes).forEach(visit)
  }

  visit(root)
  return nodes
}

export function findTokenTextMatches(root, token) {
  const normalizedTarget = normalizeSpeechToken(token)
  if (!root || !normalizedTarget) return []

  return collectTextNodes(root).flatMap((node) =>
    findTokenMatchRanges(node.textContent || '', token).map((range, occurrenceIndex) => ({
      node,
      occurrenceIndex,
      ...range,
    })),
  )
}

export function pickBestClientRect(rects, containerRect, containerHeight, eyelineRatio = 0.38) {
  if (!rects?.length || !containerRect) return null

  const eyeline = (containerRect.top || 0) + containerHeight * eyelineRatio
  const ranked = rects
    .filter((rect) => rect && rect.width > 0 && rect.height > 0)
    .map((rect) => {
      const visibleTop = Math.max(rect.top, containerRect.top)
      const visibleBottom = Math.min(rect.bottom, containerRect.top + containerHeight)
      const visibleHeight = Math.max(0, visibleBottom - visibleTop)
      const centerY = rect.top + rect.height / 2
      return {
        rect,
        visibleHeight,
        distanceToEyeline: Math.abs(centerY - eyeline),
      }
    })
    .filter((entry) => entry.visibleHeight > 0)
    .sort((left, right) =>
      right.visibleHeight - left.visibleHeight ||
      left.distanceToEyeline - right.distanceToEyeline ||
      left.rect.top - right.rect.top,
    )

  return ranked[0]?.rect || null
}

export function convertRectToOverlay({
  rect,
  containerRect,
  containerScrollTop = 0,
  containerWidth = 0,
}) {
  if (!rect || !containerRect) return null

  return {
    lineTop: rect.top - containerRect.top + containerScrollTop,
    lineHeight: rect.height,
    lineLeft: 0,
    lineWidth: containerWidth,
  }
}

export function measureTokenLineOverlay({
  anchorElement,
  token,
  containerElement,
  eyelineRatio = 0.38,
}) {
  if (!anchorElement || !containerElement) {
    return { ok: false, reason: 'missing_elements' }
  }

  if (typeof anchorElement.nodeType !== 'number' || typeof containerElement.getBoundingClientRect !== 'function') {
    return { ok: false, reason: 'non_dom_anchor' }
  }

  const matches = findTokenTextMatches(anchorElement, token)
  if (!matches.length) {
    return { ok: false, reason: 'token_not_found' }
  }

  const doc = anchorElement.ownerDocument
  if (!doc?.createRange) {
    return { ok: false, reason: 'range_unavailable' }
  }

  const containerRect = containerElement.getBoundingClientRect()
  const measuredRects = []

  matches.forEach((match) => {
    const range = doc.createRange()
    range.setStart(match.node, match.start)
    range.setEnd(match.node, match.end)

    const rects = typeof range.getClientRects === 'function'
      ? Array.from(range.getClientRects())
      : []
    rects.forEach((rect) => {
      measuredRects.push(rect)
    })
  })

  const bestRect = pickBestClientRect(
    measuredRects,
    containerRect,
    containerElement.clientHeight,
    eyelineRatio,
  )
  if (!bestRect) {
    return { ok: false, reason: 'token_rect_missing' }
  }

  const overlay = convertRectToOverlay({
    rect: bestRect,
    containerRect,
    containerScrollTop: containerElement.scrollTop || 0,
    containerWidth: containerElement.clientWidth || containerRect.width || 0,
  })
  if (!overlay) {
    return { ok: false, reason: 'overlay_conversion_failed' }
  }

  return {
    ok: true,
    reason: 'token_rect',
    overlay,
  }
}



