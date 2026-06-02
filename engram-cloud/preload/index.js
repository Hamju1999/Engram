import { contextBridge, ipcRenderer } from 'electron'

// ─── WHAT IS CONTEXT BRIDGE ───────────────────────────────────────────────────
// contextBridge is Electron's controlled channel for crossing the security
// boundary between the Node.js world (main + preload) and the browser world
// (renderer / React).
//
// exposeInMainWorld(name, api) does two things:
//   1. Attaches `api` to window.{name} in the renderer
//   2. Deep-clones the object through a structured clone algorithm that
//      strips any prototype chain, preventing prototype pollution attacks
//
// The renderer receives a plain object with callable functions.
// It cannot reach back through those functions to access Node.js internals.
// The boundary is one-way and enforced by V8 itself, not just convention.

// ─── WHAT IS ipcRenderer.invoke ───────────────────────────────────────────────
// ipcRenderer.invoke(channel, ...args):
//   - Sends a message to the main process on the named channel
//   - Returns a Promise that resolves with whatever ipcMain.handle() returns
//   - This is async request-response - the renderer awaits the result
//
// Alternative ipcRenderer.send() is fire-and-forget - no return value.
// We never use send() here because every operation needs a result back
// (file path, config object, AI response, success confirmation, etc.)

// ─── EXPOSED API ─────────────────────────────────────────────────────────────
// Every function here is a thin wrapper around ipcRenderer.invoke().
// No logic lives here. No data transformation. No validation.
// Preload is a bridge, not a processor.
//
// React accesses these as: window.api.functionName(args)
// Each call crosses into main process, executes, and returns the result.

contextBridge.exposeInMainWorld('api', {

  // ── Config ──────────────────────────────────────────────────────────────
  // Called on app startup to read API keys, active model, and context path.
  loadConfig: () =>
    ipcRenderer.invoke('load-config'),

  // Called from settings panel when user updates API key or switches model.
  // newConfig = full config object with all fields.
  saveConfig: (newConfig) =>
    ipcRenderer.invoke('save-config', newConfig),

  // ── Session Lifecycle ────────────────────────────────────────────────────
  // Called once on user's very first message.
  // AI classifies domain and suggests filename. Returns {domain, filename}.
  classifyDomain: (firstMessage) =>
    ipcRenderer.invoke('classify-domain', firstMessage),

  // Called immediately after classifyDomain resolves.
  // Creates domain folder + session txt file with header.
  // Returns the absolute file path - store this, pass it to writeTurn.
  createSession: ({ domain, filename, model }) =>
    ipcRenderer.invoke('create-session', { domain, filename, model }),

  // ── Turn Writer ──────────────────────────────────────────────────────────
  // THE MOST IMPORTANT CALL IN THE APP.
  // Called twice per exchange, synchronously, before UI updates:
  //
  //   Step 1: user sends message
  //     → writeTurn({ filePath, role: 'user', content: userMessage })
  //     → appendFileSync writes to disk
  //     → THEN call sendMessage
  //
  //   Step 2: AI response arrives
  //     → writeTurn({ filePath, role: 'assistant', content: aiResponse })
  //     → appendFileSync writes to disk
  //     → THEN render the response in UI
  //
  // This ordering is non-negotiable. Write first, render second.
  // The file always leads the UI, never lags behind it.
  writeTurn: ({ filePath, role, content }) =>
    ipcRenderer.invoke('write-turn', { filePath, role, content }),

  // ── AI Messaging ─────────────────────────────────────────────────────────
  // Sends the conversation to the active AI model and returns the response.
  // messages      = [{role:'user', content:'...'}, {role:'assistant', content:'...'}, ...]
  //                 Full conversation history for this session.
  // systemContext = raw txt content of relevant domain files, injected as
  //                system prompt so AI has all prior context from past sessions.
  sendMessage: ({ messages, systemContext, attachments }) =>
    ipcRenderer.invoke('send-message', { messages, systemContext, attachments }),

  // ── Context Browser ──────────────────────────────────────────────────────
  // Returns array of domain folder names: ['medai', 'job_search', 'hamju_core']
  // Used to populate the domain list in the sidebar.
  listDomains: () =>
    ipcRenderer.invoke('list-domains'),

  // Returns array of session objects for a domain, newest first:
  // [{ name: 'adversarial_council_2026-06-01.txt', path: '...', modified: Date }]
  listSessions: (domain) =>
    ipcRenderer.invoke('list-sessions', domain),

  // Returns full verbatim string content of a session txt file.
  // Used to load past sessions for review, or inject as system context.
  readSession: (filePath) =>
    ipcRenderer.invoke('read-session', filePath),

  // ── File Attachments ─────────────────────────────────────────────────────
  // Opens the OS native file picker. Returns selected file path or null.
  pickFiles: () =>
    ipcRenderer.invoke('pick-files'),

  // Reads the selected file. Returns { name, ext, mimeType, isText, data }.
  // data is plain text for text files, base64 for images and PDFs.
  readAttachment: (filePath) =>
    ipcRenderer.invoke('read-attachment', filePath),

  // Multi-agent pipeline step listener.
  // The main process sends 'pipeline-step' events during the 3-stage workflow.
  // The renderer subscribes to show which stage is currently running.
  onPipelineStep: (callback) => {
    ipcRenderer.on('pipeline-step', (_event, step) => callback(step))
    // Return cleanup function so the component can remove listener on unmount
    return () => ipcRenderer.removeAllListeners('pipeline-step')
  }

})

// ─── WHAT REACT SEES ──────────────────────────────────────────────────────────
// After this file runs, the renderer has access to window.api with exactly
// the nine functions above. Nothing in Node.js. No require. No fs. No path.
// The attack surface of the renderer is exactly nine async functions.
//
// Usage in any React component:
//
//   const config = await window.api.loadConfig()
//   const { domain, filename } = await window.api.classifyDomain(firstMessage)
//   const filePath = await window.api.createSession({ domain, filename, model })
//   await window.api.writeTurn({ filePath, role: 'user', content })
//   const response = await window.api.sendMessage({ messages, systemContext })
//   await window.api.writeTurn({ filePath, role: 'assistant', content: response })
