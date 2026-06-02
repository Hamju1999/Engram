# Engram · Local

Long-term context storage for local AI models. Same verbatim `.txt` storage and multi-agent pipeline as Engram Cloud — fully offline, zero cost, no API keys required.

Compatible with **Ollama**, **LM Studio**, and any server exposing an OpenAI-compatible `/v1/chat/completions` endpoint.

---

## Features

- **Any local model server** — Ollama, LM Studio, llama.cpp, or any `/v1/chat/completions` endpoint
- **Three configurable model slots** — assign different locally-installed models to Primary, Auditor, and Synthesizer roles
- **Multi-agent pipeline** — same three-stage Reasoner → Auditor → Synthesizer workflow as the cloud edition, running entirely on your hardware
- **Verbatim long-term memory** — every turn stored character-for-character to `.txt`. Same format as Engram Cloud — sessions are portable between editions
- **Automatic domain classification** — first message determines the domain, reuses existing domains on subsequent related sessions
- **Cross-domain context injection** — recent history from all domains injected as system prompt on every message
- **File attachments** — read and analyze code, documents, PDFs, ZIP archives, and images
- **Fully offline** — once models are downloaded, no internet required for inference
- **Zero cost** — no API billing, no token limits, no rate limits imposed by the app

---

## Prerequisites

- [Node.js](https://nodejs.org) 18 or higher
- A local model server (choose one):

### Ollama (recommended)

Install from [ollama.com](https://ollama.com). Starts automatically with Windows.

```bash
# Pull models (one-time, ~4-8GB each):
ollama pull llama3.2       # primary/reasoner
ollama pull mistral        # auditor
ollama pull gemma2         # synthesizer

# Verify a model works:
ollama run llama3.2
# Type anything, press Enter. Type /bye to exit.
```

Ollama runs on `http://localhost:11434/v1` — select the **Ollama** preset in Settings.

### LM Studio

Download from [lmstudio.ai](https://lmstudio.ai). Download any model through its UI, then click **Local Server** in the left sidebar and press Start.

Runs on `http://localhost:1234/v1` — select the **LM Studio** preset in Settings.

---

## Installation

```bash
git clone https://github.com/Hamju1999/engram.git
cd engram/engram-local
npm install
npm run dev
```

Open **Settings** (bottom-left), select your server, enter model name(s), click Save.

---

## Configuration

| Setting | Description |
|---|---|
| **Server** | Ollama / LM Studio / Custom URL |
| **Mode** | Single Model — one model for everything. Multi-Agent — three models in pipeline |
| **Primary** | Model used for all queries in Single mode, and as Reasoner in Multi-Agent |
| **Auditor** | Critical review model (Multi-Agent only) |
| **Synthesizer** | Final answer model (Multi-Agent only) |
| **Context Directory** | Where `.txt` files are stored. Default: `Documents/EngramLocal/context` |

**Model names** must match exactly what the server expects:
- Ollama: `llama3.2`, `mistral`, `gemma2`, `deepseek-r1:8b`
- LM Studio: the model identifier shown in the LM Studio UI

---

## Recommended Model Combinations

| Use Case | Primary / Reasoner | Auditor | Synthesizer |
|---|---|---|---|
| **General purpose** | `llama3.2` | `mistral` | `gemma2` |
| **Code and technical** | `qwen2.5:14b` | `deepseek-r1:8b` | `llama3.2` |
| **Fast (8GB VRAM)** | `llama3.2:3b` | `phi4-mini` | `gemma2:2b` |
| **Maximum quality** | `qwen2.5:72b` | `llama3.3:70b` | `mistral-large` |
| **Coding specialist** | `codestral` | `qwen2.5:14b` | `llama3.2` |
| **Research & analysis** | `deepseek-r1:32b` | `qwen2.5:72b` | `mistral-large` |

**Single model recommendations:**
- `llama3.2` — best balance of speed and quality for most tasks
- `qwen2.5:14b` — strong at code, math, and structured reasoning
- `deepseek-r1:8b` — deep reasoning on 8GB VRAM
- `mistral` — fast, sharp, concise

---

## Supported File Types

| Type | Files | Method |
|---|---|---|
| **Code** | `.py .js .ts .jsx .tsx .r .go .java .c .cpp .cs .rb .php .swift .kt .rs .sh .sql` | Read UTF-8 verbatim |
| **Text** | `.txt .md .csv .json .yaml .yml .html .css .xml .log .env` | Read UTF-8 verbatim |
| **Documents** | `.docx` | Text extracted via mammoth |
| **PDF** | `.pdf` | Text extracted via pdf-parse |
| **Archive** | `.zip` | Each text file inside extracted and concatenated |
| **Images** | `.jpg .jpeg .png .webp .gif` | Base64 (works if your model supports vision, e.g. LLaVA, BakLLaVA) |

All text content is injected directly into the message before the API call. Local models that support vision receive images as base64 content; those that don't will ignore the image block.

---

## Multi-Agent Pipeline

Select **Multi-Agent** in Settings and assign three model names:

```
Your message + any attached files
            ↓
  Primary model (Reasoner)
  "You are a precise analytical reasoner..."
  → deep structured analysis
            ↓
  Auditor model
  Receives: original query + Reasoner's output
  "You are a critical auditor..."
  → identifies gaps, errors, missing perspectives
            ↓
  Synthesizer model
  Receives: original query + Reasoner + Auditor outputs
  "You are a synthesizer..."
  → unified final answer shown to you
```

Runs entirely on your hardware. No internet, no API calls, no cost per query. Total time depends on your GPU — typically 2-5× a single-model response.

---

## Building

```bash
npm run build    # compile to out/
npm run package  # package as installer
```

| Platform | Output |
|---|---|
| Windows | `dist/Engram Local Setup.exe` |
| macOS | `dist/Engram Local.dmg` |
| Linux | `dist/Engram Local.AppImage` |

---

## Differences from Cloud Edition

| Feature | Engram Cloud | Engram Local |
|---|---|---|
| **Models** | Claude / GPT / Gemini | Any Ollama/LM Studio model |
| **API keys** | Required (OS-encrypted) | Not required |
| **Cost** | Pay per API token | Free after hardware |
| **Internet** | Required for inference | Not required after download |
| **Thinking** | Extended thinking per model | Depends on model capability |
| **Web search** | Built-in per provider | Not included |
| **Multi-agent** | Claude → GPT → Gemini | Three configurable local models |
| **Rate limits** | Provider-imposed | None |
| **Response speed** | Fast (cloud compute) | Depends on local GPU/CPU |
| **Privacy** | Queries leave your device | Queries stay on device |
| **Accent color** | Copper-orange | Teal-green |
| **Context dir** | `Documents/Engram/context` | `Documents/EngramLocal/context` |
| **Session format** | Identical `.txt` verbatim | Identical `.txt` verbatim |

**Everything else is identical:** domain classification, cross-domain context injection, file attachments, sidebar, session management, multi-agent pipeline structure, token budget management.

---

## Project Structure

```
engram-local/
├── main/
│   ├── index.js          # Electron main: IPC handlers, Ollama-compatible API, file ops
│   └── file-tools.js     # File system operations
├── preload/
│   └── index.js          # Secure IPC bridge
├── renderer/
│   ├── index.html
│   └── src/
│       ├── App.jsx
│       ├── App.css        # Teal-green accent (distinct from cloud edition)
│       ├── platform.js   # Desktop-only platform shim
│       └── components/
│           ├── Settings.jsx   # Server URL, mode, model name inputs
│           └── ...
├── electron.vite.config.js
├── package.json
└── config.json
```

---

## License

[MIT](../LICENSE) © 2026 Mohammad Hamza Piracha
