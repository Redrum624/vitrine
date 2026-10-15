import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './globals.css'
import App from './App.tsx'
import { logger } from './utils/Logger' // Initialize logger
import { initMemoryPreset } from './services/memoryPresetRuntime'

// Initialize logger
logger.info('Vitrine starting up');

// Apply the stored memory preset (cache budgets, preview cap) before the first image opens.
void initMemoryPreset();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)