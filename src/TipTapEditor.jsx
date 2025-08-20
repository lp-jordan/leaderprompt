import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import { toast } from 'react-hot-toast'
import './TipTapEditor.css'
import './utils/disableLinks.css'

function TipTapEditor({ initialHtml = '', onUpdate, onReady, style = {} }) {
  const containerRef = useRef(null)
  const editor = useEditor({
    extensions: [StarterKit, TextStyle, Color],
    content: initialHtml,
    onUpdate: ({ editor }) => {
      onUpdate?.(editor.getHTML())
    },
  })

  useEffect(() => {
    if (editor) onReady?.(editor)
  }, [editor, onReady])

  const [menuPos, setMenuPos] = useState(null)
  const [activeMenu, setActiveMenu] = useState('root')
  const [_menuHistory, setMenuHistory] = useState(['root'])
  const colorInputRef = useRef(null)
  const selectionRef = useRef(null)
  const [isColorPickerOpen, setColorPickerOpen] = useState(false)
  const [selectedText, setSelectedText] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const rewriteIdRef = useRef(null)
  const [errorMessage, setErrorMessage] = useState(null)
  const loaderRef = useRef(null)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [modifier, setModifier] = useState('')
  const [isModifierInputVisible, setModifierInputVisible] = useState(false)

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
    if (!editor) return
    const sel = editor.state.selection
    if (sel.empty) return
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

  // Context menu now opens only via right click; no automatic menu on selection.

  const cancelRewrite = () => {
    if (loaderRef.current) {
      clearInterval(loaderRef.current)
      loaderRef.current = null
    }
    if (rewriteIdRef.current && window.electronAPI?.abortRewrite) {
      window.electronAPI.abortRewrite(rewriteIdRef.current)
      rewriteIdRef.current = null
    }
  }

  const runRewrite = (textArg, modifierArg = modifier) => {
    if (
      !editor ||
      !window.electronAPI?.rewriteSelection ||
      !window.electronAPI?.abortRewrite
    ) {
      console.error('electronAPI unavailable')
      return
    }
    const sel = editor.state.selection
    const text =
      textArg ??
      (sel.empty
        ? ''
        : editor.state.doc.textBetween(sel.from, sel.to, ' '))
    if (!text.trim()) {
      const msg = 'No suggestions available'
      setErrorMessage(msg)
      setSuggestions([msg])
      return
    }

    let context
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length
    if (wordCount <= 2) {
      const beforeWords = editor.state.doc
        .textBetween(0, sel.from, ' ')
        .trim()
        .split(/\s+/)
      const afterWords = editor.state.doc
        .textBetween(sel.to, editor.state.doc.content.size, ' ')
        .trim()
        .split(/\s+/)
      const before = beforeWords.slice(-10).join(' ')
      const after = afterWords.slice(0, 10).join(' ')
      context = `${before} ${text} ${after}`.trim()
    }

    cancelRewrite()
    setSelectedText(text)
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

    setErrorMessage(null)
    const { id, promise } = window.electronAPI.rewriteSelection(
      text,
      modifierArg,
      context,
    )
    rewriteIdRef.current = id
    promise
      .then((res) => {
        if (res?.error === 'Rate limit exceeded') {
          const msg = 'Rate limit exceeded'
          setErrorMessage(msg)
          setSuggestions([msg])
        } else if (!Array.isArray(res) || res.length !== 3) {
          const msg = 'No suggestions available'
          setErrorMessage(msg)
          setSuggestions([msg])
        } else {
          setErrorMessage(null)
          setSuggestions(res)
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          const msg = err && err.message ? err.message : 'No suggestions available'
          setErrorMessage(msg)
          toast.error(msg)
          setSuggestions([msg])
        }
      })
      .finally(() => {
        clearInterval(loaderRef.current)
        loaderRef.current = null
      })
  }

  const handleAiClick = () => {
    navigateTo('ai')
    const sel = editor.state.selection
    const text = sel.empty
      ? ''
      : editor.state.doc.textBetween(sel.from, sel.to, ' ')
    runRewrite(text)
  }

  useEffect(() => {
    if (activeMenu === 'ai' && menuPos !== null) {
      return cancelRewrite
    }
    cancelRewrite()
    return undefined
  }, [activeMenu, menuPos])

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
              <div className="context-menu fade-in">
                <button onClick={goBack}>x</button>
                <button onClick={() => navigateTo('format')}>A</button>
                <button
                  onClick={handleAiClick}
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
              <div className="ai-header">
                <button className="back-btn" onClick={goBack}>←</button>
                <div className="ai-header-right">
                  {!isModifierInputVisible && (
                    <button
                      className="modifier-btn"
                      onClick={() => setModifierInputVisible(true)}
                    >
                      Add style
                    </button>
                  )}
                  <button
                    className="rerun-btn"
                    onClick={() => runRewrite(selectedText)}
                    title="Run again"
                  >
                    ↻
                  </button>
                </div>
              </div>
              {isModifierInputVisible && (
                <input
                  className="modifier-input"
                  type="text"
                  placeholder="e.g. formal, playful"
                  value={modifier}
                  onChange={(e) => setModifier(e.target.value)}
                />
              )}
              {suggestions.map((result, i) => (
                <div
                  key={i}
                  className="ai-line"
                  onClick={!errorMessage ? () => replaceSelection(result) : undefined}
                >
                  {result}
                </div>
              ))}
              {errorMessage && (
                <div className="retry">
                  <button onClick={() => runRewrite(selectedText)}>Retry</button>
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
