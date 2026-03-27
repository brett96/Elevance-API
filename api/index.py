from __future__ import annotations

"""
Vercel serverless entrypoint for Django.

Vercel's Python runtime looks for a top-level variable named `app` in common entry files
like api/index.py. We expose the Django WSGI application as `app`.
"""

import os

# Must be set before importing Django/WSGI (Vercel and local).
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "medicare_retention_api.settings")

from medicare_retention_api.wsgi import app as django_app

app = django_app

