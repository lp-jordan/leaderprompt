import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import './TipTapEditor.css'

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
  const [showColor, setShowColor] = useState(false)

  const openMenu = (pos) => {
    setMenuPos(pos)
    setActiveMenu('root')
    setShowColor(false)
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
        setMenuPos(null)
        setActiveMenu('root')
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
                <button onClick={() => setShowColor((v) => !v)}>🎨</button>
                {showColor && (
                  <input
                    type="color"
                    onChange={(e) =>
                      apply(
                        () =>
                          editor
                            .chain()
                            .focus()
                            .setColor(e.target.value)
                            .run(),
                        false
                      )
                    }
                  />
                )}
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
