"""
Django settings for medicare_retention_api.

This project is intentionally minimal: it acts as an API gateway / OAuth handler / proxy.
It is designed for Vercel-style serverless deployment (short timeouts, stateless requests).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import List

import dj_database_url


BASE_DIR = Path(__file__).resolve().parent.parent

# Load `.env` from project root so local dev matches shell env (Vercel uses real env vars).
try:
    from dotenv import load_dotenv

    load_dotenv(BASE_DIR / ".env")
except ImportError:
    pass


def _env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name)
    if v is None or v.strip() == "":
        return default
    return v.strip()


SECRET_KEY = _env("DJANGO_SECRET_KEY", "dev-insecure-change-me")
DEBUG = (_env("DJANGO_DEBUG", "0") == "1")

ALLOWED_HOSTS: List[str] = []
allowed_hosts_raw = _env("DJANGO_ALLOWED_HOSTS", "")
if allowed_hosts_raw:
    ALLOWED_HOSTS = [h.strip() for h in allowed_hosts_raw.split(",") if h.strip()]
else:
    # Vercel (and local) friendly defaults; override in production via env.
    ALLOWED_HOSTS = ["localhost", "127.0.0.1", ".vercel.app"]


INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "gateway",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "medicare_retention_api.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    }
]

WSGI_APPLICATION = "medicare_retention_api.wsgi.application"


DATABASE_URL = _env("DATABASE_URL")
# Local Windows/Mac dev: set DJANGO_USE_SQLITE=1 to use SQLite even if DATABASE_URL is set
# (e.g. you copied production env but Postgres is not running on localhost).
USE_SQLITE_LOCAL = _env("DJANGO_USE_SQLITE", "0") == "1"

if DATABASE_URL and not USE_SQLITE_LOCAL:
    DATABASES = {
        "default": dj_database_url.parse(
            DATABASE_URL,
            conn_max_age=0,  # critical for serverless; rely on external pooler
            ssl_require=_env("DB_SSL_REQUIRE", "1") == "1",
        )
    }
else:
    # Local fallback when DATABASE_URL is unset, or when DJANGO_USE_SQLITE=1.
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": str(BASE_DIR / "db.sqlite3"),
        }
    }

# Force close connections per-request when using Postgres in serverless (ignored for SQLite).
CONN_MAX_AGE = 0


AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = _env("DJANGO_TIME_ZONE", "UTC") or "UTC"
USE_I18N = True
USE_TZ = True


STATIC_URL = "static/"
STATIC_ROOT = str(BASE_DIR / "staticfiles")
STORAGES = {
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# CORS
# - RN native doesn't enforce browser CORS, but this enables web testing and avoids surprises.
# - Prefer explicit origins in production.
CORS_ALLOW_CREDENTIALS = False
CORS_ALLOW_ALL_ORIGINS = (_env("CORS_ALLOW_ALL_ORIGINS", "1") == "1")

cors_allowed_origins_raw = _env("CORS_ALLOWED_ORIGINS", "")
if cors_allowed_origins_raw:
    CORS_ALLOWED_ORIGINS = [o.strip() for o in cors_allowed_origins_raw.split(",") if o.strip()]

CORS_ALLOW_HEADERS = list(
    {
        "accept",
        "accept-encoding",
        "authorization",
        "content-type",
        "origin",
        "user-agent",
        "x-csrftoken",
        "x-requested-with",
    }
)

