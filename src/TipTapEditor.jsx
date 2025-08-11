import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import './TipTapEditor.css'

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
  const [_menuHistory, setMenuHistory] = useState(['root'])
  const colorInputRef = useRef(null)
  const selectionRef = useRef(null)
  const [isColorPickerOpen, setColorPickerOpen] = useState(false)
  const [selectedText, setSelectedText] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [controller, setController] = useState(null)
  const [error, setError] = useState(null)
  const [retryCount, setRetryCount] = useState(0)
  const loaderRef = useRef(null)
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  const openMenu = (pos) => {
    setMenuPos(pos)
    setActiveMenu('root')
    setMenuHistory(['root'])
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
    const updateOnline = () => setIsOnline(navigator.onLine)
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    return () => {
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
    }
  }, [])

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
    if (!editor || activeMenu !== 'ai' || menuPos === null) return
    const sel = editor.state.selection
    const text = sel.empty
      ? ''
      : editor.state.doc.textBetween(sel.from, sel.to, ' ')
    if (text !== selectedText) setSelectedText(text)
    const frames = ['▹▹▹', '▸▹▹', '▹▸▹', '▹▹▸']
    let i = 0
    setSuggestions([frames[0], frames[1], frames[2]])
    loaderRef.current = setInterval(() => {
      i = (i + 1) % frames.length
      setSuggestions([
        frames[i],
        frames[(i + 1) % frames.length],
        frames[(i + 2) % frames.length],
      ])
    }, 150)
    return () => {
      clearInterval(loaderRef.current)
      loaderRef.current = null
    }
  }, [activeMenu, editor, selectedText, retryCount, menuPos])

  useEffect(() => {
    if (!window.electronAPI?.rewriteSelection) return
    if (activeMenu !== 'ai' || !selectedText.trim() || menuPos === null) return
    const ctrl = new AbortController()
    setController(ctrl)
    setError(null)
    window.electronAPI
      .rewriteSelection(selectedText, ctrl.signal)
      .then((res) => {
        setSuggestions(res)
        clearInterval(loaderRef.current)
        loaderRef.current = null
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError(true)
          clearInterval(loaderRef.current)
          loaderRef.current = null
          setSuggestions([])
        }
      })
    return () => ctrl.abort()
  }, [activeMenu, selectedText, retryCount, menuPos])

  useEffect(() => {
    if (activeMenu === 'ai' && menuPos !== null) return
    controller?.abort()
  }, [activeMenu, menuPos, controller])

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
    setActiveMenu('root')
    setMenuHistory(['root'])
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
            <>
              <div className="context-menu fade-in">
                <button onClick={goBack}>x</button>
                <button onClick={() => navigateTo('format')}>A</button>
                <button
                  onClick={() => navigateTo('ai')}
                  disabled={!isOnline}
                  title={isOnline ? '' : 'No internet connection'}
                >
                  ✨
                </button>
              </div>
              {!isOnline && (
                <div className="network-warning fade-in">
                  No internet connection
                </div>
              )}
            </>
          )}
          {activeMenu === 'format' && (
            <div className="context-menu format fade-in">
              <button onClick={goBack}>←</button>
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
                    // minimal change: ensure native picker opens reliably
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
                  🎨
                </button>
                <input
                  ref={colorInputRef}
                  type="color"
                  // minimal change: keep it in DOM & focusable (not fully offscreen)
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
              <button onClick={goBack}>←</button>
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
              <button className="back-btn" onClick={goBack}>←</button>
              {suggestions.map((result, i) => (
                <div
                  key={i}
                  className="ai-line"
                  onClick={() => replaceSelection(result)}
                >
                  {result}
                </div>
              ))}
              {error && (
                <div className="retry">
                  <button onClick={() => setRetryCount((c) => c + 1)}>Retry</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default TipTapEditor
