import { app, BrowserWindow, ipcMain, safeStorage, dialog } from 'electron'
import { join, basename, extname } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import {
  initContextDir,
  createSessionFile,
  writeTurn,
  listDomains,
  listSessions,
  readSession
} from './file-tools.js'
import mammoth from 'mammoth'
import pdfParse from 'pdf-parse'
import AdmZip from 'adm-zip'

// ─── PATHS ────────────────────────────────────────────────────────────────────
const CONFIG_PATH = join(app.getPath('userData'), 'config.json')

const DEFAULT_CONFIG = {
  contextDir: join(app.getPath('documents'), 'Engram', 'context'),
  activeModel: 'claude',
  apiKeys: { claude: '', openai: '', gemini: '' },
  models: {
    claude: { default: 'claude-sonnet-4-6' },
    openai: { default: 'gpt-5.5-2026-04-23', fallback: 'gpt-5.4-2026-03-05' },
    gemini: { default: 'gemini-flash-latest', pinned: 'gemini-3.5-flash' }
  }
}

// ─── SAFEKEY HELPERS ─────────────────────────────────────────────────────────
function encryptKey(plain) {
  if (!plain) return ''
  if (!safeStorage.isEncryptionAvailable()) return plain
  return safeStorage.encryptString(plain).toString('base64')
}

function decryptKey(stored) {
  if (!stored) return ''
  if (!safeStorage.isEncryptionAvailable()) return stored
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return ''
  }
}

// ─── CONFIG HELPERS ───────────────────────────────────────────────────────────
function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2))
    return DEFAULT_CONFIG
  }
  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  return {
    ...raw,
    apiKeys: {
      claude: decryptKey(raw.apiKeys?.claude || ''),
      openai: decryptKey(raw.apiKeys?.openai || ''),
      gemini: decryptKey(raw.apiKeys?.gemini || '')
    }
  }
}

function saveConfig(config) {
  const toWrite = {
    ...config,
    apiKeys: {
      claude: encryptKey(config.apiKeys?.claude || ''),
      openai: encryptKey(config.apiKeys?.openai || ''),
      gemini: encryptKey(config.apiKeys?.gemini || '')
    }
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(toWrite, null, 2))
}

// ─── WINDOW CREATION ─────────────────────────────────────────────────────────
let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 720,
    minHeight: 500,
    title: 'Engram',
    backgroundColor: '#1c1c1c',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
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
// Two shapes from read-attachment IPC handler:
//   Text  -> { name, isImage: false, text }
//   Image -> { name, isImage: true, mimeType, data }  (base64)
//
// Text files: all contents concatenated and prepended to last user message
// as a plain string. Every model receives identical text - no format conflicts.
//
// Images: base64 content blocks, model-specific format, for vision analysis.

function buildTextPrefix(attachments) {
  const textFiles = (attachments || []).filter(function(a) { return !a.isImage })
  if (!textFiles.length) return ''
  var blocks = textFiles.map(function(a) {
    return '=== File: ' + a.name + ' ===\n' + a.text + '\n=== End: ' + a.name + ' ==='
  })
  return blocks.join('\n\n') + '\n\n'
}

function imageContentBlocks(model, attachments) {
  return (attachments || [])
    .filter(function(a) { return a.isImage })
    .map(function(img) {
      if (model === 'claude') {
        return { type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } }
      }
      if (model === 'openai') {
        return { type: 'input_image', image_url: 'data:' + img.mimeType + ';base64,' + img.data }
      }
      if (model === 'gemini') {
        return { inline_data: { mime_type: img.mimeType, data: img.data } }
      }
    })
}

// ─── CLAUDE THINKING CONFIG ──────────────────────────────────────────────────
// Sonnet and Haiku use thinking.type = "enabled" with budget_tokens.
// Opus uses thinking.type = "adaptive" with output_config.effort instead.
// Spreading the result into the request body handles both cleanly.

function claudeThinkingConfig(modelName) {
  if (modelName && modelName.indexOf('opus') !== -1) {
    // Opus: adaptive thinking + effort level
    return {
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' }
    }
  }
  // Sonnet / Haiku: explicit budget_tokens
  return {
    thinking: { type: 'enabled', budget_tokens: 10000 }
  }
}

// ─── AI API CALLER ────────────────────────────────────────────────────────────
async function callAPI(messages, systemPrompt, config, attachments) {
  attachments = attachments || []
  const { activeModel, apiKeys, models } = config

  // Prepend all text file contents to last user message as plain string.
  const textPrefix = buildTextPrefix(attachments)
  const hasImages  = attachments.some(function(a) { return a.isImage })

  const preparedMessages = textPrefix
    ? messages.map(function(m, i) {
        if (i === messages.length - 1 && m.role === 'user') {
          return { role: m.role, content: textPrefix + m.content }
        }
        return m
      })
    : messages

  // ── Claude ────────────────────────────────────────────────────────────────
  if (activeModel === 'claude') {
    const claudeMessages = hasImages
      ? preparedMessages.map(function(m, i) {
          if (i === preparedMessages.length - 1 && m.role === 'user') {
            return {
              role: 'user',
              content: imageContentBlocks('claude', attachments).concat([
                { type: 'text', text: m.content }
              ])
            }
          }
          return m
        })
      : preparedMessages

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKeys.claude,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(Object.assign({
        model: models.claude.default,
        max_tokens: 16000,
        system: systemPrompt || '',
        messages: claudeMessages,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      }, claudeThinkingConfig(models.claude.default)))
    })
    const data = await response.json()
    if (data.error) throw new Error('Claude API error: ' + data.error.message)
    const textBlocks = data.content.filter(function(b) { return b.type === 'text' })
    return textBlocks.map(function(b) { return b.text }).join('\n')

  // ── OpenAI (Responses API) ────────────────────────────────────────────────
  } else if (activeModel === 'openai') {
    const inputMessages = preparedMessages.map(function(m, i) {
      if (hasImages && i === preparedMessages.length - 1 && m.role === 'user') {
        return {
          role: 'user',
          content: imageContentBlocks('openai', attachments).concat([
            { type: 'input_text', text: m.content }
          ])
        }
      }
      return { role: m.role, content: m.content }
    })

    const input = systemPrompt
      ? [{ role: 'system', content: systemPrompt }].concat(inputMessages)
      : inputMessages

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKeys.openai,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: models.openai.default,
        input: input,
        reasoning: { effort: 'high' },
        tools: [{ type: 'web_search_preview' }]
      })
    })
    const data = await response.json()
    if (data.error) throw new Error('OpenAI API error: ' + data.error.message)
    const messageItem = data.output && data.output.find(function(o) { return o.type === 'message' })
    const textItem = messageItem && messageItem.content && messageItem.content.find(function(c) { return c.type === 'output_text' })
    return (textItem && textItem.text) || ''

  // ── Gemini ────────────────────────────────────────────────────────────────
  } else if (activeModel === 'gemini') {
    const contents = preparedMessages.map(function(m, i) {
      const textPart = { text: m.content }
      if (hasImages && i === preparedMessages.length - 1 && m.role === 'user') {
        return { role: 'user', parts: imageContentBlocks('gemini', attachments).concat([textPart]) }
      }
      return { role: m.role === 'assistant' ? 'model' : 'user', parts: [textPart] }
    })

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + models.gemini.default + ':generateContent?key=' + apiKeys.gemini,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: contents,
          system_instruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
          generationConfig: { thinking_config: { thinking_budget: 8192 } },
          tools: [{ google_search: {} }]
        })
      }
    )
    const data = await response.json()
    if (data.error) throw new Error('Gemini API error: ' + data.error.message)
    return data.candidates[0].content.parts[0].text
  }

  throw new Error('Unknown model: ' + activeModel)
}

// ─── MULTI-AGENT PIPELINE ────────────────────────────────────────────────────
// Three-stage sequential workflow:
//   Stage 1 - Claude (Reasoner):    deep analysis of query + files
//   Stage 2 - GPT   (Auditor):      critical review of Claude's reasoning
//   Stage 3 - Gemini (Synthesizer): combines both into final answer for user
//
// callModel() reuses all callAPI logic (thinking, web search, attachments)
// by temporarily overriding config.activeModel. No duplication.

async function callModel(modelName, messages, systemPrompt, config, attachments) {
  const override = Object.assign({}, config, { activeModel: modelName })
  return await callAPI(messages, systemPrompt, override, attachments)
}

async function callMultiAgent(messages, systemPrompt, config, attachments, onStep) {
  var originalQuery = (messages[messages.length - 1] && messages[messages.length - 1].content) || ''

  // Stage 1: Claude as Reasoner
  onStep('reasoning')
  var REASONER_SYSTEM = [
    'You are a precise analytical reasoner in a multi-agent pipeline.',
    'Your role is to deeply analyze the query and produce comprehensive, structured reasoning.',
    'Cover all relevant aspects systematically. Be thorough and specific.',
    'Your output will be reviewed by an auditor and then synthesized into a final answer.',
    systemPrompt ? ('\nLong-term context:\n' + systemPrompt) : ''
  ].join('\n')
  var reasonerOutput = await callModel('claude', messages, REASONER_SYSTEM, config, attachments)

  // Stage 2: GPT as Auditor
  onStep('auditing')
  var auditorMessages = messages.concat([
    { role: 'assistant', content: reasonerOutput },
    { role: 'user', content: 'AUDIT TASK: Critically review the above reasoning. Identify: (1) logical gaps or errors, (2) missing perspectives, (3) unsupported claims, (4) areas needing deeper analysis. Be specific, constructive, and thorough.' }
  ])
  var AUDITOR_SYSTEM = [
    'You are a critical auditor in a multi-agent pipeline.',
    'You receive a reasoning analysis and must audit it rigorously.',
    'Evaluate accuracy, logical consistency, completeness, and quality.',
    'Your audit will be used by a synthesizer to produce the final answer.',
    systemPrompt ? ('\nOriginal context:\n' + systemPrompt) : ''
  ].join('\n')
  var auditorOutput = await callModel('openai', auditorMessages, AUDITOR_SYSTEM, config, attachments)

  // Stage 3: Gemini as Synthesizer
  onStep('synthesizing')
  var synthContent = [
    '=== ORIGINAL QUERY ===',
    originalQuery,
    '',
    '=== REASONER ANALYSIS (Claude) ===',
    reasonerOutput,
    '',
    '=== AUDIT REPORT (GPT) ===',
    auditorOutput,
    '',
    '=== SYNTHESIS TASK ===',
    'Using the reasoning and the audit, produce one clear, comprehensive, accurate final answer.',
    'Integrate the strongest insights, address audit gaps, and respond directly to the original query.'
  ].join('\n')
  var SYNTH_SYSTEM = [
    'You are a synthesizer in a multi-agent pipeline.',
    'Combine the reasoning and audit into the optimal final answer for the user.',
    'Integrate the best insights, resolve contradictions, respond clearly.',
    systemPrompt ? ('\nOriginal context:\n' + systemPrompt) : ''
  ].join('\n')
  var imageAttachments = (attachments || []).filter(function(a) { return a.isImage })
  return await callModel('gemini', [{ role: 'user', content: synthContent }], SYNTH_SYSTEM, config, imageAttachments)
}

// ─── DOMAIN CLASSIFIER ────────────────────────────────────────────────────────
// existingDomains is loaded by the IPC handler and passed in so the classifier
// can reuse matching domains instead of creating new ones every session.

async function classifyDomain(firstMessage, config, existingDomains) {
  existingDomains = existingDomains || []

  // Build the existing domain hint.
  // When domains exist, the classifier is instructed to match semantically
  // rather than create a new label. This keeps all MedAI queries under 'medai',
  // all programming queries under 'programming', etc. regardless of question wording.
  var domainSection
  if (existingDomains.length > 0) {
    domainSection = [
      'EXISTING DOMAINS (you MUST use one of these if the topic matches):',
      existingDomains.join(', '),
      '',
      'Domain selection rules:',
      '- Match semantically. A different question about the same project = same domain.',
      '- "Review my MedAI code" and "MedAI security audit" both belong in "medai".',
      '- "Code review of project X" belongs in "programming" if that domain exists.',
      '- Only invent a new snake_case domain if no existing domain fits at all.',
    ].join('\n')
  } else {
    domainSection = 'No existing domains yet. Create a short snake_case domain label.'
  }

  const prompt = [
    'You are a domain classifier for a personal long-term context storage system.',
    '',
    domainSection,
    '',
    'For the user\'s first message, return:',
    '1. domain  - existing domain if topic matches, else a new snake_case label',
    '2. filename - a descriptive snake_case name, max 5 words, no date, no extension',
    '',
    'Return ONLY valid JSON. No markdown. No backticks. No explanation.',
    '{"domain":"medai","filename":"security_audit_analysis"}',
    '',
    'User\'s first message:',
    firstMessage
  ].join('\n')

  // Multi is a pipeline mode not a real API - always use Claude for classification.
  const classifyConfig = config.activeModel === 'multi'
    ? Object.assign({}, config, { activeModel: 'claude' })
    : config

  const result = await callAPI(
    [{ role: 'user', content: prompt }],
    null,
    classifyConfig,
    []
  )
  const clean = result.replace(/```json|```/g, '').trim()
  return JSON.parse(clean)
}

// ─── IPC HANDLERS ────────────────────────────────────────────────────────────
function registerIpcHandlers() {
  const config = loadConfig()
  initContextDir(config.contextDir)

  // Config
  ipcMain.handle('load-config', function() {
    return loadConfig()
  })

  ipcMain.handle('save-config', function(_event, newConfig) {
    saveConfig(newConfig)
    return { success: true }
  })

  // Session lifecycle
  ipcMain.handle('classify-domain', async function(_event, firstMessage) {
    const cfg = loadConfig()
    // Load existing domains so classifier can reuse them instead of creating new ones.
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

  // AI message sender - routes to single model or multi-agent pipeline
  ipcMain.handle('send-message', async function(_event, params) {
    const cfg = loadConfig()

    if (cfg.activeModel === 'multi') {
      // Multi-agent pipeline: Claude -> GPT -> Gemini
      // onStep sends a step-update event to the renderer so the UI can
      // display which stage is currently running.
      return await callMultiAgent(
        params.messages,
        params.systemContext,
        cfg,
        params.attachments || [],
        function(step) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('pipeline-step', step)
          }
        }
      )
    }

    return await callAPI(params.messages, params.systemContext, cfg, params.attachments || [])
  })

  // Context browser
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

  // File picker - multiple selection
  ipcMain.handle('pick-files', async function() {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'Code', extensions: ['py','js','ts','jsx','tsx','mjs','r','go','java','c','cpp','h','cs','rb','php','swift','kt','rs','sh','bat','sql'] },
        { name: 'Text', extensions: ['txt','md','csv','log','json','yaml','yml','toml','ini','xml','html','css'] },
        { name: 'Documents', extensions: ['pdf','docx'] },
        { name: 'Images', extensions: ['jpg','jpeg','png','webp','gif','bmp'] },
        { name: 'Archive', extensions: ['zip'] }
      ]
    })
    if (result.canceled || !result.filePaths.length) return []
    return result.filePaths
  })

  // File reader - universal text extraction
  ipcMain.handle('read-attachment', async function(_event, filePath) {
    const name = basename(filePath)
    const ext  = extname(filePath).toLowerCase().replace('.', '')

    const TEXT_EXTS = new Set([
      'txt','md','csv','log','ini','toml','yaml','yml','json','html','css','xml',
      'py','js','ts','jsx','tsx','mjs','cjs',
      'r','go','java','c','cpp','h','hpp','cs','rb','php','swift','kt','rs','scala',
      'sh','bash','zsh','bat','ps1','cmd','sql','env','gitignore','dockerfile',
      'config','conf','properties','gradle','makefile','cmake','lock'
    ])

    const IMAGE_EXTS = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp'
    }

    // Code and plain text
    if (TEXT_EXTS.has(ext) || ext === '') {
      try {
        return { name: name, isImage: false, text: readFileSync(filePath, 'utf-8') }
      } catch (e) {
        return { name: name, isImage: false, text: '[Could not read file as text]' }
      }
    }

    // DOCX
    if (ext === 'docx') {
      const result = await mammoth.extractRawText({ path: filePath })
      return { name: name, isImage: false, text: result.value || '[Empty document]' }
    }

    // PDF
    if (ext === 'pdf') {
      const buffer = readFileSync(filePath)
      const parsed = await pdfParse(buffer)
      return { name: name, isImage: false, text: parsed.text || '[Scanned PDF - no extractable text]' }
    }

    // ZIP - extract and read each text file inside
    if (ext === 'zip') {
      const zip = new AdmZip(filePath)
      const parts = []
      zip.getEntries().forEach(function(entry) {
        if (entry.isDirectory) return
        const entryName = entry.entryName
        const entryExt  = extname(entryName).toLowerCase().replace('.', '')
        if (TEXT_EXTS.has(entryExt)) {
          try {
            parts.push('--- ' + entryName + ' ---\n' + entry.getData().toString('utf-8'))
          } catch (e) {
            parts.push('--- ' + entryName + ' --- [could not read]')
          }
        } else {
          parts.push('--- ' + entryName + ' --- [binary, skipped]')
        }
      })
      return { name: name, isImage: false, text: parts.join('\n\n') || '[Empty zip]' }
    }

    // Images - base64 for vision API
    if (IMAGE_EXTS[ext]) {
      const data = readFileSync(filePath).toString('base64')
      return { name: name, isImage: true, mimeType: IMAGE_EXTS[ext], data: data }
    }

    // Fallback - try utf-8
    try {
      return { name: name, isImage: false, text: readFileSync(filePath, 'utf-8') }
    } catch (e) {
      return { name: name, isImage: false, text: '[.' + ext + ' is a binary format and cannot be read as text]' }
    }
  })
}

// ─── APP LIFECYCLE ────────────────────────────────────────────────────────────
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