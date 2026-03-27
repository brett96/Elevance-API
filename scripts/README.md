## scripts/

### `test_elevance_api.py`

Standalone terminal utility to validate Elevance SMART on FHIR OAuth2 PKCE and a basic FHIR call.

#### Option A: `.env` in the project root (recommended)

Create a file named `.env` next to `manage.py` with:

```env
ELEVANCE_CLIENT_ID=...
ELEVANCE_CLIENT_SECRET=...
ELEVANCE_REDIRECT_URI=https://your-registered-redirect/callback
```

Install dependencies (includes `python-dotenv`, which loads `.env` into the process):

```powershell
pip install -r requirements.txt
python .\scripts\test_elevance_api.py
```

#### Option B: PowerShell ` $env:` variables

```powershell
$env:ELEVANCE_CLIENT_ID="..."
$env:ELEVANCE_CLIENT_SECRET="..."
$env:ELEVANCE_REDIRECT_URI="https://your-registered-redirect/callback"

python .\scripts\test_elevance_api.py
```

#### Notes

- Uses scopes: `launch/patient patient/*.read openid fhirUser`
- Sends `aud` set to `ELEVANCE_FHIR_BASE_URL` (required by Elevance)

#### Timeouts (token / FHIR requests)

If you see **read timeout** on the token step, the default is now a **90s read** and **20s connect** (configurable). In `.env` or the shell:

```env
ELEVANCE_HTTP_CONNECT_TIMEOUT_S=30
ELEVANCE_HTTP_READ_TIMEOUT_S=120
```

Or a single value for both (legacy): `ELEVANCE_HTTP_TIMEOUT_S=60`
