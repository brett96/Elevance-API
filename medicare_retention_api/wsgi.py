from __future__ import annotations

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "medicare_retention_api.settings")

application = get_wsgi_application()

# Vercel Python runtime expects a top-level "app" for WSGI.
app = application

