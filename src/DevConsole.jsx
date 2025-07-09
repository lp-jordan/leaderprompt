import { useEffect, useState } from 'react'
import './DevConsole.css'

function DevConsole() {
  const [logs, setLogs] = useState([])

  useEffect(() => {
    const handler = (msg) => {
      setLogs((prev) => [...prev, msg])
    }
    window.electronAPI.onLogMessage(handler)
    return () => {
      window.ipcRenderer?.removeListener('log-message', handler)
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
