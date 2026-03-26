from __future__ import annotations

from django.db import models


class PkceSession(models.Model):
    """
    Serverless-safe PKCE storage keyed by OAuth 'state'.

    We intentionally do not use cookies because RN -> browser -> callback flows commonly lose cookies
    due to modern tracking prevention policies, causing state mismatch errors.
    """

    state = models.CharField(max_length=128, primary_key=True)
    code_verifier = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["expires_at"]),
        ]


class TokenExchangeCode(models.Model):
    """
    One-time exchange code to hand tokens to the mobile app without putting tokens in redirect URLs.
    """

    code = models.CharField(max_length=128, primary_key=True)
    token_encrypted_b64 = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["expires_at"]),
            models.Index(fields=["consumed_at"]),
        ]
