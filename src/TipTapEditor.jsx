import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import './TipTapEditor.css'
import './utils/disableLinks.css'
import { handleContextMenu as handleContextMenuUtil } from './utils/contextMenu.js'

function TipTapEditor({ initialHtml = '', onUpdate, onReady, style = {} }) {
  const containerRef = useRef(null)
  const lastAppliedHtmlRef = useRef(initialHtml)
  const editor = useEditor(
    {
      extensions: [StarterKit, TextStyle, Color],
      content: initialHtml,
      onUpdate: ({ editor }) => {
        onUpdate?.(editor.getHTML())
      },
    },
    [],
  )

  useEffect(() => {
    if (editor) onReady?.(editor)
  }, [editor, onReady])

  useEffect(() => {
    if (!editor || lastAppliedHtmlRef.current === initialHtml) return
    if (editor.getHTML() === initialHtml) {
      lastAppliedHtmlRef.current = initialHtml
      return
    }
    editor.commands.setContent(initialHtml, false)
    lastAppliedHtmlRef.current = initialHtml
  }, [editor, initialHtml])

  const [menuPos, setMenuPos] = useState(null)
  const [activeMenu, setActiveMenu] = useState('root')
  const [_menuHistory, setMenuHistory] = useState(['root'])
  const colorInputRef = useRef(null)
  const selectionRef = useRef(null)
  const [isColorPickerOpen, setColorPickerOpen] = useState(false)
  const [spellSuggestions, setSpellSuggestions] = useState([])

  const openMenu = (pos) => {
    setMenuPos(pos)
    setActiveMenu('root')
    setMenuHistory(['root'])
    setSpellSuggestions([])
  }

  const navigateTo = (menu) => {
    setActiveMenu(menu)
    setMenuHistory((prev) => [...prev, menu])
  }

  const goBack = () => {
    setMenuHistory((prev) => {
      if (prev.length <= 1) {
        setMenuPos(null)
        setActiveMenu('root')
        setSpellSuggestions([])
        return ['root']
      }
      const next = prev.slice(0, -1)
      setActiveMenu(next[next.length - 1])
      return next
    })
  }

  const apply = (action, close = true) => {
    action?.()
    if (close) {
      setMenuPos(null)
      setActiveMenu('root')
      setMenuHistory(['root'])
      setSpellSuggestions([])
    }
  }

  const handleContextMenu = (e) =>
    handleContextMenuUtil(e, {
      editor,
      containerRef,
      openMenu,
      setSpellSuggestions,
    })


  useEffect(() => {
    const hide = (e) => {
      if (isColorPickerOpen) return
      if (!e.target.closest('.context-menu-root')) {
        setMenuPos(null)
        setActiveMenu('root')
        setMenuHistory(['root'])
      }
    }
    window.addEventListener('mousedown', hide)
    return () => window.removeEventListener('mousedown', hide)
  }, [isColorPickerOpen])

  const replaceSelection = (text) => {
    editor
      ?.chain()
      .focus()
      .insertContent(text)
      .run()
    setMenuPos(null)
    setActiveMenu('root')
    setMenuHistory(['root'])
    setSpellSuggestions([])
  }

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
          className="context-menu-root"
          style={{ top: menuPos.y, left: menuPos.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {activeMenu === 'root' && (
            <>
              {spellSuggestions.length > 0 && (
                <div className="context-menu suggestions fade-in">
                  {spellSuggestions.map((sug) => (
                    <button key={sug} onClick={() => replaceSelection(sug)}>
                      {sug}
                    </button>
                  ))}
                </div>
              )}
              <div className="context-menu fade-in">
                <button onClick={goBack}>x</button>
                <button onClick={() => navigateTo('format')}>A</button>
              </div>
            </>
          )}
          {activeMenu === 'format' && (
            <div className="context-menu format fade-in">
              <button onClick={goBack}>?</button>
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
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    const sel = editor.state.selection
                    selectionRef.current = { from: sel.from, to: sel.to }
                    const el = colorInputRef.current
                    if (!el) return
                    el.focus()
                    if (typeof el.showPicker === 'function') el.showPicker()
                    else el.click()
                    setColorPickerOpen(true)
                  }}
                >
                  ??
                </button>
                <input
                  ref={colorInputRef}
                  type="color"
                  style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
                  onChange={(e) => {
                    apply(
                      () => {
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
                  }}
                  onBlur={() => setColorPickerOpen(false)}
                />
              </div>
              <button onClick={() => navigateTo('size')}>Size</button>
            </div>
          )}
          {activeMenu === 'size' && (
            <div className="context-menu format fade-in">
              <button onClick={goBack}>?</button>
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
        </div>
      )}
    </div>
  )
}

export default TipTapEditor
