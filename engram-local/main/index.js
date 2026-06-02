import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, basename, extname } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import {
  initContextDir, createSessionFile, writeTurn,
  listDomains, listSessions, readSession
} from './file-tools.js'
import mammoth from 'mammoth'
import pdfParse from 'pdf-parse'
import AdmZip from 'adm-zip'

// ─── PATHS ────────────────────────────────────────────────────────────────────
const CONFIG_PATH = join(app.getPath('userData'), 'config.json')

const DEFAULT_CONFIG = {
  contextDir:  join(app.getPath('documents'), 'EngramLocal', 'context'),
  serverType:  'ollama',
  serverUrl:   'http://localhost:11434/v1',
  activeMode:  'single',
  models: {
    primary:     'llama3.2',
    auditor:     'mistral',
    synthesizer: 'gemma2'
  }
}

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// No encryption needed - no cloud API keys in local version.
function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2))
    return DEFAULT_CONFIG
  }
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
}
function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

// ─── WINDOW ───────────────────────────────────────────────────────────────────
let mainWindow = null
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100, height: 780, minWidth: 720, minHeight: 500,
    title: 'Engram Local',
    backgroundColor: '#1c1c1c',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  })
  const isDev = !!process.env.ELECTRON_RENDERER_URL
  if (isDev) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ─── ATTACHMENT HELPERS ───────────────────────────────────────────────────────
function buildTextPrefix(attachments) {
  const textFiles = (attachments || []).filter(function(a) { return !a.isImage })
  if (!textFiles.length) return ''
  return textFiles.map(function(a) {
    return '=== File: ' + a.name + ' ===\n' + a.text + '\n=== End: ' + a.name + ' ==='
  }).join('\n\n') + '\n\n'
}

function imageContentBlocks(model, attachments) {
  return (attachments || []).filter(function(a) { return a.isImage }).map(function(img) {
    if (model === 'openai_compat') {
      return { type: 'image_url', image_url: { url: 'data:' + img.mimeType + ';base64,' + img.data } }
    }
    return null
  }).filter(Boolean)
}

// ─── LOCAL API CALLER ─────────────────────────────────────────────────────────
// All local model servers (Ollama, LM Studio, llama.cpp) expose an
// OpenAI-compatible /chat/completions endpoint. No thinking, no web search
// tools - those are cloud-only features. File content is embedded as plain text.

async function callLocal(modelName, messages, systemPrompt, config, attachments) {
  attachments = attachments || []
  const textPrefix = buildTextPrefix(attachments)
  const hasImages  = attachments.some(function(a) { return a.isImage })

  const preparedMessages = textPrefix
    ? messages.map(function(m, i) {
        return (i === messages.length - 1 && m.role === 'user')
          ? { role: m.role, content: textPrefix + m.content }
          : m
      })
    : messages

  // Images: inject as base64 content arrays if model supports vision
  const finalMessages = hasImages
    ? preparedMessages.map(function(m, i) {
        if (i === preparedMessages.length - 1 && m.role === 'user') {
          const imgBlocks = imageContentBlocks('openai_compat', attachments)
          return {
            role: 'user',
            content: imgBlocks.concat([{ type: 'text', text: m.content }])
          }
        }
        return m
      })
    : preparedMessages

  const allMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }].concat(finalMessages)
    : finalMessages

  const endpoint = config.serverUrl.replace(/\/$/, '') + '/chat/completions'

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model:    modelName,
      messages: allMessages,
      stream:   false
    })
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error('Local server error ' + response.status + ': ' + text)
  }

  const data = await response.json()
  if (data.error) throw new Error('Local API error: ' + data.error.message)
  return data.choices[0].message.content
}

// ─── MULTI-AGENT PIPELINE (local) ─────────────────────────────────────────────
// Same 3-stage pipeline as cloud version: reasoner → auditor → synthesizer.
// Each stage uses a different locally-configured model.

async function callLocalMultiAgent(messages, systemPrompt, config, attachments, onStep) {
  const origQuery = (messages[messages.length - 1] && messages[messages.length - 1].content) || ''
  const { models } = config

  onStep('reasoning')
  const reasonerOut = await callLocal(
    models.primary, messages,
    ['You are a precise analytical reasoner.', 'Analyze the query thoroughly and produce structured reasoning.',
     systemPrompt ? '\nContext:\n' + systemPrompt : ''].join('\n'),
    config, attachments
  )

  onStep('auditing')
  const auditMsgs = messages.concat([
    { role: 'assistant', content: reasonerOut },
    { role: 'user', content: 'AUDIT TASK: Critically review the above reasoning. Identify logical gaps, missing perspectives, unsupported claims, and areas needing deeper analysis.' }
  ])
  const auditorOut = await callLocal(
    models.auditor, auditMsgs,
    ['You are a critical auditor. Review reasoning for accuracy and completeness.',
     systemPrompt ? '\nContext:\n' + systemPrompt : ''].join('\n'),
    config, attachments
  )

  onStep('synthesizing')
  const synthContent = [
    '=== ORIGINAL QUERY ===', origQuery, '',
    '=== REASONER ANALYSIS ===', reasonerOut, '',
    '=== AUDIT REPORT ===', auditorOut, '',
    '=== SYNTHESIS TASK ===',
    'Produce one clear, comprehensive, accurate final answer integrating the best insights and addressing audit gaps.'
  ].join('\n')
  const imageAtts = (attachments || []).filter(function(a) { return a.isImage })
  return await callLocal(
    models.synthesizer,
    [{ role: 'user', content: synthContent }],
    ['You are a synthesizer. Combine reasoning and audit into the optimal final answer.',
     systemPrompt ? '\nContext:\n' + systemPrompt : ''].join('\n'),
    config, imageAtts
  )
}

// ─── DOMAIN CLASSIFIER ────────────────────────────────────────────────────────
async function classifyDomain(firstMessage, config, existingDomains) {
  existingDomains = existingDomains || []
  const domainSection = existingDomains.length > 0
    ? ['EXISTING DOMAINS (prefer these if topic matches):', existingDomains.join(', '), '',
       'Match semantically. Same project/topic = same domain. Only create new if nothing fits.'].join('\n')
    : 'No existing domains yet. Create a short snake_case domain label.'

  const prompt = [
    'You are a domain classifier for a personal long-term context storage system.',
    '', domainSection, '',
    "Classify the user's first message and return:",
    '1. domain  - existing domain if topic matches, else new snake_case label',
    '2. filename - descriptive snake_case, max 5 words, no date, no extension',
    '',
    'Return ONLY valid JSON. No markdown. No backticks. No explanation.',
    '{"domain":"medai","filename":"security_audit_analysis"}',
    '', "User's first message:", firstMessage
  ].join('\n')

  const result = await callLocal(config.models.primary, [{ role: 'user', content: prompt }], null, config, [])
  const clean  = result.replace(/```json|```/g, '').trim()
  // Extract JSON even if model adds surrounding text
  const match  = clean.match(/\{[^}]+\}/)
  return JSON.parse(match ? match[0] : clean)
}

// ─── IPC HANDLERS ─────────────────────────────────────────────────────────────
function registerIpcHandlers() {
  const config = loadConfig()
  initContextDir(config.contextDir)

  ipcMain.handle('load-config', function() { return loadConfig() })
  ipcMain.handle('save-config', function(_event, newConfig) {
    saveConfig(newConfig)
    return { success: true }
  })

  ipcMain.handle('classify-domain', async function(_event, firstMessage) {
    const cfg = loadConfig()
    const existingDomains = listDomains(cfg.contextDir)
    return await classifyDomain(firstMessage, cfg, existingDomains)
  })

  ipcMain.handle('create-session', function(_event, params) {
    const cfg = loadConfig()
    return createSessionFile(cfg.contextDir, params.domain, params.filename, params.model)
  })

  ipcMain.handle('write-turn', function(_event, params) {
    writeTurn(params.filePath, params.role, params.content)
    return { success: true }
  })

  ipcMain.handle('send-message', async function(_event, params) {
    const cfg = loadConfig()
    if (cfg.activeMode === 'multi') {
      return await callLocalMultiAgent(
        params.messages, params.systemContext, cfg, params.attachments || [],
        function(step) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('pipeline-step', step)
          }
        }
      )
    }
    return await callLocal(cfg.models.primary, params.messages, params.systemContext, cfg, params.attachments || [])
  })

  ipcMain.handle('list-domains', function() {
    const cfg = loadConfig()
    return listDomains(cfg.contextDir)
  })
  ipcMain.handle('list-sessions', function(_event, domain) {
    const cfg = loadConfig()
    return listSessions(cfg.contextDir, domain)
  })
  ipcMain.handle('read-session', function(_event, filePath) {
    return readSession(filePath)
  })

  ipcMain.handle('pick-files', async function() {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'Code', extensions: ['py','js','ts','jsx','tsx','r','go','java','c','cpp','h','cs','rb','php','swift','kt','rs','sh','sql'] },
        { name: 'Text', extensions: ['txt','md','csv','log','json','yaml','yml','html','css','xml'] },
        { name: 'Documents', extensions: ['pdf','docx'] },
        { name: 'Images', extensions: ['jpg','jpeg','png','webp','gif'] },
        { name: 'Archive', extensions: ['zip'] }
      ]
    })
    if (result.canceled || !result.filePaths.length) return []
    return result.filePaths
  })

  ipcMain.handle('read-attachment', async function(_event, filePath) {
    const name = basename(filePath)
    const ext  = extname(filePath).toLowerCase().replace('.', '')

    const TEXT_EXTS = new Set([
      'txt','md','csv','log','ini','toml','yaml','yml','json','html','css','xml',
      'py','js','ts','jsx','tsx','mjs','cjs',
      'r','go','java','c','cpp','h','hpp','cs','rb','php','swift','kt','rs',
      'sh','bash','zsh','bat','ps1','sql','env','gitignore','dockerfile','config','conf'
    ])
    const IMAGE_EXTS = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', gif:'image/gif' }

    if (TEXT_EXTS.has(ext)) {
      try { return { name: name, isImage: false, text: readFileSync(filePath, 'utf-8') } }
      catch (e) { return { name: name, isImage: false, text: '[Could not read file]' } }
    }
    if (ext === 'docx') {
      const result = await mammoth.extractRawText({ path: filePath })
      return { name: name, isImage: false, text: result.value || '[Empty document]' }
    }
    if (ext === 'pdf') {
      const parsed = await pdfParse(readFileSync(filePath))
      return { name: name, isImage: false, text: parsed.text || '[Scanned PDF - no text layer]' }
    }
    if (ext === 'zip') {
      const zip = new AdmZip(filePath)
      const parts = []
      zip.getEntries().forEach(function(entry) {
        if (entry.isDirectory) return
        const entryExt = extname(entry.entryName).toLowerCase().replace('.', '')
        if (TEXT_EXTS.has(entryExt)) {
          try { parts.push('--- ' + entry.entryName + ' ---\n' + entry.getData().toString('utf-8')) }
          catch (e) { parts.push('--- ' + entry.entryName + ' --- [could not read]') }
        } else {
          parts.push('--- ' + entry.entryName + ' --- [binary, skipped]')
        }
      })
      return { name: name, isImage: false, text: parts.join('\n\n') || '[Empty zip]' }
    }
    if (IMAGE_EXTS[ext]) {
      return { name: name, isImage: true, mimeType: IMAGE_EXTS[ext], data: readFileSync(filePath).toString('base64') }
    }
    try { return { name: name, isImage: false, text: readFileSync(filePath, 'utf-8') } }
    catch (e) { return { name: name, isImage: false, text: '[.' + ext + ' cannot be read as text]' } }
  })
}

// ─── APP LIFECYCLE ─────────────────────────────────────────────────────────────
app.whenReady().then(function() {
  registerIpcHandlers()
  createWindow()
  app.on('activate', function() {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
app.on('window-all-closed', function() {
  if (process.platform !== 'darwin') app.quit()
})