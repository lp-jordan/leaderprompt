import React from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import './index.css'

import App from './App.jsx'
import Prompter from './Prompter.jsx'
import DevConsole from './DevConsole.jsx'
import Updater from './Updater.jsx'
import ReadPage from './ReadPage.jsx'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
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
  </React.StrictMode>
)
