# Medicare Member Retention — Edge-AI POC

This repository is a **proof of concept** for a Medicare member retention tool built around a **zero-trust, on-device** model: clinical reasoning and LLM inference are intended to run **locally** on the patient’s device. The **backend is not a data lake** for PHI—it acts as an **API gateway**, **OAuth broker**, and **HTTP proxy** so the mobile app can reach Elevance FHIR and public drug APIs without embedding secrets in the client where avoidable.

---

## Design goals

| Goal | How it is addressed |
|------|----------------------|
| **Local AI** | React Native app downloads a quantized `.gguf` model and runs inference via **llama.cpp** (through `@react-native-ai/llama`). |
| **No long-lived PHI on the gateway** | Django exchanges OAuth codes and proxies requests; tokens are handed to the app via a **short-lived one-time code**, not pasted into logs by default. |
| **SMART on FHIR + PKCE in serverless** | PKCE `state` + `code_verifier` are stored in **PostgreSQL**, keyed by OAuth `state`—**not cookies**—so flows that bounce through the system browser / Custom Tabs do not break under strict tracking prevention. |
| **Vercel-safe DB usage** | `CONN_MAX_AGE = 0` and a **pooled** `DATABASE_URL` (e.g. PgBouncer / Supabase pooler) to avoid exhausting Postgres connections from ephemeral functions. |
| **CORS** | `django-cors-headers` is configured so **web** testing (Expo web, simulators) does not fail; native apps still send `Authorization` freely. |

---

## Repository layout

```
.
├── api/                          # Vercel serverless entry (WSGI app)
├── gateway/                      # Django app: OAuth session + token exchange models
├── medicare_retention_api/       # Django project (settings, urls, auth_views)
├── mobile/                       # Expo app: Dev Client (llama, RAG) + Expo web static export (handoff UI)
│   └── vercel.json               # Expo *web* project only (npm export → dist); not used by the API project
├── scripts/
│   └── test_elevance_api.py      # Terminal PKCE + FHIR smoke test
├── manage.py
├── requirements.txt
├── vercel.json                   # Django API project only (@vercel/python + builds)
└── apiTest.py                    # Legacy one-off script (superseded by scripts/)
```

---

## Architecture (high level)

The system is intentionally split into **two deployable surfaces**: a **Django API** (OAuth broker + FHIR proxies) and an optional **Expo web static bundle** (browser handoff UI). Native **React Native** uses the same API; it can skip the web handoff and consume a custom-scheme deep link.

```mermaid
flowchart LR
  subgraph device [Patient device]
    RN[React Native app]
    WEB[Expo web handoff]
    LM[llama.cpp via bridge]
    SQL[SQLite RAG store]
    RN --> LM
    RN --> SQL
  end

  subgraph cloud [Gateway]
    DJ[Django on Vercel]
    PG[(PostgreSQL)]
    DJ --> PG
  end

  subgraph external [External APIs]
    EH[Elevance OAuth + FHIR]
    DM[DailyMed API]
  end

  RN -->|GET /authorize| DJ
  WEB -->|GET /authorize in browser| DJ
  DJ -->|redirect| EH
  EH -->|code + state to /callback| DJ
  DJ -->|302 + one-time code| WEB
  DJ -->|302 custom scheme optional| RN
  WEB -->|POST exchange + FHIR GETs| DJ
  RN -->|POST exchange + FHIR GETs| DJ
  DJ --> EH
  DJ --> DM
```

1. **User starts OAuth** with **`GET /authorize/`** on the **Django host** (mobile browser, desktop, or in-app WebView). Django stores **PKCE** in Postgres (`PkceSession`, keyed by `state`) and redirects to Elevance’s authorize URL with `aud` = FHIR base URL and SMART scopes.
2. **Elevance** redirects the browser to **`/callback/`** on the **same Django host** with **`code` + `state`** (or with OAuth **error** query params if authorization failed—Django returns a structured JSON error instead of a generic `missing_code_or_state`).
3. Django exchanges the Elevance `code` for tokens, encrypts the payload, stores a **short-lived one-time exchange code**, then redirects:
   - **Recommended (desktop + web):** **`APP_HANDOFF_URL_BASE`** — use the **origin only** (e.g. `https://your-expo-web.vercel.app`) so the redirect is **`/?code=...&api_base=...`**. That always loads the static **`index.html`**; a path-only URL like `/handoff` can 404 unless the static host rewrites SPA routes.
   - **Native fallback:** **`APP_DEEPLINK_CALLBACK_BASE`** (e.g. `medicare-retention://oauth/callback?code=...`) if `APP_HANDOFF_URL_BASE` is unset.
4. The **client** (Expo web handoff page or native app) calls **`POST /api/auth/exchange/`** with `{ "code": "<one-time>" }` and receives the token JSON. The handoff page discovers the API via the **`api_base`** query param (or **`EXPO_PUBLIC_API_BASE_URL`**).
5. The client calls **FHIR proxy endpoints** on Django with **`Authorization: Bearer <access_token>`** — e.g. **`GET /api/fhir/patient/`**, **`/api/fhir/coverage/`**, **`/api/fhir/encounter/`**, **`/api/fhir/eob/`** — Django forwards to Elevance FHIR (short timeouts, no background work).

**Important:** **`/authorize`** and **`/callback`** must hit the **same Django deployment and database** as the PKCE row created for `state`. Mixing local `/authorize` with production `/callback` (or different databases) yields `state_not_found`.

---

## Backend (Django)

### Role

- **OAuth**: SMART Authorization Code + PKCE for Elevance; callback and token handoff.
- **Proxy**: FHIR `ExplanationOfBenefit` and DailyMed `drugnames` (minimal POC surface).
- **Persistence**: Postgres for PKCE sessions and one-time token exchange records only (not a clinical data warehouse).

### Important endpoints

| Path | Purpose |
|------|---------|
| `GET /` | JSON index of main routes |
| `GET /health/` | Liveness |
| `GET /authorize/` | Start OAuth; stores PKCE in DB, redirects to Elevance |
| `GET /callback/` | Elevance redirect; exchanges code; redirects to app with one-time `code` |
| `POST /api/auth/exchange/` | Body: `{"code":"<one-time>"}` → token JSON |
| `GET /api/fhir/patient/?patient_id=...` | Header: `Authorization: Bearer ...` → `Patient/{id}` |
| `GET /api/fhir/coverage/?patient_id=...` | Header: `Authorization: Bearer ...` → `Coverage?patient=` bundle |
| `GET /api/fhir/encounter/?patient_id=...` | Header: `Authorization: Bearer ...` → `Encounter?patient=` bundle |
| `GET /api/fhir/eob/?patient_id=...` | Header: `Authorization: Bearer ...` → proxied FHIR JSON |
| `GET /api/drugs/?name=...` | Proxied DailyMed drug name search (POC) |
| `GET /api/debug/oauth/` | If **`OAUTH_DEBUG=1`**: `redirect_uri` + `client_id` for Elevance portal checks |

### Environment variables

**Elevance / SMART**

- `ELEVANCE_CLIENT_ID`, `ELEVANCE_CLIENT_SECRET` (confidential client)
- `ELEVANCE_REDIRECT_URI` — must match the redirect URI registered with Elevance (points to **`https://<your-host>/callback/`** for production)
- `ELEVANCE_AUTH_URL`, `ELEVANCE_TOKEN_URL`, `ELEVANCE_FHIR_BASE_URL`
- `ELEVANCE_SCOPE` (optional; default includes `launch/patient patient/*.read openid fhirUser`)

**App handoff**

- `APP_HANDOFF_URL_BASE` — **recommended** Expo web **origin** only, e.g. `https://your-expo-web-host.vercel.app` (backend appends `?code=...&api_base=...`; avoid `/handoff` unless your static host rewrites that path to `index.html`)
- `APP_DEEPLINK_CALLBACK_BASE` — native fallback, e.g. `medicare-retention://oauth/callback` (custom scheme; desktop browsers cannot open this). Used only if `APP_HANDOFF_URL_BASE` is unset.
- `PUBLIC_API_BASE_URL` (optional) — explicit API host used when generating handoff redirect `api_base=...` query param for the web handoff page

**Token encryption at rest (exchange table)**

- `TOKEN_ENCRYPTION_KEY` — Fernet key, e.g.  
  `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`

**Database**

- `DATABASE_URL` — use a **pooler** connection string in production (Supabase pooler, PgBouncer, etc.)
- `DB_SSL_REQUIRE` — default `1` when using `DATABASE_URL`

**Django**

- `DJANGO_SECRET_KEY`, `DJANGO_DEBUG`, `DJANGO_ALLOWED_HOSTS`, `DJANGO_TIME_ZONE`

**CORS**

- `CORS_ALLOW_ALL_ORIGINS` — default `1` for POC; set `0` and `CORS_ALLOWED_ORIGINS` for production

**Debug (temporary)**

- `OAUTH_DEBUG` — set to **`1`** only while troubleshooting; enables **`GET /api/debug/oauth/`**. Remove or set **`0`** afterward.

### Local development

```powershell
cd "c:\Users\brtom\Documents\Elevance API"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

**`.env`:** With `python-dotenv` installed, both Django and `scripts/test_elevance_api.py` load a `.env` file from the **project root** (same folder as `manage.py`). Variable names must match the documented `ELEVANCE_*` / `DJANGO_*` keys—creating `.env` alone does nothing until you run `pip install -r requirements.txt` (or `pip install python-dotenv`).

**Postgres on localhost:** If `.env` sets `DATABASE_URL` to Postgres (e.g. for Vercel) but **no Postgres is running on your PC**, `runserver` will fail with *connection refused* on port 5432. For local API work, either:

- Set **`DJANGO_USE_SQLITE=1`** in `.env` (uses `db.sqlite3` in the project folder and ignores `DATABASE_URL` for Django), **or**
- Remove / comment out `DATABASE_URL` locally so Django falls back to SQLite, **or**
- Install and start PostgreSQL locally to match `DATABASE_URL`.

Set env vars (at minimum for OAuth views: Elevance vars + `TOKEN_ENCRYPTION_KEY`; for DB: use `DJANGO_USE_SQLITE=1` locally or a reachable `DATABASE_URL`).

```powershell
python manage.py migrate
python manage.py runserver
```

Open `http://127.0.0.1:8000/` — you should see JSON describing the API. A 404 on `/` before the root route was added meant no route existed; the project now serves **`GET /`** as a small JSON index.

**Phone or another PC on the same LAN:** `runserver` only binds to localhost by default, so **`http://192.168.x.x:8000` will not work** from other devices until you run:

`python manage.py runserver 0.0.0.0:8000`

Allow **Python** through Windows Firewall if prompted. (This is separate from **Expo/Metro on port 8081** — see [mobile/README.md](mobile/README.md).)

### Vercel (Django API project)

- Repo **root** `vercel.json` uses **`builds`** (`@vercel/python`) + **`routes`** to `api/index.py` — do not add a **`functions`** block in the same file (Vercel forbids mixing both). Because **`builds`** is present, **Project Settings → Build Command** in the dashboard may be **ignored** for this project (see Vercel’s warning in build logs).
- **Deploy checklist:** see **[DEPLOY_VERCEL.md](DEPLOY_VERCEL.md)** — env vars, Postgres + `migrate` on build, Elevance redirect URI, and troubleshooting.
- **Template:** [`.env.example`](.env.example) lists variable names (no secrets).
- Keep handlers **fast**: outbound HTTP uses short timeouts; no long-running tasks.

---

## Expo web static app (“frontend project”) and how it connects to the backend

The **browser handoff** experience is a **separate static site** produced by **`npx expo export -p web`** from **`mobile/`**. It is **not** the Django server: Django only returns JSON APIs, not the React bundle.

### Why two Vercel projects?

| Project | Root in repo | Config file | Build | Output |
|--------|----------------|------------|-------|--------|
| **API (Django)** | Repository root (default) | Root `vercel.json` — Python **`builds`**, `api/index.py` | `pip` + `manage.py` (see `vercel.json`) | Serverless Python |
| **Expo web (handoff UI)** | **`mobile`** | **`mobile/vercel.json`** — **no** `builds` | `npm install` + `npx expo export -p web` | Static **`dist/`** |

Create **two** Vercel projects linked to the **same GitHub repo**: one for the API (root), one for Expo web (**Root Directory = `mobile`**). The Expo project must **not** use the root `vercel.json`; Vercel resolves config from the **root directory** you set.

### Repository `.vercelignore` (important)

The repo root **`.vercelignore`** must **not** ignore the entire **`mobile/`** tree. A line like `mobile` was used originally to shrink API uploads; that **removes** `mobile/package.json` from the upload and breaks **`npm install`** when Root Directory is `mobile`. Ignore only heavy paths (e.g. `mobile/node_modules`, `mobile/android`, `mobile/ios`) instead.

### How the handoff page talks to the API

1. After OAuth, Django redirects the browser to  
   **`https://<expo-web-host>/?code=<one-time-exchange-code>&api_base=https%3A%2F%2F<api-host>`**  
   (optional **`PUBLIC_API_BASE_URL`** on the API can force `api_base` if you need a canonical API URL).

2. The **Expo web** bundle loads from **`/`** (always **`index.html`**). The handoff screen reads **`code`** and **`api_base`** from the query string.

3. The browser sends **`POST https://<api-host>/api/auth/exchange/`** with the one-time `code` (CORS allows this for POC; lock down **`CORS_ALLOWED_ORIGINS`** in production).

4. With the returned **`access_token`**, the handoff UI calls **`GET`** on the FHIR proxy routes on the **same API host** — e.g. `/api/fhir/patient/?patient_id=...` — with **`Authorization: Bearer ...`**.

5. **`EXPO_PUBLIC_API_BASE_URL`** (optional) can override the API base for local web dev; production usually relies on **`api_base`** from the redirect.

See **[mobile/README.md](mobile/README.md)** for Vercel dashboard pitfalls (Python build logs on the Expo project = wrong root or root `builds` winning), `.vercelignore`, and local web testing URLs.

---

## Phase 1: Terminal PKCE test

`scripts/test_elevance_api.py` mirrors the same OAuth parameters as the Django app (scopes, `aud`, PKCE S256) but runs entirely in the terminal for integration testing.

```powershell
$env:ELEVANCE_CLIENT_ID="..."
$env:ELEVANCE_CLIENT_SECRET="..."
$env:ELEVANCE_REDIRECT_URI="https://your-registered-callback"
python .\scripts\test_elevance_api.py
```

See `scripts/README.md` for a shorter quick start.

---

## Mobile app (`mobile/`)

See **[mobile/README.md](mobile/README.md)** for dependency hygiene (avoid `npm audit fix --force`, use `npx expo install`), OAuth handoff, and **Expo web on Vercel** troubleshooting.

- **Expo + Dev Client** so native modules (llama, SQLite) are usable on **iOS/Android**.
- **Expo web** (`npx expo start --web` / `npx expo export -p web`): same React Native code targets a **static** bundle for the **sign-in handoff** page (patient summary, coverage, encounters, EOB summaries) after redirect from Django; **technical details** (tokens, raw FHIR JSON) are behind a toggle.
- **`ModelManager`**: downloads `.gguf` from an HTTPS URL into app document storage with progress.
- **`LlamaService`**: loads the model via `@react-native-ai/llama` (`languageModel` + `textEmbeddingModel`), exposes completion and embedding helpers used by the RAG scaffold.
- **`LocalVectorStore`**: SQLite persistence for chunk text + embedding vectors; similarity search is implemented in-process in the POC (ready to swap for **sqlite-vss** when the native extension is available in your build).
- **`process_medical_data`**: chunks FHIR-shaped JSON, calls **llama embeddings** (not random hashes), and stores rows for later retrieval.

Install and run (from `mobile/`):

```powershell
cd mobile
npm install
npx expo prebuild   # if you use custom native modules / dev client builds
npx expo start
```

Exact native build steps depend on your machine (Xcode / Android Studio); Dev Client is required for full llama + SQLite extension workflows.

---

## Security notes (POC)

- Treat **`ELEVANCE_CLIENT_SECRET`** and **`TOKEN_ENCRYPTION_KEY`** as secrets; never commit them.
- The one-time exchange code is **single-use** and short-lived; still protect your API host with HTTPS and rate limits in production.
- FHIR access tokens are **highly sensitive**; store them only in platform secure storage on device. The **web handoff** page intentionally shows **masked** tokens and **summaries**; raw JSON is hidden behind a **technical details** toggle—do not treat the handoff URL as a long-term PHI surface in production without hardening.

---

## Related files

- OAuth + FHIR proxies: `medicare_retention_api/auth_views.py`
- URL routing: `medicare_retention_api/urls.py`
- Models: `gateway/models.py`
- Settings (Postgres, CORS, `CONN_MAX_AGE`): `medicare_retention_api/settings.py`
- Handoff UI + FHIR display helpers: `mobile/src/screens/HandoffScreen.tsx`, `mobile/src/utils/fhirDisplay.ts`
- Expo web Vercel config: `mobile/vercel.json`
