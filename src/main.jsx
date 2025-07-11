import React from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router-dom'
import './index.css'

import App from './App.jsx'
import Prompter from './Prompter.jsx'
import DevConsole from './DevConsole.jsx'

function DevIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M8 12l3 3-3 3M13 15h3" />
    </svg>
  )
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/prompter" element={<Prompter />} />
        <Route path="/dev-console" element={<DevConsole />} />
      </Routes>
      <button
        className="dev-console-button"
        onClick={() => window.electronAPI.openDevConsole()}
      >
        <DevIcon />
      </button>
    </HashRouter>
  </React.StrictMode>
)
