# Engram

> Long-term context storage for AI conversations - verbatim, domain-split, never summarized.

**The problem:** Claude, GPT, and Gemini all offer memory - but it works by summarizing your past conversations into a short notes block. The model decides what matters, paraphrases it, and discards the rest. The errors are silent: you never see what was dropped or how it was reworded until it affects an answer you needed to be right.

**The solution:** Engram stores every turn exactly as written - character for character - in plain `.txt` files on your own machine. No summarization. No paraphrasing. When you start a new session, recent history from all your domains is injected as the system prompt exactly as it was saved. What you said is what the model reads.

## Why Engram

Native memory in Claude, GPT, and Gemini is optimized for lightweight long-term retention - names, preferences, ongoing projects distilled into bullet points. That works well for general use. It breaks down on deep technical work where the reasoning trail matters as much as the conclusion: the exact error message from three sessions ago, the architectural decision you made and why, the specific line of code that was changed.

Engram is built for that case. Four concrete differences from native memory:

**Verbatim vs compressed.** Native memory paraphrases. Engram stores the raw exchange. A 500-line code review from last week is still a 500-line code review when it gets injected - not a three-sentence summary.

**Transparent.** Every session is a plain `.txt` file you can open in any text editor. You can see exactly what the model will read before it reads it. Native memory is a black box.

**Cross-provider.** The same session files are injected whether you are using Claude, GPT, Gemini, or a local model. Switching providers does not lose your context.

**Engram.** Sessions live on your machine. No vendor controls them, no policy change removes them, no account deletion wipes them.

**Two editions:**

| | [Engram Cloud](./engram-cloud) | [Engram Local](./engram-local) |
|---|---|---|
| **Models** | Claude, GPT, Gemini | Ollama, LM Studio, any local server |
| **Cost** | Pay per token | Free after hardware |
| **Internet** | Required for API calls | Only for model download |
| **API keys** | Required (OS-encrypted) | Not required |
| **Thinking** | Always-on per model | Not applicable |
| **Web search** | Built-in per model | Not included |

Both editions share the same verbatim `.txt` storage format - sessions are fully portable between them.

## Features

- **Verbatim session storage** - every turn saved character-for-character to `.txt`. No summarization, no paraphrasing, no information loss
- **Automatic domain classification** - first message determines the domain (`medai`, `job_search`, `programming`) and reuses existing domains on subsequent sessions about the same topic
- **Cross-domain context injection** - recent sessions from all domains are injected as the system prompt on every message, giving the AI full awareness of your past work
- **Multi-agent pipeline** - three-stage workflow where different models reason, audit, and synthesize into one final answer
- **File attachments** - read and analyze code, documents, PDFs, ZIP archives, and images
- **Token budget management** - automatic truncation prevents rate limit errors while preserving the most recent and relevant context

## How Context Injection Works

On every message, Engram:

1. Loads the most recent session from each of your domains (up to 6)
2. Takes only the tail of each session (~8,000 characters) - recent turns matter more than old ones
3. Caps total injected context at 60,000 characters for single models, 24,000 for multi-agent (3 API calls)
4. Injects the combined history as the system prompt before calling the API

The AI sees its own past work across all topics on every message - without you doing anything.

## Multi-Agent Pipeline

Both editions include a three-stage pipeline:

```
Your query + files
       ↓
  Reasoner - deep analytical reasoning
       ↓
  Auditor  - critical review: gaps, errors, missing perspectives
       ↓
  Synthesizer - unified final answer shown to you
```

Cloud: Claude (Reasoner) → GPT (Auditor) → Gemini (Synthesizer)
Local: three configurable local models

## Session Format

Sessions stored in `Documents/Engram/context/` (cloud) or `Documents/EngramLocal/context/` (local):

```
context/
├── medai/
│   ├── adversarial_council_architecture_2026-06-01.txt
│   └── security_audit_2026-06-02.txt
├── job_search/
│   └── linkedin_overhaul_2026-05-20.txt
└── programming/
    └── code_review_2026-06-01.txt
```

Each file is a verbatim transcript:

```
=== SESSION HEADER ===
Date     : 2026-06-01
Time     : 22:34:33
Model    : claude-sonnet-4-6
Domain   : medai
File     : adversarial_council_architecture_2026-06-01.txt
======================

[USER | 22:34:33]
<exact message>

[ASSISTANT | 22:34:47]
<exact response>
```

Plain text. Human-readable. Works in any text editor. No lock-in.

## Quick Start

```bash
# Cloud edition
cd engram-cloud && npm install && npm run dev

# Local edition (requires Ollama)
ollama pull llama3.2
cd engram-local && npm install && npm run dev
```

Full documentation:
- [engram-cloud/README.md](./engram-cloud/README.md)
- [engram-local/README.md](./engram-local/README.md)

## License

[MIT](./LICENSE) © 2026 Mohammad Hamza Piracha

## Author

**Mohammad Hamza Piracha** |
Data Scientist & Applied AI Engineer | 
[LinkedIn](https://www.linkedin.com/in/hamza-piracha) | hamzapiracha@live.com
