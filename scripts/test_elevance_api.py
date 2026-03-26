"""
Standalone Elevance SMART on FHIR PKCE tester.

Runs a full OAuth2 Authorization Code + PKCE flow from the terminal:
1) Generates code_verifier + code_challenge (S256)
2) Prints the Elevance authorize URL (with required scopes + aud)
3) Prompts for the redirected callback URL and extracts ?code=
4) Exchanges the code for tokens at the token endpoint
5) Calls FHIR: GET ExplanationOfBenefit?patient={patient_id}

All configuration is via environment variables so secrets are never committed.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import sys
import textwrap
import time
import urllib.parse
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

import requests


DEFAULT_ELEVANCE_AUTH_URL = (
    "https://sbx.totalview.healthos.elevancehealth.com/oauth2.code/registered/api/v1/authorize"
)
DEFAULT_ELEVANCE_TOKEN_URL = (
    "https://sbx.totalview.healthos.elevancehealth.com/client.oauth2/registered/api/v1/token"
)
DEFAULT_ELEVANCE_FHIR_BASE_URL = (
    "https://sbx.totalview.healthos.elevancehealth.com/resources/registered/Sandbox/api/v1/fhir"
)

DEFAULT_SCOPE = "launch/patient patient/*.read openid fhirUser"


@dataclass(frozen=True)
class ElevanceConfig:
    client_id: str
    client_secret: str
    redirect_uri: str
    auth_url: str
    token_url: str
    fhir_base_url: str
    scope: str


class ConfigError(RuntimeError):
    pass


class OAuthFlowError(RuntimeError):
    pass


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    val = os.environ.get(name)
    if val is None or val.strip() == "":
        return default
    return val.strip()


def load_config() -> ElevanceConfig:
    """
    Load Elevance SMART configuration from environment variables.

    Required:
      - ELEVANCE_CLIENT_ID
      - ELEVANCE_CLIENT_SECRET  (confidential client)
      - ELEVANCE_REDIRECT_URI

    Optional (default to sandbox endpoints):
      - ELEVANCE_AUTH_URL
      - ELEVANCE_TOKEN_URL
      - ELEVANCE_FHIR_BASE_URL
      - ELEVANCE_SCOPE
    """
    client_id = _env("ELEVANCE_CLIENT_ID")
    client_secret = _env("ELEVANCE_CLIENT_SECRET")
    redirect_uri = _env("ELEVANCE_REDIRECT_URI")
    if not client_id or not client_secret or not redirect_uri:
        raise ConfigError(
            "Missing required env vars. Set ELEVANCE_CLIENT_ID, ELEVANCE_CLIENT_SECRET, ELEVANCE_REDIRECT_URI."
        )

    return ElevanceConfig(
        client_id=client_id,
        client_secret=client_secret,
        redirect_uri=redirect_uri,
        auth_url=_env("ELEVANCE_AUTH_URL", DEFAULT_ELEVANCE_AUTH_URL) or DEFAULT_ELEVANCE_AUTH_URL,
        token_url=_env("ELEVANCE_TOKEN_URL", DEFAULT_ELEVANCE_TOKEN_URL) or DEFAULT_ELEVANCE_TOKEN_URL,
        fhir_base_url=_env("ELEVANCE_FHIR_BASE_URL", DEFAULT_ELEVANCE_FHIR_BASE_URL)
        or DEFAULT_ELEVANCE_FHIR_BASE_URL,
        scope=_env("ELEVANCE_SCOPE", DEFAULT_SCOPE) or DEFAULT_SCOPE,
    )


def generate_pkce_pair() -> Tuple[str, str]:
    """
    Generate PKCE (RFC 7636) code_verifier and S256 code_challenge.

    Uses urlsafe base64 without '=' padding.
    """
    # 32 bytes is plenty; resulting verifier length fits RFC (43..128 chars).
    verifier_bytes = os.urandom(32)
    code_verifier = base64.urlsafe_b64encode(verifier_bytes).rstrip(b"=").decode("utf-8")

    challenge_bytes = hashlib.sha256(code_verifier.encode("utf-8")).digest()
    code_challenge = base64.urlsafe_b64encode(challenge_bytes).rstrip(b"=").decode("utf-8")
    return code_verifier, code_challenge


def build_authorize_url(cfg: ElevanceConfig, code_challenge: str, state: str) -> str:
    """
    Build the Elevance authorization URL with required SMART parameters.

    Elevance requires the `aud` parameter set to the FHIR base URL.
    """
    params = {
        "response_type": "code",
        "client_id": cfg.client_id,
        "redirect_uri": cfg.redirect_uri,
        "scope": cfg.scope,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "aud": cfg.fhir_base_url,
    }
    return f"{cfg.auth_url}?{urllib.parse.urlencode(params)}"


def prompt_redirected_url() -> str:
    print(
        textwrap.dedent(
            """
            Paste the FULL redirected URL from the browser address bar.
            Example:
              https://your-redirect/callback?code=...&state=...
            """
        ).strip()
    )
    return input("\nRedirected URL: ").strip()


def extract_code_and_state(redirected_url: str) -> Tuple[str, Optional[str]]:
    parsed = urllib.parse.urlparse(redirected_url)
    query = urllib.parse.parse_qs(parsed.query)
    code = query.get("code", [None])[0]
    state = query.get("state", [None])[0]
    if not code:
        raise OAuthFlowError("Redirect URL did not contain a `code` query parameter.")
    return code, state


def _pretty(obj: Any) -> str:
    try:
        return json.dumps(obj, indent=2, sort_keys=True)
    except Exception:
        return repr(obj)


def exchange_code_for_token(
    cfg: ElevanceConfig, *, code: str, code_verifier: str, timeout_s: float = 15.0
) -> Dict[str, Any]:
    """
    Exchange authorization code for token(s) at the token endpoint.

    Uses both:
      - form params including client_secret (confidential client)
      - HTTP Basic auth header
    because some implementations require one or the other.
    """
    payload = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": cfg.redirect_uri,
        "client_id": cfg.client_id,
        "client_secret": cfg.client_secret,
        "code_verifier": code_verifier,
    }

    try:
        resp = requests.post(
            cfg.token_url,
            data=payload,
            auth=requests.auth.HTTPBasicAuth(cfg.client_id, cfg.client_secret),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=timeout_s,
        )
    except requests.RequestException as e:
        raise OAuthFlowError(f"Token request failed (network/timeout): {e}") from e

    content_type = resp.headers.get("Content-Type", "")
    is_json = "json" in content_type.lower()
    body: Any
    if is_json:
        try:
            body = resp.json()
        except ValueError:
            body = resp.text
    else:
        body = resp.text

    if resp.status_code != 200:
        raise OAuthFlowError(
            f"Token exchange failed ({resp.status_code}). Response:\n{_pretty(body)}"
        )

    if not isinstance(body, dict):
        raise OAuthFlowError(f"Token response was not JSON object. Response:\n{_pretty(body)}")

    if "access_token" not in body:
        raise OAuthFlowError(f"Token response missing access_token. Response:\n{_pretty(body)}")

    return body


def fetch_eob(
    cfg: ElevanceConfig,
    *,
    access_token: str,
    patient_id: str,
    timeout_s: float = 15.0,
) -> Dict[str, Any]:
    url = f"{cfg.fhir_base_url}/ExplanationOfBenefit?patient={urllib.parse.quote(patient_id)}"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/fhir+json",
    }
    try:
        resp = requests.get(url, headers=headers, timeout=timeout_s)
    except requests.RequestException as e:
        raise RuntimeError(f"FHIR request failed (network/timeout): {e}") from e

    if resp.status_code != 200:
        raise RuntimeError(f"FHIR EOB failed ({resp.status_code}):\n{resp.text}")

    try:
        data = resp.json()
    except ValueError as e:
        raise RuntimeError(f"FHIR response was not JSON:\n{resp.text}") from e
    if not isinstance(data, dict):
        raise RuntimeError(f"FHIR response JSON was not an object:\n{_pretty(data)}")
    return data


def main() -> int:
    try:
        cfg = load_config()
    except ConfigError as e:
        print(f"[CONFIG ERROR] {e}", file=sys.stderr)
        print(
            textwrap.dedent(
                f"""
                Quick start (PowerShell):
                  $env:ELEVANCE_CLIENT_ID="..."
                  $env:ELEVANCE_CLIENT_SECRET="..."
                  $env:ELEVANCE_REDIRECT_URI="https://example.com/callback"

                Optional overrides:
                  $env:ELEVANCE_AUTH_URL="{DEFAULT_ELEVANCE_AUTH_URL}"
                  $env:ELEVANCE_TOKEN_URL="{DEFAULT_ELEVANCE_TOKEN_URL}"
                  $env:ELEVANCE_FHIR_BASE_URL="{DEFAULT_ELEVANCE_FHIR_BASE_URL}"
                  $env:ELEVANCE_SCOPE="{DEFAULT_SCOPE}"
                """
            ).strip(),
            file=sys.stderr,
        )
        return 2

    code_verifier, code_challenge = generate_pkce_pair()
    state = secrets.token_urlsafe(24)
    auth_url = build_authorize_url(cfg, code_challenge, state)

    print("--- Elevance SMART on FHIR PKCE Tester ---\n")
    print("[STEP 1] Open this URL in your browser and authenticate/approve:")
    print("-" * 80)
    print(auth_url)
    print("-" * 80)

    redirected_url = prompt_redirected_url()
    try:
        code, returned_state = extract_code_and_state(redirected_url)
    except OAuthFlowError as e:
        print(f"[OAUTH ERROR] {e}", file=sys.stderr)
        return 3

    if returned_state and returned_state != state:
        print(
            f"[OAUTH ERROR] State mismatch.\n  expected={state}\n  returned={returned_state}",
            file=sys.stderr,
        )
        return 4

    print("\n[STEP 2] Exchanging code for tokens...")
    t0 = time.time()
    try:
        token = exchange_code_for_token(cfg, code=code, code_verifier=code_verifier)
    except OAuthFlowError as e:
        print(f"[OAUTH ERROR] {e}", file=sys.stderr)
        return 5
    dt = time.time() - t0

    access_token = token.get("access_token")
    patient_id = token.get("patient")

    print(f"[SUCCESS] Token received in {dt:.2f}s")
    print("\n--- Raw token response (excluding access_token) ---")
    redacted = {k: v for k, v in token.items() if k != "access_token"}
    print(_pretty(redacted))

    print("\n================== FULL ACCESS TOKEN ==================")
    print(access_token)
    print("=======================================================\n")

    if not patient_id:
        print(
            "[WARN] Token response did not include a top-level `patient` claim.\n"
            "If you know the patient ID, enter it below to test EOB."
        )
        patient_id = input("Patient ID: ").strip() or None
        if not patient_id:
            print("No patient_id provided. Exiting.")
            return 0

    print(f"\n[STEP 3] Fetching ExplanationOfBenefit for patient={patient_id} ...")
    try:
        eob = fetch_eob(cfg, access_token=access_token, patient_id=patient_id)
    except Exception as e:
        print(f"[FHIR ERROR] {e}", file=sys.stderr)
        return 6

    print("[SUCCESS] FHIR EOB retrieved.")
    print(_pretty(eob))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
