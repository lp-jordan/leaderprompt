import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import './index.css'

import App from './App.jsx'
import Prompter from './Prompter.jsx'
import SpeechFollowWindow from './SpeechFollowWindow.jsx'
import DevConsole from './DevConsole.jsx'
import Updater from './Updater.jsx'
import ReadPage from './ReadPage.jsx'
import SplashScreen from './components/SplashScreen.jsx'

function getInitialRoute() {
  const hash = window.location.hash.replace(/^#/, '')
  return hash || '/'
}

export default function Root() {
  const initialRoute = getInitialRoute()
  const shouldUseSplash = initialRoute === '/'
  const [showSplash, setShowSplash] = useState(shouldUseSplash)

  useEffect(() => {
    if (!shouldUseSplash) return undefined
    const timer = setTimeout(() => setShowSplash(false), 2000)
    return () => clearTimeout(timer)
  }, [shouldUseSplash])

  if (showSplash) {
    return <SplashScreen />
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/read" element={<ReadPage />} />
        <Route path="/prompter" element={<Prompter />} />
        <Route path="/speech-follow-inspector" element={<SpeechFollowWindow />} />
        <Route path="/dev-console" element={<DevConsole />} />
      </Routes>
      <Updater />
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: 'linear-gradient(180deg, rgba(26, 34, 45, 0.98), rgba(15, 21, 30, 0.98))',
            color: '#f2ebdd',
            border: '1px solid rgba(121, 136, 153, 0.22)',
            borderRadius: '16px',
            boxShadow: '0 18px 50px rgba(3, 8, 14, 0.34)',
          },
          success: {
            iconTheme: {
              primary: '#7f9a77',
              secondary: '#0d131b',
            },
          },
          error: {
            iconTheme: {
              primary: '#b86e66',
              secondary: '#0d131b',
            },
          },
        }}
      />
    </HashRouter>
  )
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
