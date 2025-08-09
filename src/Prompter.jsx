import { useEffect, useState, useRef } from 'react'
import './Prompter.css'

const MARGIN_MIN = 0
const MARGIN_MAX = 600
const DEFAULT_MARGIN = (MARGIN_MAX - MARGIN_MIN) * 0.4
const SPEED_MIN = 0.25
const SPEED_MAX = 10

function Prompter() {
  const [content, setContent] = useState('')
  const [autoscroll, setAutoscroll] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [margin, setMargin] = useState(DEFAULT_MARGIN)
  const [fontSize, setFontSize] = useState(2)
  const [mirrorX, setMirrorX] = useState(false)
  const [mirrorY, setMirrorY] = useState(false)
  const [shadowStrength, setShadowStrength] = useState(8)
  const [strokeWidth, setStrokeWidth] = useState(0)
  const [lineHeight, setLineHeight] = useState(1.6)
  const [textAlign, setTextAlign] = useState('left')
  const [notecardMode, setNotecardMode] = useState(false)
  const [transparentMode, setTransparentMode] = useState(false)
  const [slides, setSlides] = useState([])
  const [currentSlide, setCurrentSlide] = useState(0)
  // all settings are now accessible from a single panel
  const [mainSettingsOpen, setMainSettingsOpen] = useState(false)
  const containerRef = useRef(null)

  const resetDefaults = () => {
    setAutoscroll(false)
    setSpeed(1)
    setMargin(DEFAULT_MARGIN)
    setFontSize(2)
    setMirrorX(false)
    setMirrorY(false)
    setShadowStrength(8)
    setStrokeWidth(0)
    setLineHeight(1.6)
    setTextAlign('center')
    setNotecardMode(false)
    setTransparentMode(false)
  }

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

  // Initial script loading on mount only
  useEffect(() => {
    let ready = false
    const handleLoaded = (html) => {
      if (ready) setContent(html)
    }
    const handleUpdated = (html) => {
      setContent(html)
    }

    const cleanupLoaded = window.electronAPI.onScriptLoaded(handleLoaded)
    const cleanupUpdated = window.electronAPI.onScriptUpdated(handleUpdated)
    window.electronAPI.getCurrentScript().then((html) => {
      if (html) setContent(html)
      ready = true
    })

    return () => {
      cleanupLoaded?.()
      cleanupUpdated?.()
    }
  }, [])


  useEffect(() => {
    if (!autoscroll || notecardMode) return undefined
    let requestId
    const step = () => {
      if (containerRef.current) {
        containerRef.current.scrollTop += speed
      }
      requestId = requestAnimationFrame(step)
    }
    requestId = requestAnimationFrame(step)
    return () => cancelAnimationFrame(requestId)
  }, [autoscroll, speed, notecardMode])

  // Generate notecard slides when layout-related values change
  useEffect(() => {
    if (!notecardMode || !containerRef.current) return

    const container = containerRef.current
    const height = container.clientHeight
    const width = container.clientWidth - margin * 2

    const measure = document.createElement('div')
    measure.style.position = 'absolute'
    measure.style.visibility = 'hidden'
    measure.style.pointerEvents = 'none'
    measure.style.width = `${width}px`
    measure.style.fontSize = `${fontSize}rem`
    measure.style.lineHeight = lineHeight
    measure.style.whiteSpace = 'normal'
    document.body.appendChild(measure)

    const parser = document.createElement('div')
    parser.innerHTML = content
    const nodes = Array.from(parser.childNodes)

    const newSlides = []
    let current = ''
    measure.innerHTML = ''
    nodes.forEach((node) => {
      const clone = node.cloneNode(true)
      measure.appendChild(clone)
      if (measure.scrollHeight > height && current) {
        newSlides.push(current)
        measure.innerHTML = ''
        measure.appendChild(clone)
        current = clone.outerHTML || clone.textContent
      } else {
        current += clone.outerHTML || clone.textContent
      }
    })
    if (current) newSlides.push(current)
    document.body.removeChild(measure)
    setSlides(newSlides)
    setCurrentSlide(0)
  }, [notecardMode, content, fontSize, lineHeight, margin])

  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = 0
  }, [currentSlide])

  // Clear slides when disabling notecard mode
  useEffect(() => {
    if (!notecardMode) {
      setSlides([])
      setCurrentSlide(0)
    }
  }, [notecardMode])


  // notify main process when the prompter component is ready
  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      window.electronAPI.prompterReady()
    }
  }, [])

  return (
    <div className="prompter-wrapper">
      <div className="resize-handle top" onMouseDown={(e) => startResize(e, 'top')} />
      <div className="resize-handle bottom" onMouseDown={(e) => startResize(e, 'bottom')} />
      <div className="resize-handle left" onMouseDown={(e) => startResize(e, 'left')} />
      <div className="resize-handle right" onMouseDown={(e) => startResize(e, 'right')} />
      <div className="resize-handle top-left" onMouseDown={(e) => startResize(e, 'top-left')} />
      <div className="resize-handle top-right" onMouseDown={(e) => startResize(e, 'top-right')} />
      <div className="resize-handle bottom-left" onMouseDown={(e) => startResize(e, 'bottom-left')} />
      <div className="resize-handle bottom-right" onMouseDown={(e) => startResize(e, 'bottom-right')} />
        <button
          className="main-settings-toggle"
          style={{ left: mainSettingsOpen ? '220px' : '0' }}
          onClick={() => setMainSettingsOpen(!mainSettingsOpen)}
        >
          {mainSettingsOpen ? '←' : '→'}
        </button>
        <div className={`main-settings ${mainSettingsOpen ? 'open' : ''}`}>
        <button
          className="stop-button"
          onClick={() => window.electronAPI.closePrompter()}
        >
          Stop Prompting
        </button>
        <button
          className={`toggle-btn ${autoscroll ? 'active' : ''}`}
          onClick={() => setAutoscroll(!autoscroll)}
          disabled={notecardMode}
        >
          Auto-scroll
        </button>
        <label>
          Speed
          <input
            type="range"
            min={SPEED_MIN}
            max={SPEED_MAX}
            value={speed}
            step="0.05"
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            disabled={notecardMode}
          />
        </label>
        <button onClick={() => setMirrorX(!mirrorX)}>Flip Horizontally</button>
        <button onClick={() => setMirrorY(!mirrorY)}>Flip Vertically</button>
        <button
          className={`toggle-btn ${notecardMode ? 'active' : ''}`}
          onClick={() => {
            setNotecardMode(!notecardMode)
            if (!notecardMode) setAutoscroll(false)
          }}
        >
          Notecard
        </button>
        <button
          className={`toggle-btn ${transparentMode ? 'active' : ''}`}
          onClick={() => setTransparentMode(!transparentMode)}
        >
          Transparent
        </button>
        <h4>Text Styling</h4>
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
          Margin ({Math.round(((margin - MARGIN_MIN) / (MARGIN_MAX - MARGIN_MIN)) * 100)}%):
          <input
            type="range"
            min={MARGIN_MIN}
            max={MARGIN_MAX}
            value={margin}
            onChange={(e) => setMargin(parseInt(e.target.value, 10))}
          />
        </label>
        <button onClick={resetDefaults}>Reset to defaults</button>
        <h4>Advanced Settings</h4>
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
        <label>
          Stroke ({strokeWidth}px)
          <input
            type="range"
            min="0"
            max="4"
            step="0.5"
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(parseFloat(e.target.value))}
            disabled={!transparentMode}
          />
        </label>
        <label>
          Shadow ({shadowStrength}px)
          <input
            type="range"
            min="0"
            max="20"
            value={shadowStrength}
            onChange={(e) => setShadowStrength(parseInt(e.target.value, 10))}
            disabled={!transparentMode}
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
          textShadow:
            transparentMode && shadowStrength > 0
              ? `0 0 ${shadowStrength}px rgba(0,0,0,0.8)`
              : 'none',
          WebkitTextStroke:
            transparentMode && strokeWidth > 0 ? `${strokeWidth}px black` : '0',
          overflowY: notecardMode ? 'hidden' : 'scroll',
        }}
        dangerouslySetInnerHTML={{
          __html: notecardMode ? slides[currentSlide] || '' : content,
        }}
      />
      {notecardMode && slides.length > 1 && (
        <div className="notecard-controls">
          <button
            onClick={() =>
              setCurrentSlide(Math.max(currentSlide - 1, 0))
            }
          >
            Prev
          </button>
          <span className="notecard-index">
            {currentSlide + 1} / {slides.length}
          </span>
          <button
            onClick={() =>
              setCurrentSlide(Math.min(currentSlide + 1, slides.length - 1))
            }
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}

export default Prompter
