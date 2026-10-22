# SalesCoach AI

> Nhân viên sale bất động sản thiếu cơ hội luyện hội thoại 1-1 dẫn đến phản xạ kém khi ở thực địa, quản lý sale không có đủ thời gian để đào tạo 1-1 cho thành viên trong đội nhóm, vì vậy giải pháp SalesCoach AI ra đời cho phép sale luyện bằng giọng nói với khách hàng AI, nhận phản hồi liên tục theo scorecard và được đề xuất lộ trình luyện tập.

## Vấn đề (Problem)

Mô tả pain point cụ thể với data/số liệu:
- Sale bất động sản, đặc biệt là người mới, thường học xử lý tình huống qua đồng nghiệp, quản lý hoặc khi gặp khách thật. Quản lý sale khó dành đủ thời gian role-play, phản hồi riêng cho từng người. Vì vậy, sale thiếu một vòng lặp luyện tập → phản hồi → cải thiện đủ thường xuyên và nhất quán.
- Theo số liệu thu được từ phỏng vấn thực tế người dùng là sale và quản lý sale bất động sản, sale mới tuyển dụng cần thời gian tối thiểu **3-6 tháng** để có thể tự thực hiện một buổi tư vấn khách hàng đạt chuẩn, trong khi nếu sau 2-3 tháng không có giao dịch, họ sẽ bị đào thải. Hơn nữa, với một doanh nghiệp có đội ngũ sale lên đến hàng trăm hàng nghìn người thì khoảng thời gian sale chưa bắt nhịp được với công việc chính là chi phí, bao gồm chi phí đào tạo và chi phí cơ hội trong thời gian sale chưa tạo ra doanh số.
- Các giải pháp hiện tại đa số sử dụng các phiên đào tạo "generic", một trainer đào tạo một nhóm lớn các sale, không đạt được hiệu quả như các cuộc đào tạo 1-1.

## Giải pháp (Solution)

Sản phẩm giải quyết vấn đề như thế nào bằng AI:
- Luyện hội thoại bằng giọng nói: AI đóng vai khách hàng bất động sản theo kịch bản, persona, mức độ khó và phản đối khác nhau. Sau phiên luyện, AI nhận xét kỹ năng khai thác nhu cầu, xử lý phản đối và chốt bước tiếp theo; phản hồi gắn với các lượt hội thoại cụ thể.
- Cho phép người dùng, đặc biệt các doanh nghiệp, tự tạo các bài luyện tập phù hợp với nhu cầu đặc thù của mình, kể cả nhập từ file Excel.
- Theo dõi tiến bộ: lưu lịch sử phiên luyện, điểm theo từng kỹ năng và gợi ý bài luyện tiếp theo dựa trên hồ sơ năng lực.
- Workspace cho đội nhóm: quản lý thành viên, bài luyện riêng và hiệu suất của cả nhóm.
- Gói dịch vụ Free, Pro và Business (theo số ghế), mua thêm phút luyện qua SePay.

## Target User

- Primary: Nhân viên sale bất động sản, nhất là sale mới, sale cần đào tạo lại hoặc người muốn luyện một tình huống cụ thể trước khi gặp khách.
- Secondary: Sales manager và trainer cần đào tạo đội nhóm quy mô lớn một cách nhanh chóng và hiệu quả.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| AI Agent | OpenAI-compatible LLM API through OpenRouter by default for voice and practice evaluation |
| Backend | FastAPI + Uvicorn + Pydantic; Python 3.11 or above (Docker and CI use 3.11) |
| Live Voice Agent | Pipecat + WebRTC; Pipecat browser SDK |
| Speech-to-Text | Soniox (default) or AssemblyAI |
| Text-to-Speech | Soniox, Gemini, or ElevenLabs |
| Frontend | TypeScript + React 19 + TanStack Start/Router/Query + Tailwind CSS 4 + shadcn/ui |
| Frontend Server & Build | Node.js + Nitro + Vite + pnpm |
| Authentication | Better Auth with Drizzle adapter |
| Database | PostgreSQL + Drizzle ORM (`node-postgres`) |
| Billing | SePay checkout (optional) |
| Observability | OpenTelemetry tracing to Langfuse (optional, personal identifiers masked) |
| DevOps | Docker + Docker Compose; GitHub Actions: backend Ruff and pytest, frontend ESLint, Prettier, type-check, tests and build |

## Quick Start

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) before running the commands below.

### macOS / Linux (Bash or Zsh)

```bash
# 1. Clone repo
git clone <Link-github>

# 2. Setup environment
cp .env.example .env
# Edit .env with your API keys

# 3. Create a virtual environment and install dependencies
uv venv --python 3.11
uv pip install -r requirements-dev.txt

# 4. Run development server
uv run --env-file .env uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

### Windows (PowerShell)

After cloning the repo and opening its root directory:

```powershell
# Setup environment, then edit .env with your API keys
Copy-Item .env.example .env

# Create a virtual environment and install dependencies
uv venv --python 3.11
uv pip install -r requirements-dev.txt

# Run development server
uv run --env-file .env uvicorn src.main:app --reload --port 8000
```

### Windows (Command Prompt / CMD)

After cloning the repo and opening its root directory:

```bat
REM Setup environment, then edit .env with your API keys
copy .env.example .env

REM Create a virtual environment and install dependencies
uv venv --python 3.11
uv pip install -r requirements-dev.txt

REM Run development server
uv run --env-file .env uvicorn src.main:app --reload --port 8000
```

Run these commands from the repository root. Existing process environment
variables take precedence over `.env`.

### Frontend setup

Follow the [frontend README](frontend/README.md) to install and run the web app, configure PostgreSQL, and seed the initial practice data.

## Docker deployment

`docker-compose.yml` runs the voice backend and the web app on one Linux
server, behind an HTTPS reverse proxy (Nginx or Caddy) on the same server. Both
containers use host networking: call audio (WebRTC over UDP) reaches the backend
directly, and the two services call each other on `127.0.0.1`. Host networking
needs a Linux host or OrbStack; Docker Desktop must have it turned on in its
settings.

| Service | Listens on | Started by |
|---------|-----------|------------|
| `backend` | `127.0.0.1:8000` | `docker compose up` |
| `frontend` | `127.0.0.1:4500` | `docker compose up` |
| `postgres` | `127.0.0.1:5432` | `--profile db` (optional) |
| `billing-sweep` | — | `--profile billing` (optional) |

### Prerequisites

- Docker Engine with Compose v2.20 or later.
- An HTTPS reverse proxy: the web app's domain to `127.0.0.1:4500`, and the
  `VOICE_BACKEND_PUBLIC_URL` host to `127.0.0.1:8000`. Browsers only allow the
  microphone over HTTPS.
- The inbound ports in [Firewall ports](#firewall-ports), including the UDP range
  for call audio.

### 1. Configure the environment

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env
```

Fill in the required values in both files; each section is marked required or
optional. Values that must match across the two files:

| Backend `.env` | Frontend `frontend/.env` |
|----------------|--------------------------|
| `WEB_APP_ORIGIN` = the web app's public HTTPS origin | `BETTER_AUTH_URL` = the same origin |
| `VOICE_CONTROL_API_KEY`, `VOICE_TOKEN_SECRET`, `VOICE_EVENT_INGEST_KEY` | the same 3 values |
| `VOICE_EVENT_INGEST_URL=http://127.0.0.1:4500/api/internal/voice/events` | `VOICE_BACKEND_INTERNAL_URL=http://127.0.0.1:8000` |
| `CORS_ORIGINS` includes the public origin | `VOICE_BACKEND_PUBLIC_URL` = the backend's public HTTPS URL |

Compose sets the listen addresses itself, so `APP_HOST`/`APP_PORT` in `.env` are
ignored inside Docker. Write a literal `$` in a value as `$$`.

### 2. Choose a database

- **External PostgreSQL** (Neon, managed or self-hosted): set `DATABASE_URL` in
  `frontend/.env` (option A in the file).
- **PostgreSQL in Docker**: follow option B in `frontend/.env`, then add
  `--profile db` to every `docker compose` command. Its data lives in the
  `pgdata` volume, which is not backed up; schedule
  `docker compose exec -T postgres pg_dump -U postgres postgres > backup.sql`
  yourself. `POSTGRES_PASSWORD` only applies when the volume is first created.

Schema changes and seeding stay manual. Run them from `frontend/` on a machine
with Node.js and pnpm that can reach the database (on the server itself for the
Docker database, which only listens on `127.0.0.1`):

```bash
pnpm install --frozen-lockfile
pnpm db:push
pnpm db:seed-practices
```

Seed only once, on a new database.

### 3. Build and start

```bash
docker compose up -d --build
```

Add `--profile db` for the Docker database and `--profile billing` to expire
unpaid orders once a minute (needs `BILLING_SWEEP_SECRET`). To keep a profile on
without the flag, set `COMPOSE_PROFILES=db,billing` in the server's shell.

### 4. Check it

```bash
docker compose ps
curl http://127.0.0.1:8000/health/ready
curl -I http://127.0.0.1:4500/login
```

Both services should report `healthy`. Then sign in through the public URL and
complete a practice call end to end: two-way audio, the saved transcript, and
the evaluation.

### Operating it

| Task | Command |
|------|---------|
| Follow logs | `docker compose logs -f backend` (or `frontend`) |
| Deploy a new version | `git pull`, then `docker compose up -d --build` |
| Apply `.env` changes | `docker compose up -d` (`restart` keeps the old values) |
| Stop everything | `docker compose down` (add the same `--profile` flags) |

Restarting the backend drops live calls; it waits up to 60 seconds for them to
close, so deploy when no session is active. Keep one backend container: the
session registry lives in its memory. Container logs are lost when a container
is recreated.

## Project Structure

~~~text
.
├── frontend/                   # TanStack Start web application
│   ├── src/
│   │   ├── components/         # Reusable interface components
│   │   ├── db/                 # PostgreSQL schema and Drizzle client
│   │   ├── hooks/              # React hooks
│   │   ├── integrations/       # Authentication and TanStack Query setup
│   │   ├── lib/                # Application and server logic
│   │   ├── routes/             # Pages and API routes
│   │   ├── env.ts              # Environment variable validation
│   │   ├── router.tsx          # Router setup
│   │   └── styles.css          # Global styles
│   ├── public/                 # Images, icons, and web manifest
│   ├── scripts/                # Database seed and maintenance scripts
│   ├── .env.example            # Web application environment template
│   ├── Dockerfile              # Web application container
│   ├── drizzle.config.ts       # Database tooling configuration
│   ├── package.json            # Dependencies and commands
│   └── vite.config.ts          # Build and development configuration
├── src/                        # Python voice backend
│   ├── salescoach_voice/       # Voice API, sessions, pipeline, and providers
│   ├── config.py               # Host application settings
│   └── main.py                 # FastAPI entry point
├── tests/                      # Python backend tests
├── eval/                       # Buyer evaluation data, runner, and reports
├── .env.example                # Voice backend environment template
├── Dockerfile                  # Voice backend container
├── docker-compose.yml          # Full-stack Docker services
├── requirements.txt            # Python runtime dependencies
├── requirements-dev.txt        # Python development dependencies
├── Makefile                    # Development commands
├── ARCHITECTURE.md             # System architecture
└── README.md                   # Setup and deployment guide
~~~

### Voice agent API

The SalesCoach AI voice endpoints are served from the `src.main:app` process.
The `.env.example` file lists the required voice provider keys and service secrets.
Use Python 3.11 or above for the voice provider packages.

`VOICE_INPUT_PROFILE` selects voice transcription and turn detection:

| Profile | Transcription | Turn endings |
|---------|---------------|--------------|
| `soniox_native` (default) | Soniox | Soniox native endpointing |
| `assemblyai_native` | AssemblyAI Universal-3.6 Pro | AssemblyAI native endpointing, with `min_turn_silence=128` ms and `max_turn_silence=640` ms |

List several profiles, comma-separated, to fail over between them, for example
`VOICE_INPUT_PROFILE=soniox_native,assemblyai_native`. A call starts on the first
one; the next takes over when it can no longer transcribe (its first connect
fails, or it runs out of reconnect attempts), at the start of a call or in the
middle of one. Backups open no connection until they take over, and a call does
not switch back. Each listed profile requires its API key (`SONIOX_API_KEY`,
`ASSEMBLYAI_API_KEY`).

Native profiles let the STT service supply turn boundaries to the aggregator
while retaining local Silero VAD; a service taking over supplies its own.
The playback input gate blocks user input while the assistant speaks.

`assemblyai_native` can apply AssemblyAI Voice Focus, which suppresses
background voices and noise before transcription. It defaults to off. With
`ASSEMBLYAI_VOICE_FOCUS=auto`, learners pick their mic type before
a session starts: a worn mic (headset, lapel) uses `near-field` and the
computer's built-in mic uses `far-field`. Set `off`, `near-field`, or
`far-field` to override the choice; the mic type picker is then hidden, as it is
when no AssemblyAI profile is listed. `ASSEMBLYAI_VOICE_FOCUS_THRESHOLD` (0.0 to 1.0) tunes suppression
strength.
Voice Focus only cleans the audio AssemblyAI receives; local Silero VAD still
hears the raw microphone. Soniox has no equivalent and ignores the setting.

The voice runtime pins Pipecat 1.12.0. Set
`ELEVENLABS_TTS_MODEL=eleven_v4_turbo` for expressive, low-latency Vietnamese
conversation. The provider factory routes `eleven_v3`,
`eleven_v3_conversational`, `eleven_v4`, and `eleven_v4_turbo` through
`ElevenLabsDialogueTTSService` and the multi-context Text-to-Dialogue WebSocket
endpoint. Flash, Turbo v2.5, and Multilingual models use `ElevenLabsTTSService`
and the text-to-speech WebSocket endpoint. The settings default remains
`eleven_flash_v2_5` when no model override is supplied.

V4 Turbo was verified on Pipecat 1.12.0 with Vietnamese speech, playback-driven
opening completion, and persisted assistant transcripts for both configured
voices. Pipecat 1.12's list of models that take a language code stops at V3, so
`providers/tts.py` adds V4 to it and V4 connects with `language_code=vi`; V4
accepts and validates it (checked live). `Language.VI` also configures local
text processing. The dialogue
wrapper exposes stability, not V4's similarity control. Do not use
`ElevenLabsTTSService` for V4: that endpoint rejects the model. Text-to-Dialogue
requires workspace access; test with the deployment's API key and voices.

If ElevenLabs can't connect at call start, refuses the session (a bad key, no
credits, a missing voice), or gives up reconnecting mid-call, the same model and voice ID take over through OpenRouter's `/audio/speech`
(`ELEVENLABS_TTS_OPENROUTER_FALLBACK`, on by default). It needs
`VOICE_AGENT_LLM_BASE_URL` to point at OpenRouter and a model OpenRouter serves,
such as `eleven_v4_turbo` (`elevenlabs/eleven-v4-turbo`). OpenRouter passes
custom voice IDs through to ElevenLabs, so the buyer keeps their voice. It is
the same upstream, so it covers our ElevenLabs account, its WebSocket endpoint
and the network path, not an ElevenLabs-wide outage. OpenRouter sends each
sentence's audio only once it is complete, so the buyer starts each sentence
1-7 s later than over the WebSocket. The fallback sends `language_code=vi` through OpenRouter's
`provider.options.elevenlabs` (undocumented, but forwarded: an unsupported code
is rejected), like the WebSocket. A failover while the opener plays still
aborts the opening; a later one counts as an outage until the buyer speaks again.

So that the fallback doesn't hide a configuration mistake, the backend checks
the ElevenLabs key and both voice IDs once at startup. If ElevenLabs refuses
them, it logs an error and new sessions skip ElevenLabs: they use the web app's
next TTS choice, or are refused with "ElevenLabs TTS unavailable". Fix the key
or voice and restart. Running out of credits isn't checked; that is left to the
fallback.

Voice Library IDs can be used; they are not limited to default
voices. Library voices require a paid plan for API use. If a Library ID is found
in Explore but WebSocket synthesis reports `voice_not_found`, save it to My
Voices in the workspace that owns the API key. In our live check, a first HTTP
generation registered/bookmarked each selected voice, after which WebSocket
synthesis worked. No per-session HTTP warmup is implemented or required for
those registered voices. Restart after changing `.env` or upgrading Pipecat.
See the [Pipecat guide](https://docs.pipecat.ai/api-reference/server/services/tts/elevenlabs),
[V4 guide](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4),
and [Voice Library guide](https://elevenlabs.io/docs/eleven-creative/voices/voice-library).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | App liveness and environment name |
| GET | `/health/live` | Voice process liveness |
| GET | `/health/ready` | Accepting new sessions (false while shutting down) |
| GET | `/internal/status` | Readiness, active and maximum sessions, mic type picker, with the control key |
| POST | `/internal/sessions` | Register a session with the control key |
| GET | `/internal/sessions/{session_id}` | Read session state with the control key |
| POST | `/internal/sessions/{session_id}/end` | End a session with the control key |
| POST | `/internal/evaluations` | Generate practice feedback with the control key |
| POST, PATCH | `/api/offer` | Negotiate WebRTC with a session token |

Practice evaluations default to `openai/gpt-6-luna`, independently of the voice agent model; override with `VOICE_EVALUATION_LLM_MODEL`. GPT-6 Luna evaluations disable reasoning to preserve the non-reasoning latency budget. They use strict JSON Schema output, constrain outcome counts and keys to the practice, and validate keys and transcript evidence before returning feedback. The model supplies one required boolean per hidden insight and one status per objection (`not_raised`, `handled`, `partially_handled`, or `not_handled`), with evidence required for raised objections and forbidden for unraised ones. The server derives the existing discovered/missed insight lists and objection `raised`/`handling` fields; missing insight decisions are rejected rather than silently marked missed. The evaluation model/provider must support structured outputs; OpenRouter routing requires support for the supplied parameters. Invalid output or a temporary provider failure gets one automatic retry (two calls maximum, with SDK retries disabled), within a 45-second total deadline. Validation retries include the rejected answer and diagnostics so the model can correct it; generated content is kept out of failure logs. Truncated responses retry with a larger output allowance. Exhausted attempts return HTTP 502 with an evaluation error code and validation diagnostics for the frontend server log; users can retry from the saved transcript using the existing “Thử đánh giá lại” button.

Set Python's `VOICE_EVENT_INGEST_URL` to the frontend's `/api/internal/voice/events` endpoint and use the same `VOICE_EVENT_INGEST_KEY` in both services. The session registry and token nonces live in process memory. Run one Uvicorn worker per instance. Multiple instances need shared state or session affinity.

### Firewall ports

Open these inbound on the server that runs the voice backend:

| Port | Protocol | Purpose |
|------|----------|---------|
| 22 | TCP | SSH |
| 80, 443 | TCP | Reverse proxy (HTTPS, including `/api/offer` signaling) |
| 32768–60999 | UDP | Call audio (WebRTC) |

Only signaling goes through the reverse proxy. Call audio flows directly between
the browser and the voice backend over a random UDP port from the Linux
ephemeral range; Pipecat's WebRTC stack cannot be limited to a smaller range. If
this range is closed, the offer succeeds but no audio arrives and the session
ends with `connection_startup_timeout`. The voice backend therefore needs a
public IP, even when the reverse proxy runs on another server. Open the same
ports in the provider's cloud firewall or security group as well.

Keep the web app (4500) and voice backend (8000) closed to the public. With the
reverse proxy on the same server they listen on `127.0.0.1`; with a separate
proxy server, bind them to a reachable address and allow those ports from the
proxy's IP only. Only a STUN server is configured, so learners on networks that
block UDP need a TURN server added to `WEBRTC_ICE_SERVERS`.

## License

MIT
