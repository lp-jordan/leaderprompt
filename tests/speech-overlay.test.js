import test from 'node:test'
import assert from 'node:assert'
import { JSDOM } from 'jsdom'
import {
  convertRectToOverlay,
  findTokenMatchRanges,
  findTokenTextMatches,
  measureTokenLineOverlay,
} from '../src/utils/speechOverlay.js'

function makeRect({ top, left = 120, width = 160, height = 28 }) {
  return {
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
  }
}

function withRangeRects(document, resolver, run) {
  const originalCreateRange = document.createRange.bind(document)
  document.createRange = () => {
    let startNode = null
    let startOffset = 0
    let endOffset = 0
    return {
      setStart(node, offset) {
        startNode = node
        startOffset = offset
      },
      setEnd(_node, offset) {
        endOffset = offset
      },
      getClientRects() {
        return resolver({ startNode, startOffset, endOffset })
      },
    }
  }

  try {
    run()
  } finally {
    document.createRange = originalCreateRange
  }
}

test('findTokenMatchRanges normalizes smart punctuation', () => {
  const matches = findTokenMatchRanges("It\u2019s time. It's still time.", "it's")
  assert.strictEqual(matches.length, 2)
})

test('findTokenTextMatches finds repeated words inside a single anchor', () => {
  const dom = new JSDOM('<p id="anchor">alpha beta alpha gamma</p>')
  const anchor = dom.window.document.getElementById('anchor')

  const matches = findTokenTextMatches(anchor, 'alpha')
  assert.strictEqual(matches.length, 2)
  assert.deepStrictEqual(
    matches.map((match) => [match.start, match.end]),
    [[0, 5], [11, 16]],
  )
})

test('findTokenTextMatches stay scoped to the provided anchor node', () => {
  const dom = new JSDOM('<div><p id="a">workflow first</p><p id="b">workflow second</p></div>')
  const firstAnchor = dom.window.document.getElementById('a')
  const secondAnchor = dom.window.document.getElementById('b')

  assert.strictEqual(findTokenTextMatches(firstAnchor, 'workflow').length, 1)
  assert.strictEqual(findTokenTextMatches(secondAnchor, 'workflow').length, 1)
})

test('convertRectToOverlay converts viewport rects into scroll-relative overlay coordinates', () => {
  const overlay = convertRectToOverlay({
    rect: makeRect({ top: 240, height: 30 }),
    containerRect: { top: 100 },
    containerScrollTop: 320,
    containerWidth: 900,
  })

  assert.deepStrictEqual(overlay, {
    lineTop: 460,
    lineHeight: 30,
    lineLeft: 0,
    lineWidth: 900,
  })
})

test('measureTokenLineOverlay chooses the visible token rect nearest the eyeline', () => {
  const dom = new JSDOM('<div id="container"><p id="anchor">alpha beta alpha gamma</p></div>')
  const document = dom.window.document
  const container = document.getElementById('container')
  const anchor = document.getElementById('anchor')
  const textNode = anchor.firstChild

  Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true })
  Object.defineProperty(container, 'clientWidth', { value: 920, configurable: true })
  Object.defineProperty(container, 'scrollTop', { value: 240, configurable: true })
  container.getBoundingClientRect = () => ({ top: 100, left: 0, width: 920, height: 400, right: 920, bottom: 500 })

  withRangeRects(document, ({ startNode, startOffset }) => {
    if (startNode !== textNode) return []
    if (startOffset === 0) return [makeRect({ top: 164, height: 24 })]
    if (startOffset === 11) return [makeRect({ top: 246, height: 24 })]
    return []
  }, () => {
    const result = measureTokenLineOverlay({
      anchorElement: anchor,
      token: 'alpha',
      containerElement: container,
    })

    assert.strictEqual(result.ok, true)
    assert.deepStrictEqual(result.overlay, {
      lineTop: 386,
      lineHeight: 24,
      lineLeft: 0,
      lineWidth: 920,
    })
  })
})

test('measureTokenLineOverlay reports missing token geometry cleanly', () => {
  const dom = new JSDOM('<div id="container"><p id="anchor">alpha beta gamma</p></div>')
  const document = dom.window.document
  const container = document.getElementById('container')
  const anchor = document.getElementById('anchor')

  Object.defineProperty(container, 'clientHeight', { value: 300, configurable: true })
  Object.defineProperty(container, 'clientWidth', { value: 640, configurable: true })
  Object.defineProperty(container, 'scrollTop', { value: 0, configurable: true })
  container.getBoundingClientRect = () => ({ top: 50, left: 0, width: 640, height: 300, right: 640, bottom: 350 })

  withRangeRects(document, () => [], () => {
    const result = measureTokenLineOverlay({
      anchorElement: anchor,
      token: 'alpha',
      containerElement: container,
    })

    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.reason, 'token_rect_missing')
  })
})
