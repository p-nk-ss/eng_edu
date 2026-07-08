# Local Setup — English Trainer (Windows desktop)

The app runs **locally on the owner's Windows desktop** (Ryzen 5700X3D, RX 9070 XT 16GB) in a
hybrid setup:

- **Claude** (Agent SDK, Max subscription) — teaching-quality tasks (lesson generation,
  conversation analysis, writing/translation feedback, summaries).
- **Local LLM** (LM Studio, Qwen3-14B) — the real-time voice conversation partner.
- **Kokoro-82M** (FastAPI) — local streaming TTS.
- **PostgreSQL** — local database, run **portable inside the project** (no system service).

This guide covers the local pieces: Node.js, PostgreSQL, the Claude token, LM Studio, and Kokoro TTS.

---

## 0a. Node.js (prerequisite)

The app is Next.js 15 / npm, so **Node.js is required** before anything else. Install the current
**LTS** (≥ 20) for Windows from <https://nodejs.org> (or via `winget install OpenJS.NodeJS.LTS`).
Verify:

```powershell
node --version   # v20.x or newer
npm --version
```

---

## 0b. PostgreSQL (portable, inside the project)

The app stores everything in a **local PostgreSQL** — run **portable, inside the project**: no
system install, no Windows service, nothing written to `C:\`. The server binaries and the data
cluster live in the project folder (git-ignored) on your `D:` drive:

```
.pgsql/    # PostgreSQL binaries (~1 GB unpacked; downloaded once)
.pgdata/   # the data cluster — your tables physically live here
```

One-time setup (after `npm install`) — downloads the official PostgreSQL 17 binaries (~330 MB),
initializes the cluster, and creates the `english_trainer` database:

```powershell
npm run db:setup
```

Then put the connection string in `.env.local` (see the env table below) and create the tables:

```powershell
# .env.local:
#   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/english_trainer
npx prisma migrate dev --name init
```

Day-to-day: the DB starts automatically before `npm run dev` (via `predev`). You can also control it
manually:

```powershell
npm run db:start    # start (idempotent)
npm run db:stop     # stop
npm run db:status   # running / stopped
npm run db:psql     # open a psql shell on english_trainer
```

Notes:
- Local trust auth (no real password needed on `localhost`); the `postgres:postgres` in the URL is
  accepted as-is.
- Uses port **5432** by default; set `PGPORT` to override if it clashes with another Postgres.
- Backups are done with `pg_dump` (not by copying the project folder). To reset the DB entirely,
  stop it and delete `.pgdata/`, then `npm run db:setup` again.
- The mechanics live in `scripts/db.ps1`.

---

## 0. Claude Agent SDK token (one-time)

The Agent SDK authenticates with your subscription via `CLAUDE_CODE_OAUTH_TOKEN`. Generate it once:

```powershell
claude setup-token
```

Copy the printed token (`sk-ant-oat...`) into `.env.local` (see the env table below). If it is ever
revoked, re-run this command and update the value. **Do not set `ANTHROPIC_API_KEY`** — if present it
overrides subscription auth and bills pay-per-token.

---

## 1. LM Studio — local conversation LLM

The conversation partner runs on **LM Studio**'s OpenAI-compatible server.

### Install & load the model
1. Install **LM Studio** for Windows from <https://lmstudio.ai>.
2. In the **Discover/Search** tab, download **Qwen3-14B** as a quantized GGUF — recommended
   **`Q6_K` (~12 GB)** (near-FP16 quality). It fits the RX 9070 XT's **16 GB** whole, leaving
   ~3–3.5 GB for the KV-cache of the growing conversation.
   > A 30B model (`Qwen3-30B-A3B`) does **not** fit 16 GB at Q4 (~18 GB); 14B/Q6 is the practical
   > choice here. `Q4_K_M` (~9 GB) or an 8B model are lighter/faster alternatives if you want more
   > VRAM headroom.
3. Load the model with **all layers offloaded to GPU** (14B/Q6 fits whole) and set **Context
   Length to 8192** (up to 16384). Don't push context to 32k+: the 14B KV-cache is ~160 KB/token,
   so a large context spills out of 16 GB into CPU offload and blows the latency budget
   (see `SPEC.md` §Voice Stack). Optionally set **KV cache quantization → Q8_0** for more context
   at the same VRAM. On the **RX 9070 XT**, LM Studio uses a **Vulkan** runtime by default on
   Windows (see the ROCm/Vulkan note under Troubleshooting); enable **Flash Attention** if offered.

### Enable the server
1. Open the **Developer / Local Server** tab.
2. Set port **1234** and **enable the server** (it exposes `POST /v1/chat/completions`).
3. Confirm **streaming** is supported (it is, via `"stream": true`).

`LOCAL_LLM_URL` → `http://localhost:1234/v1`, `LOCAL_LLM_MODEL` → the model id shown in LM Studio
(e.g. `qwen3-14b`).

---

## 2. Kokoro TTS — local streaming speech

Use a ready-made **kokoro-fastapi** service (wraps Kokoro-82M with an HTTP + streaming API).

### Option A — Docker (recommended)
```powershell
# GPU image (see the kokoro-fastapi repo for the current tag)
docker run -d --name kokoro -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-gpu:latest
```
> On the RX 9070 XT, prefer the **CPU** image if the GPU image assumes CUDA/ROCm you don't have set
> up — Kokoro-82M is small and runs acceptably on the 5700X3D:
> ```powershell
> docker run -d --name kokoro -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
> ```

### Option B — pip / local Python
```powershell
git clone https://github.com/remsky/Kokoro-FastAPI
cd Kokoro-FastAPI
pip install -r requirements.txt
# starts an OpenAI-compatible /v1/audio/speech endpoint on :8880
python -m uvicorn api.src.main:app --host 0.0.0.0 --port 8880
```

`KOKORO_URL` → `http://localhost:8880`. The app requests streaming audio so playback starts before
generation finishes; if the service is unreachable at lesson start, the app falls back to browser
`speechSynthesis` silently (with a UI indicator).

---

## 2a. Speech-to-text — browser Web Speech (⚠ not local, needs internet)

STT uses Chrome's `webkitSpeechRecognition`, which **streams microphone audio to Google's servers**
— it is **not** local and **requires an internet connection**. This is the one part of the "local"
stack that leaves the machine. It is also **not** covered by the lesson-start health check (which
only probes LM Studio and Kokoro), so an offline machine will pass the health check but STT will
fail at capture time. A local **faster-whisper** service is the planned post-MVP replacement
(behind the same `lib/stt.ts` interface).

Use **Chrome** on the desktop for STT support.

---

## 3. Environment variables

Put these in `.env.local` at the project root:

| Key | Value | Notes |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | `sk-ant-oat...` | From `claude setup-token`. Subscription auth. |
| `ANTHROPIC_API_KEY` | *(unset)* | **Leave unset.** Only set (with `LLM_ROLE_*=api`) for the direct-API fallback. |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/english_trainer` | Local PostgreSQL (see §0b). |
| `LOCAL_LLM_URL` | `http://localhost:1234/v1` | LM Studio server. |
| `LOCAL_LLM_MODEL` | `qwen3-14b` | Model id as shown in LM Studio. |
| `KOKORO_URL` | `http://localhost:8880` | Kokoro TTS service. |
| `LLM_ROLE_<ROLE>` | `local` \| `agent` \| `api` | Optional per-role override (e.g. `LLM_ROLE_CONVERSATION=agent`). |

Start the app:
```powershell
npm run dev            # http://localhost:3000
# or, to reach it from a phone on the same Wi-Fi:
npm run build; npm run start -- -H 0.0.0.0
```

---

## 4. Smoke tests

**Claude (Agent SDK):**
```powershell
echo "OAuth set: $([string]::IsNullOrEmpty($env:CLAUDE_CODE_OAUTH_TOKEN) ? 'NO' : 'yes')"
echo "API key (should be empty): '$($env:ANTHROPIC_API_KEY)'"
```
Then trigger a Claude route, e.g. `curl -X POST http://localhost:3000/api/lesson/start` → a generated
lesson plan means the subscription path works.

**LM Studio (local LLM), streaming:**
```powershell
curl http://localhost:1234/v1/chat/completions `
  -H "Content-Type: application/json" `
  -d '{ "model": "qwen3-14b", "stream": true, "messages": [{"role":"user","content":"Say hi in one short sentence."}] }'
```
Expect a stream of `data:` chunks ending in `[DONE]`.

**Kokoro TTS:**
```powershell
curl http://localhost:8880/v1/audio/speech `
  -H "Content-Type: application/json" `
  -d '{ "model": "kokoro", "input": "Hello, this is a test.", "voice": "af_sky", "response_format": "mp3" }' `
  --output test.mp3
```
A playable `test.mp3` means TTS is up. (The app also health-checks `KOKORO_URL` on lesson start.)

---

## 5. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Conversation section blocked with "local LLM unavailable" | LM Studio server off / model not loaded | Load the model, enable the server on :1234; re-check `LOCAL_LLM_URL` |
| Tutor voice is robotic / no streaming | Kokoro unreachable → browser fallback | Start Kokoro on :8880; the UI indicator shows which engine is active |
| Claude calls billed pay-per-token | `ANTHROPIC_API_KEY` is set | Unset it (unless intentionally using a `*=api` role override) |
| `claude: not found` | Claude Code CLI not installed | Install Claude Code and re-run `claude setup-token` |
| LM Studio slow / low GPU use (RX 9070 XT) | **Runtime backend.** On Windows the default is **Vulkan**, which works on RDNA4. **ROCm** on Windows for the 9070 XT is still maturing — if a ROCm runtime is offered but unstable, switch LM Studio back to the **Vulkan** runtime (Settings → Runtime) and raise GPU layer offload. | Prefer Vulkan on Windows for now; revisit ROCm as driver/runtime support lands |
| Kokoro GPU image crashes on start | Image expects CUDA/ROCm not configured | Use the **CPU** Kokoro image (Kokoro-82M is small enough) |
| Phone can't reach the app | Bound to localhost only / firewall | Start with `-H 0.0.0.0`; allow the port through Windows Firewall on the private network |
