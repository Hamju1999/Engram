import {
  existsSync,
  mkdirSync,
  appendFileSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync
} from 'fs'
import { join, basename } from 'path'

// ─── TIMESTAMP HELPERS ────────────────────────────────────────────────────────
// Two formats used throughout:
//   dateStamp  → YYYY-MM-DD  used in filenames
//   timeStamp  → HH:MM:SS   used inside txt files per turn
// Both derived from a single Date object to guarantee consistency.

function dateStamp(date = new Date()) {
  // toISOString() = '2026-06-01T14:32:01.000Z'
  // .slice(0, 10)  = '2026-06-01'
  return date.toISOString().slice(0, 10)
}

function timeStamp(date = new Date()) {
  // padStart(2, '0') ensures single-digit hours/minutes/seconds get a leading zero.
  // Without it: 9:5:3 instead of 09:05:03.
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  return `${h}:${m}:${s}`
}

// ─── INIT CONTEXT DIRECTORY ───────────────────────────────────────────────────
// Called once on every app launch before any file operation runs.
// Creates the root context directory if it doesn't exist yet.
// recursive: true means it creates all missing parent directories too.
// If the directory already exists, mkdirSync with recursive does nothing - safe
// to call every launch without checking first.

export function initContextDir(contextDir) {
  mkdirSync(contextDir, { recursive: true })
}

// ─── CREATE SESSION FILE ──────────────────────────────────────────────────────
// Called once per session, immediately after domain classification.
// Responsibilities:
//   1. Create the domain subfolder if it doesn't exist
//   2. Build a unique filename (handles same-day collisions)
//   3. Write the session header block to the new file
//   4. Return the full absolute file path (used by writeTurn for the rest of the session)
//
// Parameters:
//   contextDir → root context folder path
//   domain     → e.g. 'medai', 'job_search'
//   filename   → e.g. 'adversarial_council_architecture' (no date, no extension)
//   model      → active model string e.g. 'claude-sonnet-4-6'

export function createSessionFile(contextDir, domain, filename, model) {
  // ── Step 1: ensure domain folder exists ───────────────────────────────────
  const domainPath = join(contextDir, domain)
  mkdirSync(domainPath, { recursive: true })

  // ── Step 2: build unique file path ────────────────────────────────────────
  // Base name: filename_YYYY-MM-DD.txt
  // If that already exists (two sessions same day, same topic),
  // append a counter: filename_YYYY-MM-DD_2.txt, _3.txt, etc.
  const today = dateStamp()
  let filePath = join(domainPath, `${filename}_${today}.txt`)
  let counter = 2

  while (existsSync(filePath)) {
    // existsSync = synchronous check. Fine here - this runs once per session,
    // not in a hot loop.
    filePath = join(domainPath, `${filename}_${today}_${counter}.txt`)
    counter++
  }

  // ── Step 3: write session header ──────────────────────────────────────────
  // Header is written with writeFileSync (creates the file from scratch).
  // Every subsequent write uses appendFileSync to add to it.
  // The separator line uses = characters for visual clarity when reading raw txt.
  const header = [
    '=== SESSION HEADER ===',
    `Date     : ${today}`,
    `Time     : ${timeStamp()}`,
    `Model    : ${model}`,
    `Domain   : ${domain}`,
    `File     : ${basename(filePath)}`,
    '======================',
    '',
    // Blank line after header so the first turn has breathing room
  ].join('\n')

  writeFileSync(filePath, header, 'utf-8')
  // writeFileSync with 'utf-8' encoding writes a proper UTF-8 text file.
  // Handles any character - Urdu, Arabic, emoji, code, whatever the user types.

  return filePath
  // Returned to main/index.js → sent back to renderer via IPC.
  // Renderer stores it and passes it with every write-turn call for this session.
}

// ─── WRITE TURN ───────────────────────────────────────────────────────────────
// THE HOT PATH. Called twice per exchange - once for user, once for assistant.
// Timing is everything: this runs BEFORE the response renders in the UI.
// By the time the model sees N turns, all N turns are already on disk.
//
// Format produced:
//   [USER | 14:32:01]
//   <verbatim content>
//
//   [ASSISTANT | 14:32:15]
//   <verbatim content>
//
// Parameters:
//   filePath → absolute path to the active session txt file
//   role     → 'user' or 'assistant'
//   content  → exact message string, no modification

export function writeTurn(filePath, role, content) {
  const label = role === 'user' ? 'USER' : 'ASSISTANT'
  const time = timeStamp()

  // Two newlines after content creates a blank line between turns.
  // Makes the txt human-readable without any tooling.
  const formatted = `[${label} | ${time}]\n${content}\n\n`

  appendFileSync(filePath, formatted, 'utf-8')
  // appendFileSync = synchronous append to end of file.
  // BLOCKS until OS confirms write. No callback. No promise.
  // If the process crashes after this line returns, the turn is on disk.
  // If it crashes before, the turn is not - but it also wasn't rendered yet,
  // so there is no data loss from the user's perspective.
}

// ─── LIST DOMAINS ─────────────────────────────────────────────────────────────
// Returns an array of domain folder names within the context directory.
// Used by the sidebar to populate the domain list on startup.
// Filters out any non-directory items (e.g. stray files at root level).
//
// Returns [] if contextDir doesn't exist yet (first launch before any session).

export function listDomains(contextDir) {
  if (!existsSync(contextDir)) return []

  return readdirSync(contextDir, { withFileTypes: true })
    // withFileTypes: true returns Dirent objects instead of plain strings.
    // Dirent has .isDirectory() method - lets us filter without a second stat call.
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
    // Alphabetical sort. Consistent ordering regardless of creation sequence.
}

// ─── LIST SESSIONS ────────────────────────────────────────────────────────────
// Returns an array of session objects within a domain, sorted newest first.
// Used to populate the session list when a user clicks a domain in the sidebar.
//
// Each object:
//   { name: 'adversarial_council_architecture_2026-06-01.txt',
//     path: '/full/absolute/path/to/file.txt',
//     modified: Date }
//
// Returns [] if the domain folder doesn't exist.

export function listSessions(contextDir, domain) {
  const domainPath = join(contextDir, domain)
  if (!existsSync(domainPath)) return []

  return readdirSync(domainPath)
    // readdirSync without withFileTypes returns plain filename strings.
    .filter(name => name.endsWith('.txt'))
    // Only txt files. Ignore any hidden files, .DS_Store, etc.
    .map(name => {
      const fullPath = join(domainPath, name)
      const stats = statSync(fullPath)
      // statSync returns file metadata. We use mtime (modified time) for sorting.
      return {
        name,
        path: fullPath,
        modified: stats.mtime
      }
    })
    .sort((a, b) => b.modified - a.modified)
    // Sort descending by modified time = newest session first.
    // Subtracting Date objects gives millisecond difference.
    // Negative = a is older than b = b comes first.
}

// ─── READ SESSION ─────────────────────────────────────────────────────────────
// Returns the full verbatim content of a session txt file as a string.
// Two use cases:
//   1. Loading a past session into the chat window for review
//   2. Injecting prior context as system prompt for the active session
//      (the entire txt file becomes the AI's background knowledge)
//
// No transformation. No parsing. Raw string returned exactly as stored.
// This is the guarantee: what went in comes out identical.

export function readSession(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Session file not found: ${filePath}`)
    // Explicit error is better than returning empty string.
    // Caller knows something is wrong vs silently getting blank context.
  }
  return readFileSync(filePath, 'utf-8')
}
