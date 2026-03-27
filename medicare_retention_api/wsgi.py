from __future__ import annotations

import logging
import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "medicare_retention_api.settings")

application = get_wsgi_application()

# Vercel Python runtime expects a top-level "app" for WSGI.
app = application


def _is_vercel_runtime() -> bool:
    if os.environ.get("VERCEL") == "1":
        return True
    if os.environ.get("VERCEL_ENV"):
        return True
    if os.environ.get("VERCEL_URL"):
        return True
    return False


def _auto_migrate_if_vercel() -> None:
    """
    Apply migrations on serverless cold start when deployed on Vercel.

    Build-time `python manage.py migrate` sometimes does not run (or targets a different
    env than runtime), which leaves tables like gateway_pkcesession missing. Migrations
    are idempotent and use DB-level locking; safe for concurrent cold starts.
    """
    if os.environ.get("SKIP_VERCEL_AUTO_MIGRATE") == "1":
        return
    if not _is_vercel_runtime():
        return
    try:
        from django.core.management import call_command

        call_command("migrate", "--noinput", verbosity=0)
    except Exception:
        logging.getLogger(__name__).exception("Auto-migrate on Vercel failed")


_auto_migrate_if_vercel()

