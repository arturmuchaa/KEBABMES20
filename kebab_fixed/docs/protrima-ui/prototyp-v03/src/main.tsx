import React from 'react'
import { createRoot } from 'react-dom/client'
// Czcionki osadzone lokalnie (tylko alfabet łaciński + polskie znaki) — działają offline, także w Tauri.
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-ext-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-ext-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-sans/latin-ext-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-ext-400.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/shell.css'
import './styles/table.css'
import './styles/modules.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
