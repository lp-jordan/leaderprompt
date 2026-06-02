import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import './TipTapEditor.css'
import './utils/disableLinks.css'
import { handleContextMenu as handleContextMenuUtil } from './utils/contextMenu.js'

// ── Font-size ladder (null = inherited / no override) ─────────────────────────
const FONT_SIZES = [null, '1.15em', '1.4em', '1.75em', '2.2em']

function getSizeIdx(editor) {
  const current = editor.getAttributes('textStyle').fontSize ?? null
  const idx = FONT_SIZES.indexOf(current)
  return idx === -1 ? 0 : idx
}

// ── TextStyle extended with fontSize attribute ────────────────────────────────
const SizedTextStyle = TextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fontSize: {
        default: null,
        parseHTML: (el) => el.style.fontSize || null,
        renderHTML: (attrs) => attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
      },
    }
  },
})

// ── Icons ─────────────────────────────────────────────────────────────────────
const IC = { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }

function IcSpell() {
  return (
    <svg {...IC}>
      <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </svg>
  )
}

function IcCut() {
  return (
    <svg {...IC}>
      <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
      <line x1="20" y1="4" x2="8.12" y2="15.88"/>
      <line x1="14.47" y1="14.48" x2="20" y2="20"/>
      <line x1="8.12" y1="8.12" x2="12" y2="12"/>
    </svg>
  )
}

function IcCopy() {
  return (
    <svg {...IC}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
    </svg>
  )
}

function IcPaste() {
  return (
    <svg {...IC}>
      <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/>
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
    </svg>
  )
}

function IcBold() {
  return (
    <svg {...IC}>
      <path d="M6 4h8a4 4 0 010 8H6z"/>
      <path d="M6 12h9a4 4 0 010 8H6z"/>
    </svg>
  )
}

function IcItalic() {
  return (
    <svg {...IC}>
      <line x1="19" y1="4" x2="10" y2="4"/>
      <line x1="14" y1="20" x2="5" y2="20"/>
      <line x1="15" y1="4" x2="9" y2="20"/>
    </svg>
  )
}

function IcColor() {
  return (
    <svg {...IC}>
      <path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"/>
    </svg>
  )
}

function IcSizeUp() {
  return (
    <svg {...IC}>
      <polyline points="4 7 4 4 20 4 20 7"/>
      <line x1="9" y1="20" x2="15" y2="20"/>
      <line x1="12" y1="4" x2="12" y2="20"/>
      <polyline points="17 14 20 11 23 14"/>
    </svg>
  )
}

function IcSizeDown() {
  return (
    <svg {...IC}>
      <polyline points="4 7 4 4 20 4 20 7"/>
      <line x1="9" y1="20" x2="15" y2="20"/>
      <line x1="12" y1="4" x2="12" y2="20"/>
      <polyline points="17 16 20 19 23 16"/>
    </svg>
  )
}

function IcSizeReset() {
  return (
    <svg {...IC}>
      <polyline points="1 4 1 10 7 10"/>
      <path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
    </svg>
  )
}

function IcSelectAll() {
  return (
    <svg {...IC}>
      <path d="M8 3H5a2 2 0 00-2 2v3"/>
      <path d="M21 8V5a2 2 0 00-2-2h-3"/>
      <path d="M3 16v3a2 2 0 002 2h3"/>
      <path d="M16 21h3a2 2 0 002-2v-3"/>
    </svg>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

function TipTapEditor({ initialHtml = '', onUpdate, onReady, style = {} }) {
  const containerRef       = useRef(null)
  const menuRef            = useRef(null)
  const lastAppliedHtmlRef = useRef(initialHtml)
  const colorInputRef      = useRef(null)
  const selectionRef       = useRef(null)

  const editor = useEditor(
    {
      extensions: [StarterKit, SizedTextStyle, Color],
      content: initialHtml,
      onUpdate: ({ editor }) => onUpdate?.(editor.getHTML()),
      editorProps: {
        transformPastedHTML(html) {
          const div = document.createElement('div')
          div.innerHTML = html
          div.querySelectorAll('[style]').forEach((el) => {
            el.style.removeProperty('color')
            el.style.removeProperty('background-color')
            el.style.removeProperty('background')
            if (!el.getAttribute('style')) el.removeAttribute('style')
          })
          return div.innerHTML
        },
      },
    },
    [],
  )

  useEffect(() => { if (editor) onReady?.(editor) }, [editor, onReady])

  useEffect(() => {
    if (!editor || lastAppliedHtmlRef.current === initialHtml) return
    if (editor.getHTML() === initialHtml) { lastAppliedHtmlRef.current = initialHtml; return }
    editor.commands.setContent(initialHtml, false)
    lastAppliedHtmlRef.current = initialHtml
  }, [editor, initialHtml])

  const [menuPos,         setMenuPos]         = useState(null)
  const [isColorPickerOpen, setColorPickerOpen] = useState(false)
  const [spellSuggestions,  setSpellSuggestions] = useState([])

  const closeMenu = () => { setMenuPos(null); setSpellSuggestions([]) }
  const openMenu  = (pos) => { setMenuPos(pos); setSpellSuggestions([]) }

  const handleContextMenu = (e) =>
    handleContextMenuUtil(e, { editor, containerRef, openMenu, setSpellSuggestions })

  // Close on outside click
  useEffect(() => {
    const hide = (e) => {
      if (isColorPickerOpen) return
      if (!e.target.closest('.lp-cm')) closeMenu()
    }
    window.addEventListener('mousedown', hide)
    return () => window.removeEventListener('mousedown', hide)
  }, [isColorPickerOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clamp menu within container bounds after render
  useLayoutEffect(() => {
    if (!menuPos || !menuRef.current || !containerRef.current) return
    const el     = menuRef.current
    const cRect  = containerRef.current.getBoundingClientRect()
    const eRect  = el.getBoundingClientRect()
    if (eRect.right  > cRect.right  - 4) el.style.left = `${menuPos.x - eRect.width}px`
    if (eRect.bottom > cRect.bottom - 4) el.style.top  = `${menuPos.y - eRect.height}px`
  }, [menuPos])

  // ── Actions ──────────────────────────────────────────────────────────────────

  const selEmpty = editor?.state.selection.empty ?? true

  // Wrap an action: run it then close the menu
  const act = (fn) => () => { fn(); closeMenu() }

  const handleCut   = act(() => document.execCommand('cut'))
  const handleCopy  = act(() => document.execCommand('copy'))

  // Paste: close menu first, then focus editor and paste in next frame
  const handlePaste = () => {
    closeMenu()
    requestAnimationFrame(() => {
      editor?.commands.focus()
      requestAnimationFrame(() => document.execCommand('paste'))
    })
  }

  const handleBold   = act(() => editor?.chain().focus().toggleBold().run())
  const handleItalic = act(() => editor?.chain().focus().toggleItalic().run())

  const handleMakeLarger = act(() => {
    if (!editor) return
    const next = FONT_SIZES[Math.min(getSizeIdx(editor) + 1, FONT_SIZES.length - 1)]
    editor.chain().focus().setMark('textStyle', { fontSize: next }).run()
  })

  const handleMakeSmaller = act(() => {
    if (!editor) return
    const prev = FONT_SIZES[Math.max(getSizeIdx(editor) - 1, 0)]
    editor.chain().focus().setMark('textStyle', { fontSize: prev }).run()
  })

  const handleResetSize = act(() => {
    editor?.chain().focus().setMark('textStyle', { fontSize: null }).run()
  })

  const handleSelectAll = act(() => editor?.commands.selectAll())

  const replaceSelection = (text) => {
    editor?.chain().focus().insertContent(text).run()
    closeMenu()
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className="tiptap-editor"
      onContextMenu={handleContextMenu}
      style={style}
    >
      <EditorContent editor={editor} className="disable-links" />

      {menuPos && editor && (
        <div
          ref={menuRef}
          className="lp-cm fade-in"
          style={{ top: menuPos.y, left: menuPos.x }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Spell suggestions */}
          {spellSuggestions.length > 0 && (
            <>
              {spellSuggestions.map((sug) => (
                <button key={sug} className="lp-cm-item" onClick={() => replaceSelection(sug)}>
                  <span className="lp-cm-icon"><IcSpell /></span>
                  <span>{sug}</span>
                </button>
              ))}
              <div className="lp-cm-sep" />
            </>
          )}

          {/* Clipboard */}
          <button className="lp-cm-item" onClick={handleCut} disabled={selEmpty}>
            <span className="lp-cm-icon"><IcCut /></span><span>Cut</span>
          </button>
          <button className="lp-cm-item" onClick={handleCopy} disabled={selEmpty}>
            <span className="lp-cm-icon"><IcCopy /></span><span>Copy</span>
          </button>
          <button className="lp-cm-item" onClick={handlePaste}>
            <span className="lp-cm-icon"><IcPaste /></span><span>Paste</span>
          </button>

          <div className="lp-cm-sep" />

          {/* Formatting */}
          <button
            className={`lp-cm-item${editor.isActive('bold') ? ' lp-cm-item--on' : ''}`}
            onClick={handleBold}
          >
            <span className="lp-cm-icon"><IcBold /></span><span>Bold</span>
          </button>
          <button
            className={`lp-cm-item${editor.isActive('italic') ? ' lp-cm-item--on' : ''}`}
            onClick={handleItalic}
          >
            <span className="lp-cm-icon"><IcItalic /></span><span>Italic</span>
          </button>
          <button
            className="lp-cm-item"
            onClick={() => {
              const sel = editor.state.selection
              selectionRef.current = { from: sel.from, to: sel.to }
              const el = colorInputRef.current
              if (!el) return
              if (typeof el.showPicker === 'function') el.showPicker()
              else el.click()
              setColorPickerOpen(true)
            }}
          >
            <span className="lp-cm-icon"><IcColor /></span><span>Text color</span>
          </button>
          {/* Hidden native color picker — triggered programmatically above */}
          <input
            ref={colorInputRef}
            type="color"
            className="lp-cm-color-input"
            onChange={(e) => {
              const { from, to } = selectionRef.current || editor.state.selection
              editor.chain().focus().setTextSelection({ from, to }).setColor(e.target.value).run()
            }}
            onBlur={() => setColorPickerOpen(false)}
          />

          <div className="lp-cm-sep" />

          {/* Font size */}
          <button
            className="lp-cm-item"
            onClick={handleMakeLarger}
            disabled={getSizeIdx(editor) >= FONT_SIZES.length - 1}
          >
            <span className="lp-cm-icon"><IcSizeUp /></span><span>Make larger</span>
          </button>
          <button
            className="lp-cm-item"
            onClick={handleMakeSmaller}
            disabled={getSizeIdx(editor) <= 0}
          >
            <span className="lp-cm-icon"><IcSizeDown /></span><span>Make smaller</span>
          </button>
          <button
            className="lp-cm-item"
            onClick={handleResetSize}
            disabled={getSizeIdx(editor) === 0}
          >
            <span className="lp-cm-icon"><IcSizeReset /></span><span>Reset size</span>
          </button>

          <div className="lp-cm-sep" />

          {/* Select all */}
          <button className="lp-cm-item" onClick={handleSelectAll}>
            <span className="lp-cm-icon"><IcSelectAll /></span><span>Select all</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default TipTapEditor
