from __future__ import annotations

"""
Vercel serverless entrypoint for Django.

Vercel's Python runtime looks for a top-level variable named `app` in common entry files
like api/index.py. We expose the Django WSGI application as `app`.
"""

import os

from medicare_retention_api.wsgi import app as django_app

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "medicare_retention_api.settings")

app = django_app

