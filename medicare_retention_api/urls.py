from __future__ import annotations

from django.contrib import admin
from django.http import JsonResponse
from django.urls import path

from medicare_retention_api.auth_views import (
    authorize,
    elevance_callback,
    exchange_code,
    proxy_dailymed,
    proxy_eob,
)


def health(request):
    return JsonResponse({"ok": True})


def root(request):
    """Landing for GET / — API gateway has no HTML home; return JSON with useful links."""
    return JsonResponse(
        {
            "service": "medicare_retention_api",
            "message": "Django API gateway is running.",
            "endpoints": {
                "health": "/health/",
                "authorize": "/authorize/",
                "oauth_callback": "/callback/",
                "token_exchange": "/api/auth/exchange/",
                "fhir_eob_proxy": "/api/fhir/eob/?patient_id=<id>",
                "dailymed_proxy": "/api/drugs/?name=<query>",
                "admin": "/admin/",
            },
        }
    )


urlpatterns = [
    path("", root),
    path("admin/", admin.site.urls),
    path("health/", health),
    path("authorize", authorize),
    path("authorize/", authorize),
    path("callback", elevance_callback),
    path("callback/", elevance_callback),
    path("api/auth/exchange/", exchange_code),
    path("api/fhir/eob/", proxy_eob),
    path("api/drugs/", proxy_dailymed),
]

