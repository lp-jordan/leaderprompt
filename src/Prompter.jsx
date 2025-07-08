import { useEffect, useState, useRef } from 'react'
import './Prompter.css'

function Prompter() {
  const [content, setContent] = useState('')
  const [autoscroll, setAutoscroll] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [margin, setMargin] = useState(100)
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

  return (
    <div className="prompter-controls">
      <label>
        Margin:
        <input
          type="range"
          min="50"
          max="400"
          value={margin}
          onChange={(e) => setMargin(parseInt(e.target.value))}
        />
      </label>
      <label>
        Speed:
        <input
          type="range"
          min="1"
          max="10"
          value={speed}
          onChange={(e) => setSpeed(parseInt(e.target.value))}
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

      <div
        ref={containerRef}
        className="prompter-container"
        style={{ padding: `2rem ${margin}px` }}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    </div>
  )
}

export default Prompter
