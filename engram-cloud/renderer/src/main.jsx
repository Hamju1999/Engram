import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './App.css'
import App from './App'

// createRoot is React 18's concurrent rendering API.
// It replaces the old ReactDOM.render() from React 17.
// Concurrent mode enables React to pause, prioritize, and resume renders
// without blocking the UI thread - important for a chat app with streaming responses.

// StrictMode runs every component twice in development only (not production).
// Purpose: surfaces side effects, deprecated APIs, and unexpected behavior early.
// Has zero impact on production build.

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
