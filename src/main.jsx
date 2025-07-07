import React from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router-dom'
import './index.css'

import App from './App.jsx'
import Prompter from './Prompter.jsx'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/prompter" element={<Prompter />} />
      </Routes>
    </HashRouter>
  </React.StrictMode>
)
