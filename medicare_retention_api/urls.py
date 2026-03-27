from __future__ import annotations

from django.contrib import admin
from django.http import JsonResponse
from django.urls import path

from medicare_retention_api.auth_views import (
    authorize,
    elevance_callback,
    exchange_code,
    oauth_debug_config,
    proxy_coverage,
    proxy_dailymed,
    proxy_encounter,
    proxy_eob,
    proxy_patient,
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
                "fhir_patient_proxy": "/api/fhir/patient/?patient_id=<id>",
                "fhir_coverage_proxy": "/api/fhir/coverage/?patient_id=<id>",
                "fhir_encounter_proxy": "/api/fhir/encounter/?patient_id=<id>",
                "fhir_eob_proxy": "/api/fhir/eob/?patient_id=<id>",
                "dailymed_proxy": "/api/drugs/?name=<query>",
                "admin": "/admin/",
                "oauth_debug": "/api/debug/oauth/ (requires OAUTH_DEBUG=1)",
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
    path("api/debug/oauth/", oauth_debug_config),
    path("api/fhir/patient/", proxy_patient),
    path("api/fhir/coverage/", proxy_coverage),
    path("api/fhir/encounter/", proxy_encounter),
    path("api/fhir/eob/", proxy_eob),
    path("api/drugs/", proxy_dailymed),
]

