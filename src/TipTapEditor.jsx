import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import './TipTapEditor.css'

const DEBUG_COLOR_PICKER = true
const colorDebug = (...args) => {
  if (DEBUG_COLOR_PICKER) console.log('[color]', ...args)
}

const AI_SUGGESTIONS = [
  'Lorem ipsum dolor sit amet',
  'Consectetur adipiscing elit',
  'Sed do eiusmod tempor incididunt',
]

function TipTapEditor({ initialHtml = '', onUpdate }) {
  const containerRef = useRef(null)
  const editor = useEditor({
    extensions: [StarterKit, TextStyle, Color],
    content: initialHtml,
    onUpdate: ({ editor }) => {
      onUpdate?.(editor.getHTML())
    },
  })

  const [menuPos, setMenuPos] = useState(null)
  const [activeMenu, setActiveMenu] = useState('root')
  const colorInputRef = useRef(null)
  const selectionRef = useRef(null)

  const openMenu = (pos) => {
    setMenuPos(pos)
    setActiveMenu('root')
  }

  const apply = (action, close = true) => {
    action?.()
    if (close) {
      setMenuPos(null)
      setActiveMenu('root')
    }
  }

  const handleContextMenu = (e) => {
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) {
      openMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
  }

  useEffect(() => {
    if (!editor) return
    const selectionHandler = () => {
      const sel = editor.state.selection
      if (!sel.empty) {
        const start = editor.view.coordsAtPos(sel.from)
        const rect = containerRef.current?.getBoundingClientRect()
        if (rect) {
          openMenu({
            x: start.left - rect.left,
            y: start.top - rect.top - 40,
          })
        }
      }
    }
    editor.on('selectionUpdate', selectionHandler)
    return () => editor.off('selectionUpdate', selectionHandler)
  }, [editor])

  useEffect(() => {
    const hide = (e) => {
      if (!e.target.closest('.context-menu-root')) {
        colorDebug('hide: click outside menu', e.target)
        setMenuPos(null)
        setActiveMenu('root')
      } else {
        colorDebug('hide: click inside menu, ignoring')
      }
    }
    window.addEventListener('mousedown', hide)
    return () => window.removeEventListener('mousedown', hide)
  }, [])

  useEffect(() => {
    if (editor && initialHtml !== editor.getHTML()) {
      editor.commands.setContent(initialHtml)
    }
  }, [initialHtml, editor])

  const replaceSelection = (text) => {
    editor
      ?.chain()
      .focus()
      .insertContent(text)
      .run()
    setMenuPos(null)
  }

  return (
    <div ref={containerRef} className="tiptap-editor" onContextMenu={handleContextMenu}>
      <EditorContent editor={editor} />
      {menuPos && editor && (
        <div
          className="context-menu-root"
          style={{ top: menuPos.y, left: menuPos.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {activeMenu === 'root' && (
            <div className="context-menu fade-in">
              <button onClick={() => setActiveMenu('format')}>A</button>
              <button onClick={() => setActiveMenu('ai')}>✨</button>
            </div>
          )}
          {activeMenu === 'format' && (
            <div className="context-menu format fade-in">
              <button
                onClick={() =>
                  apply(() => editor.chain().focus().toggleBold().run())
                }
              >
                B
              </button>
              <button
                onClick={() =>
                  apply(() => editor.chain().focus().toggleItalic().run())
                }
              >
                I
              </button>
              <div className="color-wrapper">
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    colorDebug('color button clicked')
                    const sel = editor.state.selection
                    selectionRef.current = { from: sel.from, to: sel.to }
                    const input = colorInputRef.current
                    if (!input) {
                      colorDebug('color input ref missing')
                      return
                    }
                    colorDebug('color input ref found')
                    const supportsShowPicker = typeof input.showPicker === 'function'
                    colorDebug('supports showPicker', supportsShowPicker)
                    const styles = window.getComputedStyle(input)
                    colorDebug('input styles', {
                      display: styles.display,
                      pointerEvents: styles.pointerEvents,
                    })
                    try {
                      if (supportsShowPicker) {
                        input.showPicker()
                        colorDebug('showPicker invoked')
                      } else {
                        colorDebug('falling back to click()')
                        input.click()
                      }
                    } catch (err) {
                      colorDebug('failed to open color picker', err)
                    }
                  }}
                >
                  🎨
                </button>
                <input
                  ref={colorInputRef}
                  type="color"
                  style={{ position: 'absolute', left: '-9999px' }}
                  onChange={(e) =>
                    apply(
                      () => {
                        colorDebug('color input changed', e.target.value)
                        const { from, to } =
                          selectionRef.current || editor.state.selection
                        editor
                          .chain()
                          .focus()
                          .setTextSelection({ from, to })
                          .setColor(e.target.value)
                          .run()
                        editor.commands.setTextSelection({ from, to })
                      },
                      false,
                    )
                  }
                />
              </div>
              <button onClick={() => setActiveMenu('size')}>Size</button>
            </div>
          )}
          {activeMenu === 'size' && (
            <div className="context-menu format fade-in">
              <button
                onClick={() =>
                  apply(() => editor.chain().focus().setParagraph().run(), false)
                }
              >
                Normal
              </button>
              {[
                { label: 'Big', level: 1 },
                { label: 'Medium', level: 2 },
                { label: 'Small', level: 3 },
              ].map(({ label, level }) => (
                <button
                  key={level}
                  onClick={() =>
                    apply(
                      () =>
                        editor
                          .chain()
                          .focus()
                          .toggleHeading({ level })
                          .run(),
                      false,
                    )
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {activeMenu === 'ai' && (
            <div className="ai-rescript-panel fade-in">
              {AI_SUGGESTIONS.map((s, i) => (
                <div
                  key={i}
                  className="ai-line"
                  onClick={() => replaceSelection(s)}
                >
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default TipTapEditor
