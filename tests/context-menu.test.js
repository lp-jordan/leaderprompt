import test from 'node:test'
import assert from 'node:assert'
import { JSDOM } from 'jsdom'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { handleContextMenu } from '../src/utils/contextMenu.js'

function setupEditor(content, pos) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  global.window = dom.window
  global.document = dom.window.document
  const editor = new Editor({ extensions: [StarterKit], content })
  editor.commands.setTextSelection(pos)
  return editor
}

test('right-click with empty selection selects word', async () => {
  const editor = setupEditor('hello wurld', 10)
  const containerRef = {
    current: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
  }
  let menuPos
  const openMenu = (pos) => {
    menuPos = pos
  }
  let calledWord
  window.electronAPI = {
    spellCheck: (word) => {
      calledWord = word
      return Promise.resolve([])
    },
  }
  const e = { preventDefault() {}, clientX: 0, clientY: 0 }
  handleContextMenu(e, {
    editor,
    containerRef,
    openMenu,
    setSpellSuggestions: () => {},
  })
  await new Promise((r) => setImmediate(r))
  const sel = editor.state.selection
  assert.strictEqual(sel.from, 7)
  assert.strictEqual(sel.to, 12)
  assert.ok(menuPos)
  assert.strictEqual(calledWord, 'wurld')
})

test('word passed to spellCheck strips trailing punctuation', async () => {
  const editor = setupEditor('hello wurld,', 10)
  const containerRef = {
    current: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
  }
  window.electronAPI = {
    spellCheck: (word) => {
      window.calledWord = word
      return Promise.resolve([])
    },
  }
  const e = { preventDefault() {}, clientX: 0, clientY: 0 }
  handleContextMenu(e, {
    editor,
    containerRef,
    openMenu: () => {},
    setSpellSuggestions: () => {},
  })
  await new Promise((r) => setImmediate(r))
  const selText = editor.state.doc.textBetween(
    editor.state.selection.from,
    editor.state.selection.to,
    ' ',
  )
  assert.strictEqual(selText, 'wurld,')
  assert.strictEqual(window.calledWord, 'wurld')
})
