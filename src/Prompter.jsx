import { useEffect, useState, useRef } from 'react'
import './Prompter.css'

const MARGIN_MIN = 0
const MARGIN_MAX = 600
const SPEED_MIN = 0.25
const SPEED_MAX = 10

function Prompter() {
  const [content, setContent] = useState('')
  const [autoscroll, setAutoscroll] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [margin, setMargin] = useState(100)
  const [fontSize, setFontSize] = useState(2)
  const [mirrorX, setMirrorX] = useState(false)
  const [mirrorY, setMirrorY] = useState(false)
  const [transparent, setTransparent] = useState(false)
  const [shadowStrength, setShadowStrength] = useState(8)
  const [strokeWidth, setStrokeWidth] = useState(0)
  const [lineHeight, setLineHeight] = useState(1.6)
  const [textAlign, setTextAlign] = useState('left')
  const containerRef = useRef(null)
  const initialized = useRef(false)

  const startResize = async (e, edge) => {
    e.preventDefault()
    const startX = e.screenX
    const startY = e.screenY
    const bounds = await window.electronAPI.getPrompterBounds()

    const onMove = (ev) => {
      const dx = ev.screenX - startX
      const dy = ev.screenY - startY
      const newBounds = { ...bounds }

      if (edge.includes('right')) newBounds.width = Math.max(100, bounds.width + dx)
      if (edge.includes('bottom')) newBounds.height = Math.max(100, bounds.height + dy)
      if (edge.includes('left')) {
        newBounds.width = Math.max(100, bounds.width - dx)
        newBounds.x = bounds.x + dx
      }
      if (edge.includes('top')) {
        newBounds.height = Math.max(100, bounds.height - dy)
        newBounds.y = bounds.y + dy
      }

      window.electronAPI.setPrompterBounds(newBounds)
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    const handleLoaded = (html) => {
      setContent(html)
    }
    const handleUpdated = (html) => {
      setContent(html)
    }

    window.electronAPI.onScriptLoaded(handleLoaded)
    window.electronAPI.onScriptUpdated(handleUpdated)
    window.electronAPI.getCurrentScript().then((html) => {
      if (html) setContent(html)
    })

    return () => {}
  }, [])

  useEffect(() => {
    const handleTransparent = (flag) => {
      setTransparent(flag)
    }
    window.electronAPI.onTransparentChange(handleTransparent)
    return () => {}
  }, [])

  useEffect(() => {
    if (!autoscroll) return undefined
    let requestId
    const step = () => {
      if (containerRef.current) {
        containerRef.current.scrollTop += speed
      }
      requestId = requestAnimationFrame(step)
    }
    requestId = requestAnimationFrame(step)
    return () => cancelAnimationFrame(requestId)
  }, [autoscroll, speed])

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      return
    }
    window.electronAPI.setPrompterAlwaysOnTop(transparent)
    const color = transparent ? 'transparent' : '#1e1e1e'
    document.documentElement.style.backgroundColor = color
    document.body.style.backgroundColor = color
    window.electronAPI.openPrompter(content, transparent)
    // intentionally omit "content" from deps
  }, [transparent]) // eslint-disable-line react-hooks/exhaustive-deps

  const headerStyle = {
    height: transparent ? '6px' : '28px',
    background: transparent ? 'rgba(0,0,0,0.1)' : '#333',
    boxShadow: transparent ? 'none' : '0 2px 4px rgba(0,0,0,0.5)',
  }

  return (
    <div className="prompter-wrapper">
      <div className="drag-header" style={headerStyle}>
        {!transparent && (
          <div className="window-buttons">
            <button onClick={() => window.electronAPI.minimizePrompter()}>
              &minus;
            </button>
            <button onClick={() => window.electronAPI.closePrompter()}>
              &times;
            </button>
          </div>
        )}
      </div>
      <div className="resize-handle top" onMouseDown={(e) => startResize(e, 'top')} />
      <div className="resize-handle bottom" onMouseDown={(e) => startResize(e, 'bottom')} />
      <div className="resize-handle left" onMouseDown={(e) => startResize(e, 'left')} />
      <div className="resize-handle right" onMouseDown={(e) => startResize(e, 'right')} />
      <div className="resize-handle top-left" onMouseDown={(e) => startResize(e, 'top-left')} />
      <div className="resize-handle top-right" onMouseDown={(e) => startResize(e, 'top-right')} />
      <div className="resize-handle bottom-left" onMouseDown={(e) => startResize(e, 'bottom-left')} />
      <div className="resize-handle bottom-right" onMouseDown={(e) => startResize(e, 'bottom-right')} />
      <div className="prompter-controls">
        <details open>
          <summary>Text Styling</summary>
          <label>
            Font Size ({fontSize}rem):
            <input
              type="range"
              min="1"
              max="6"
              step="0.1"
              value={fontSize}
              onChange={(e) => setFontSize(parseFloat(e.target.value))}
            />
          </label>
          <label>
            Text Alignment:
            <select value={textAlign} onChange={(e) => setTextAlign(e.target.value)}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
              <option value="justify">Justify</option>
            </select>
          </label>
          <label>
            Shadow ({shadowStrength}px)
            <input
              type="range"
              min="0"
              max="20"
              value={shadowStrength}
              onChange={(e) => setShadowStrength(parseInt(e.target.value, 10))}
            />
          </label>
          <label>
            Stroke ({strokeWidth}px)
            <input
              type="range"
              min="0"
              max="4"
              step="0.5"
              value={strokeWidth}
              onChange={(e) => setStrokeWidth(parseFloat(e.target.value))}
            />
          </label>
          <label>
            Line Height ({lineHeight})
            <input
              type="range"
              min="1"
              max="3"
              step="0.1"
              value={lineHeight}
              onChange={(e) => setLineHeight(parseFloat(e.target.value))}
            />
          </label>
        </details>
        <details>
          <summary>Layout &amp; Display</summary>
          <label>
            Margin ({Math.round(((margin - MARGIN_MIN) / (MARGIN_MAX - MARGIN_MIN)) * 100)}%):
            <input
              type="range"
              min={MARGIN_MIN}
              max={MARGIN_MAX}
              value={margin}
              onChange={(e) => setMargin(parseInt(e.target.value, 10))}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={mirrorX}
              onChange={() => setMirrorX(!mirrorX)}
            />
            Mirror Horizontal
          </label>
          <label>
            <input
              type="checkbox"
              checked={mirrorY}
              onChange={() => setMirrorY(!mirrorY)}
            />
            Mirror Vertical
          </label>
          <label>
            <input
              type="checkbox"
              checked={transparent}
              onChange={() => setTransparent(!transparent)}
            />
            Transparent Mode
          </label>
        </details>
        <details>
          <summary>Behavior</summary>
          <label>
            Speed ({Math.round(((speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * 100)}%):
            <input
              type="range"
              min={SPEED_MIN}
              max={SPEED_MAX}
              value={speed}
              step="0.05"
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={autoscroll}
              onChange={() => setAutoscroll(!autoscroll)}
            />
            Auto-scroll
          </label>
        </details>
      </div>
      <div
        ref={containerRef}
        className="prompter-container"
        style={{
          padding: `2rem ${margin}px`,
          fontSize: `${fontSize}rem`,
          lineHeight,
          textAlign,
          transform: `scale(${mirrorX ? -1 : 1}, ${mirrorY ? -1 : 1})`,
          background: transparent ? 'transparent' : '#000',
          color: '#e0e0e0',
          textShadow:
            shadowStrength > 0
              ? `0 0 ${shadowStrength}px rgba(0,0,0,0.8)`
              : 'none',
          WebkitTextStroke:
            strokeWidth > 0 ? `${strokeWidth}px black` : '0',
        }}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    </div>
  )
}

export default Prompter
