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
  const [showShadow, setShowShadow] = useState(true)
  const [showStroke, setShowStroke] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    const handleLoaded = (html) => {
      setContent(html)
    }
    const handleUpdated = (html) => {
      setContent(html)
    }

    window.electronAPI.onScriptLoaded(handleLoaded)
    window.electronAPI.onScriptUpdated(handleUpdated)

    return () => {
      window.ipcRenderer?.removeListener('load-script', handleLoaded)
      window.ipcRenderer?.removeListener('update-script', handleUpdated)
    }
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
    window.electronAPI.setPrompterAlwaysOnTop(transparent)
    const root = document.documentElement
    root.style.background = transparent ? 'transparent' : '#1e1e1e'
    root.style.backgroundColor = transparent ? 'transparent' : '#1e1e1e'
  }, [transparent])

  return (
    <div className="prompter-wrapper">
      <div className="prompter-controls">
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
          checked={autoscroll}
          onChange={() => setAutoscroll(!autoscroll)}
        />
        Auto-scroll
      </label>
      <label>
        <input
          type="checkbox"
          checked={transparent}
          onChange={() => setTransparent(!transparent)}
        />
        Transparent Mode
      </label>
      <label>
        <input
          type="checkbox"
          checked={showShadow}
          onChange={() => setShowShadow(!showShadow)}
        />
        Text Shadow
      </label>
      <label>
        <input
          type="checkbox"
          checked={showStroke}
          onChange={() => setShowStroke(!showStroke)}
        />
        Text Stroke
      </label>
      </div>
      <div
        ref={containerRef}
        className="prompter-container"
        style={{
          padding: `2rem ${margin}px`,
          fontSize: `${fontSize}rem`,
          transform: `scale(${mirrorX ? -1 : 1}, ${mirrorY ? -1 : 1})`,
          background: transparent ? 'transparent' : '#000',
          color: '#e0e0e0',
          textShadow: showShadow
            ? '0 0 8px rgba(0,0,0,0.8)'
            : 'none',
          WebkitTextStroke: showStroke ? '1px black' : '0',
        }}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    </div>
  )
}

export default Prompter
