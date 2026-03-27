from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import urllib.parse
from datetime import timedelta
from typing import Any, Dict, Optional, Tuple, Union

import requests
from cryptography.fernet import Fernet
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import redirect
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from gateway.models import PkceSession, TokenExchangeCode


DEFAULT_SCOPE = "launch/patient patient/*.read openid fhirUser"


def _http_timeout() -> Union[float, Tuple[float, float]]:
    """Same semantics as scripts/test_elevance_api.py (connect vs read for slow token API)."""
    legacy = _env("ELEVANCE_HTTP_TIMEOUT_S")
    if legacy:
        return float(legacy)
    connect = float(_env("ELEVANCE_HTTP_CONNECT_TIMEOUT_S", "20") or "20")
    read = float(_env("ELEVANCE_HTTP_READ_TIMEOUT_S", "90") or "90")
    return (connect, read)


class ConfigError(RuntimeError):
    pass


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    v = os.environ.get(name)
    if v is None or v.strip() == "":
        return default
    return v.strip()


def _require_env(name: str) -> str:
    v = _env(name)
    if not v:
        raise ConfigError(f"Missing required env var: {name}")
    return v


def _pkce_pair() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(os.urandom(32)).rstrip(b"=").decode("utf-8")
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("utf-8")).digest()).rstrip(
        b"="
    ).decode("utf-8")
    return verifier, challenge


def _fernet() -> Fernet:
    """
    TOKEN_ENCRYPTION_KEY must be a Fernet key (urlsafe base64-encoded 32 bytes).
    Generate one locally with:
      python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    """
    key = _require_env("TOKEN_ENCRYPTION_KEY").encode("utf-8")
    try:
        return Fernet(key)
    except Exception as e:
        raise ConfigError("TOKEN_ENCRYPTION_KEY is invalid for Fernet.") from e


def _elevance_cfg() -> dict[str, str]:
    return {
        "client_id": _require_env("ELEVANCE_CLIENT_ID"),
        "client_secret": _require_env("ELEVANCE_CLIENT_SECRET"),
        "redirect_uri": _require_env("ELEVANCE_REDIRECT_URI"),
        "auth_url": _require_env("ELEVANCE_AUTH_URL"),
        "token_url": _require_env("ELEVANCE_TOKEN_URL"),
        "fhir_base_url": _require_env("ELEVANCE_FHIR_BASE_URL"),
        "scope": _env("ELEVANCE_SCOPE", DEFAULT_SCOPE) or DEFAULT_SCOPE,
    }


@require_GET
def authorize(request: HttpRequest) -> HttpResponse:
    """
    Start SMART on FHIR OAuth2 Authorization Code + PKCE flow.

    Stores PKCE server-side in Postgres keyed by `state` (no cookies).
    """
    cfg = _elevance_cfg()
    verifier, challenge = _pkce_pair()
    state = secrets.token_urlsafe(24)

    now = timezone.now()
    PkceSession.objects.create(
        state=state,
        code_verifier=verifier,
        expires_at=now + timedelta(minutes=10),
    )

    params = {
        "response_type": "code",
        "client_id": cfg["client_id"],
        "redirect_uri": cfg["redirect_uri"],
        "scope": cfg["scope"],
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "aud": cfg["fhir_base_url"],
    }
    url = f"{cfg['auth_url']}?{urllib.parse.urlencode(params)}"
    return redirect(url)


@require_GET
def elevance_callback(request: HttpRequest) -> HttpResponse:
    """
    OAuth redirect target: receives temporary `code` + `state`, exchanges for tokens,
    then redirects to the mobile deep-link with a one-time exchange code.
    """
    code = request.GET.get("code")
    state = request.GET.get("state")
    if not code or not state:
        return JsonResponse({"error": "missing_code_or_state"}, status=400)

    cfg = _elevance_cfg()

    now = timezone.now()
    try:
        sess = PkceSession.objects.get(state=state)
    except PkceSession.DoesNotExist:
        return JsonResponse({"error": "state_not_found"}, status=400)

    if sess.used_at is not None:
        return JsonResponse({"error": "state_already_used"}, status=400)
    if sess.expires_at <= now:
        return JsonResponse({"error": "state_expired"}, status=400)

    # Mark state as used before token exchange to enforce one-time use (best-effort).
    sess.used_at = now
    sess.save(update_fields=["used_at"])

    token_payload = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": cfg["redirect_uri"],
        "client_id": cfg["client_id"],
        "client_secret": cfg["client_secret"],
        "code_verifier": sess.code_verifier,
    }

    try:
        resp = requests.post(
            cfg["token_url"],
            data=token_payload,
            auth=requests.auth.HTTPBasicAuth(cfg["client_id"], cfg["client_secret"]),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=_http_timeout(),
        )
    except requests.RequestException as e:
        return JsonResponse({"error": "token_request_failed", "detail": str(e)}, status=502)

    try:
        token: Any = resp.json()
    except ValueError:
        token = resp.text

    if resp.status_code != 200 or not isinstance(token, dict) or "access_token" not in token:
        return JsonResponse(
            {"error": "token_exchange_failed", "status": resp.status_code, "response": token},
            status=400,
        )

    # Store token payload encrypted-at-rest, keyed by a one-time exchange code.
    exchange_code = secrets.token_urlsafe(32)
    f = _fernet()
    token_bytes = json.dumps(token, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    encrypted = f.encrypt(token_bytes)
    TokenExchangeCode.objects.create(
        code=exchange_code,
        token_encrypted_b64=base64.b64encode(encrypted).decode("ascii"),
        expires_at=now + timedelta(minutes=5),
    )

    deeplink_base = _require_env("APP_DEEPLINK_CALLBACK_BASE")
    sep = "&" if ("?" in deeplink_base) else "?"
    return redirect(f"{deeplink_base}{sep}code={urllib.parse.quote(exchange_code)}")


@csrf_exempt
@require_POST
def exchange_code(request: HttpRequest) -> HttpResponse:
    """
    Mobile app exchanges a short-lived one-time code for the token payload.

    Request JSON: { "code": "..." }
    """
    try:
        body = json.loads(request.body.decode("utf-8") or "{}")
    except ValueError:
        return JsonResponse({"error": "invalid_json"}, status=400)

    code = body.get("code")
    if not code or not isinstance(code, str):
        return JsonResponse({"error": "missing_code"}, status=400)

    now = timezone.now()
    try:
        rec = TokenExchangeCode.objects.get(code=code)
    except TokenExchangeCode.DoesNotExist:
        return JsonResponse({"error": "code_not_found"}, status=404)

    if rec.consumed_at is not None:
        return JsonResponse({"error": "code_already_consumed"}, status=400)
    if rec.expires_at <= now:
        return JsonResponse({"error": "code_expired"}, status=400)

    # Mark consumed first (best-effort) to reduce replay.
    rec.consumed_at = now
    rec.save(update_fields=["consumed_at"])

    try:
        encrypted = base64.b64decode(rec.token_encrypted_b64.encode("ascii"))
        token_bytes = _fernet().decrypt(encrypted)
        token: Any = json.loads(token_bytes.decode("utf-8"))
    except Exception as e:
        return JsonResponse({"error": "decrypt_failed", "detail": str(e)}, status=500)

    if not isinstance(token, dict):
        return JsonResponse({"error": "token_payload_invalid"}, status=500)

    return JsonResponse(token, status=200)


def _bearer_token(request: HttpRequest) -> Optional[str]:
    auth = request.headers.get("Authorization") or ""
    if not auth.startswith("Bearer "):
        return None
    return auth[len("Bearer ") :].strip() or None


@require_http_methods(["GET"])
def proxy_eob(request: HttpRequest) -> HttpResponse:
    """
    Proxy ExplanationOfBenefit from Elevance FHIR.

    Client provides Authorization: Bearer <access_token>.
    Query param: patient_id (required)
    """
    cfg = _elevance_cfg()
    token = _bearer_token(request)
    if not token:
        return JsonResponse({"error": "missing_bearer_token"}, status=401)

    patient_id = request.GET.get("patient_id") or request.GET.get("patient")
    if not patient_id:
        return JsonResponse({"error": "missing_patient_id"}, status=400)

    url = f"{cfg['fhir_base_url']}/ExplanationOfBenefit?patient={urllib.parse.quote(patient_id)}"
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/fhir+json"}
    try:
        resp = requests.get(url, headers=headers, timeout=_http_timeout())
    except requests.RequestException as e:
        return JsonResponse({"error": "fhir_request_failed", "detail": str(e)}, status=502)

    try:
        data: Any = resp.json()
    except ValueError:
        data = resp.text

    if resp.status_code != 200:
        return JsonResponse(
            {"error": "fhir_error", "status": resp.status_code, "response": data},
            status=resp.status_code,
        )

    return JsonResponse(data, status=200, safe=isinstance(data, dict))


@require_http_methods(["GET"])
def proxy_dailymed(request: HttpRequest) -> HttpResponse:
    """
    Minimal DailyMed proxy endpoint.

    For POC, supports querying drug names:
      GET /api/drugs/?name=ibuprofen
    """
    name = request.GET.get("name")
    if not name:
        return JsonResponse({"error": "missing_name"}, status=400)

    url = "https://dailymed.nlm.nih.gov/dailymed/services/v2/drugnames.json"
    params = {"drug_name": name}
    try:
        resp = requests.get(url, params=params, timeout=_http_timeout())
    except requests.RequestException as e:
        return JsonResponse({"error": "dailymed_request_failed", "detail": str(e)}, status=502)

    try:
        data: Any = resp.json()
    except ValueError:
        data = resp.text

    if resp.status_code != 200:
        return JsonResponse(
            {"error": "dailymed_error", "status": resp.status_code, "response": data},
            status=resp.status_code,
        )

    return JsonResponse(data, status=200, safe=isinstance(data, dict))

