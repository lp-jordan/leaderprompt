import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import './index.css'

import App from './App.jsx'
import Prompter from './Prompter.jsx'
import DevConsole from './DevConsole.jsx'
import Updater from './Updater.jsx'
import ReadPage from './ReadPage.jsx'
import SplashScreen from './components/SplashScreen.jsx'

export default function Root() {
  const [showSplash, setShowSplash] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 2000)
    return () => clearTimeout(timer)
  }, [])

  if (showSplash) {
    return <SplashScreen />
  }

  return (
    <HashRouter>
      <Routes>
          <Route path="/" element={<App />} />
          <Route path="/read" element={<ReadPage />} />
          <Route path="/prompter" element={<Prompter />} />
          <Route path="/dev-console" element={<DevConsole />} />
      </Routes>
      <Updater />
      <Toaster position="top-right" />
    </HashRouter>
  )
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
