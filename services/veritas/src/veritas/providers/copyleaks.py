"""Copyleaks, détecteur de texte IA synchrone (fournisseur de repli proposé par ADR-0001).

1. POST https://id.copyleaks.com/v3/account/login/api {"email", "key"} → access_token (48 h).
2. POST https://api.copyleaks.com/v2/writer-detector/{scanId}/check {"text", "sandbox"}.
Réponse utilisée : summary.ai (document) et results[] (classification 1 = humain, 2 = IA,
probability, matches[].text.chars.starts / lengths en caractères).
"""

import secrets
import time
from typing import Any

import httpx2

from veritas.providers.base import ProviderError, RawDetection, ScoredSpan, clamp

AI_CLASSIFICATION = 2


class CopyleaksProvider:
    name = "copyleaks"
    LOGIN = "https://id.copyleaks.com/v3/account/login/api"
    CHECK = "https://api.copyleaks.com/v2/writer-detector/{scan_id}/check"
    # Le jeton vaut 48 h ; on le renouvelle bien avant.
    TOKEN_TTL_SECONDS = 3600

    def __init__(
        self,
        email: str,
        api_key: str,
        client: httpx2.Client | None = None,
        sandbox: bool = False,
    ) -> None:
        self._email = email
        self._key = api_key
        self._client = client or httpx2.Client(timeout=30.0)
        self._sandbox = sandbox
        self._token: str | None = None
        self._token_at = 0.0

    def _access_token(self) -> str:
        if self._token is None or time.monotonic() - self._token_at > self.TOKEN_TTL_SECONDS:
            response = self._client.post(self.LOGIN, json={"email": self._email, "key": self._key})
            response.raise_for_status()
            self._token = str(response.json()["access_token"])
            self._token_at = time.monotonic()
        return self._token

    def detect(self, text: str, language: str) -> RawDetection:
        scan_id = f"alty-{secrets.token_hex(8)}"
        try:
            body: dict[str, Any] = {"text": text, "sandbox": self._sandbox}
            if language in ("fr", "en"):
                body["language"] = language
            response = self._client.post(
                self.CHECK.format(scan_id=scan_id),
                json=body,
                headers={"Authorization": f"Bearer {self._access_token()}"},
            )
            if response.status_code == httpx2.codes.UNAUTHORIZED:
                self._token = None
            response.raise_for_status()
            data: dict[str, Any] = response.json()
            probability = clamp(data["summary"]["ai"])
            spans: list[ScoredSpan] = []
            for result in data.get("results", []):
                p = clamp(result.get("probability", 0.5))
                p_ai = p if result.get("classification") == AI_CLASSIFICATION else 1 - p
                for match in result.get("matches", []):
                    chars = match["text"]["chars"]
                    for start, length in zip(chars["starts"], chars["lengths"], strict=True):
                        spans.append(ScoredSpan(int(start), int(start) + int(length), p_ai))
        except (httpx2.HTTPError, KeyError, TypeError, ValueError) as error:
            raise ProviderError(f"copyleaks : {type(error).__name__}") from error
        return RawDetection(self.name, probability, tuple(spans))
