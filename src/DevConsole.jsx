import { useEffect, useState } from 'react'
import './DevConsole.css'

function DevConsole() {
  const [logs, setLogs] = useState([])

  useEffect(() => {
    const handler = (msg) => {
      setLogs((prev) => [...prev, msg])
    }
    if (!window.electronAPI?.onLogMessage) {
      console.error('electronAPI unavailable')
      return
    }
    const cleanup = window.electronAPI.onLogMessage(handler)
    return () => {
      cleanup?.()
    }
  }, [])

  return (
    <div className="dev-console">
      {logs.map((msg, idx) => (
        <div key={idx} className="log-line">{msg}</div>
      ))}
    </div>
  )
}

export default DevConsole
