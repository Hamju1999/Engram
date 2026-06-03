# Engram · Cloud

**The problem:** Claude, GPT, and Gemini all offer memory - but it works by summarizing your past conversations into a short notes block. The model decides what matters, paraphrases it, and discards the rest. The errors are silent: you never see what was dropped or how it was reworded until it affects an answer you needed to be right.

**The solution:** Engram stores every turn exactly as written - character for character - in plain `.txt` files on your own machine. No summarization. No paraphrasing. When you start a new session, recent history from all your domains is injected as the system prompt exactly as it was saved. What you said is what the model reads.

## Features

- **Three AI providers** - Claude (Anthropic), GPT (OpenAI), Gemini (Google), switchable any time in Settings
- **Multi-agent pipeline** - Claude reasons deeply, GPT audits critically, Gemini synthesizes into one final answer
- **Verbatim long-term memory** - every turn stored character-for-character. No summarization, no information loss
- **Automatic domain classification** - first message determines the session domain and reuses existing domains intelligently on new sessions about the same topic
- **Cross-domain context injection** - recent history from all your domains injected as system prompt on every message
- **File attachments** - read and analyze code, documents, PDFs, ZIP archives, and images
- **Encrypted API keys** - stored using OS-level encryption (Windows DPAPI / macOS Keychain). Never plain text
- **Always-on thinking** - extended reasoning active on every response for all three models
- **Built-in web search** - each model uses its native search tool when it determines live information is needed
- **Token budget management** - automatic context truncation prevents rate limit errors
- **Collapsible sidebar** - responsive layout works on desktop and mobile screen sizes

## Prerequisites

- [Node.js](https://nodejs.org) 18 or higher
- API key from at least one provider:

| Provider | Get Key | Starts With |
|---|---|---|
| Claude | [console.anthropic.com](https://console.anthropic.com) → API Keys | `sk-ant-` |
| GPT | [platform.openai.com](https://platform.openai.com) → API Keys | `sk-` |
| Gemini | [aistudio.google.com](https://aistudio.google.com) → Get API Key | `AIza` |

## Installation

```bash
git clone https://github.com/Hamju1999/engram.git
cd engram/engram-cloud
npm install
npm run dev
```

On first launch, open **Settings** (bottom-left of sidebar), enter your API key, select your active model, and click Save. Your first message automatically classifies the domain and creates the session file.

## Configuration

Open **Settings** inside the app:

| Setting | Description |
|---|---|
| Active Model | Claude / GPT / Gemini / Multi-Agent |
| Anthropic API Key | For Claude. Encrypted on save |
| OpenAI API Key | For GPT. Encrypted on save |
| Gemini API Key | For Gemini. Encrypted on save |
| Context Directory | Where `.txt` session files are stored. Default: `Documents/Engram/context` |

**Switching models mid-project is safe.** All sessions from all models are stored in the same format and available in the sidebar regardless of which model is currently active.

**For large file analysis (500KB+):** switch to `claude-opus-4-5` in the runtime config at `AppData/Roaming/Engram/config.json`. Opus allows 500K input tokens/min vs Sonnet's 30K.

## Models

| Provider | Default | Thinking | Web Search | Token Limit/min |
|---|---|---|---|---|
| Claude Sonnet | `claude-sonnet-4-6` | `budget_tokens: 10000` | `web_search_20250305` | 30K |
| Claude Opus | `claude-opus-4-5` | `type: adaptive` | `web_search_20250305` | 500K |
| GPT | `gpt-5.5-2026-04-23` | `reasoning_effort: high` | Responses API | - |
| Gemini | `gemini-flash-latest` | `thinking_budget: 8192` | Google Search | - |

## Supported File Types

| Type | Files | Method |
|---|---|---|
| **Code** | `.py .js .ts .jsx .tsx .r .go .java .c .cpp .cs .rb .php .swift .kt .rs .sh .sql` | Read UTF-8 verbatim |
| **Text** | `.txt .md .csv .json .yaml .yml .html .css .xml .log .env` | Read UTF-8 verbatim |
| **Documents** | `.docx` | Text extracted via mammoth |
| **PDF** | `.pdf` | Text extracted via pdf-parse |
| **Archive** | `.zip` | Each text file inside extracted and concatenated |
| **Images** | `.jpg .jpeg .png .webp .gif` | Base64 vision API (all three models) |

Multiple files can be attached to a single message. All text content is injected directly into the message before the API call - no separate upload step, no model-specific format differences.

## Multi-Agent Pipeline

Select **Multi** in Settings to activate:

```
Your message + any attached files
            ↓
  Claude (Reasoner)
  System: "You are a precise analytical reasoner..."
  → deep structured analysis of your query
            ↓
  GPT (Auditor)
  Receives: original query + Claude's reasoning
  System: "You are a critical auditor..."
  → identifies gaps, errors, missing perspectives
            ↓
  Gemini (Synthesizer)
  Receives: original query + Claude's reasoning + GPT's audit
  System: "You are a synthesizer..."
  → unified final answer shown to you
```

The thinking indicator shows which stage is active. Total time is roughly 3× a single-model response.

## Building

```bash
npm run build    # compile to out/
npm run package  # package as installer
```

| Platform | Output |
|---|---|
| Windows | `dist/Engram Setup.exe` |
| macOS | `dist/Engram.dmg` |
| Linux | `dist/Engram.AppImage` |

## Project Structure

```
engram-cloud/
├── main/
│   ├── index.js          # Electron main: IPC handlers, AI API routing, file ops
│   └── file-tools.js     # File system operations (read/write/append/list)
├── preload/
│   └── index.js          # Secure IPC bridge (window.api)
├── renderer/
│   ├── index.html
│   └── src/
│       ├── App.jsx        # State orchestrator, send flow, context injection
│       ├── App.css        # Design system (CSS variables, copper-orange accent)
│       ├── platform.js   # Platform detection: Electron vs Capacitor mobile
│       └── components/
│           ├── ChatWindow.jsx    # Message display, input, file attachments
│           ├── Sidebar.jsx       # Domain and session browser, collapsible
│           ├── DomainBadge.jsx   # Active session indicator in header
│           ├── SavePulse.jsx     # Animated write indicator
│           └── Settings.jsx      # API keys, model selector
├── electron.vite.config.js
├── vite.mobile.config.js
├── capacitor.config.json
├── package.json
└── config.json
```

## Security

- API keys are **never stored in plain text**
- Encrypted using DPAPI on Windows (tied to your Windows login), Keychain on macOS
- The `config.json` in the project root contains **empty keys** - safe to commit
- Runtime config with encrypted keys lives in `AppData/Roaming/Engram/` - outside the project
- All API calls go directly from your machine to the provider - no intermediary server

## License

[MIT](../LICENSE) © 2026 Mohammad Hamza Piracha

## Author

**Mohammad Hamza Piracha** |
Data Scientist & Applied AI Engineer | 
[LinkedIn](https://www.linkedin.com/in/hamza-piracha) | hamzapiracha@live.com
