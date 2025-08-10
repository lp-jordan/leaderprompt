import { useEffect, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import './TipTapEditor.css'

function TipTapEditor({ initialHtml = '', onUpdate }) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: initialHtml,
    onUpdate: ({ editor }) => {
      onUpdate?.(editor.getHTML())
    },
  })

  const [menuPos, setMenuPos] = useState(null)

  const apply = (action) => {
    action()
    setMenuPos(null)
  }

  const handleContextMenu = (e) => {
    e.preventDefault()
    setMenuPos({ x: e.clientX, y: e.clientY })
  }

  useEffect(() => {
    const hide = () => setMenuPos(null)
    window.addEventListener('click', hide)
    return () => window.removeEventListener('click', hide)
  }, [])

  useEffect(() => {
    if (editor && initialHtml !== editor.getHTML()) {
      editor.commands.setContent(initialHtml)
    }
  }, [initialHtml, editor])

  return (
    <div className="tiptap-editor" onContextMenu={handleContextMenu}>
      <EditorContent editor={editor} />
      {menuPos && editor && (
        <div
          className="editor-context-menu"
          style={{ top: menuPos.y, left: menuPos.x }}
        >
          <button
            onClick={() =>
              apply(() => editor.chain().focus().toggleBold().run())
            }
          >
            Bold
          </button>
          <button
            onClick={() =>
              apply(() => editor.chain().focus().toggleItalic().run())
            }
          >
            Italic
          </button>
          <button
            onClick={() =>
              apply(() => editor.chain().focus().setParagraph().run())
            }
          >
            Normal
          </button>
          <button
            onClick={() =>
              apply(() =>
                editor.chain().focus().toggleHeading({ level: 1 }).run()
              )
            }
          >
            Heading 1
          </button>
          <button
            onClick={() =>
              apply(() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              )
            }
          >
            Heading 2
          </button>
        </div>
      )}
    </div>
  )
}

export default TipTapEditor
