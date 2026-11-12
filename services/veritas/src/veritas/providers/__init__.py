"""Fournisseurs de détection externes, derrière l'interface DetectionProvider (CLAUDE.md §4.3).

Le fournisseur actif se choisit par DETECTION_PROVIDER, le repli par
DETECTION_FALLBACK_PROVIDER. Ajouter un fournisseur ne touche que ce dossier : une classe, et
une entrée dans _FACTORIES.
"""

import os
from collections.abc import Callable, Mapping

from veritas.providers.base import (
    DetectionProvider,
    Fractions,
    ProviderError,
    ProviderNotConfiguredError,
    RawDetection,
    ScoredSpan,
)
from veritas.providers.copyleaks import CopyleaksProvider
from veritas.providers.gptzero import GPTZeroProvider
from veritas.providers.pangram import DEFAULT_MODEL, PangramProvider
from veritas.providers.simulated import SimulatedProvider

__all__ = [
    "DetectionProvider",
    "Fractions",
    "ProviderError",
    "ProviderNotConfiguredError",
    "RawDetection",
    "ScoredSpan",
    "external_providers_from_env",
    "provider_from_name",
]


def _required(env: Mapping[str, str], name: str) -> str:
    value = env.get(name)
    if not value:
        raise ProviderNotConfiguredError(f"{name} manquante : voir .env.example")
    return value


def _simulated(env: Mapping[str, str]) -> DetectionProvider:
    if env.get("VERITAS_ALLOW_SIMULATED") != "1" or env.get("VERITAS_ENV") == "production":
        raise ProviderNotConfiguredError("fournisseur simulé refusé (VERITAS_ALLOW_SIMULATED)")
    return SimulatedProvider()


_FACTORIES: dict[str, Callable[[Mapping[str, str]], DetectionProvider]] = {
    "pangram": lambda env: PangramProvider(
        _required(env, "PANGRAM_API_KEY"), model=env.get("PANGRAM_MODEL") or DEFAULT_MODEL
    ),
    "copyleaks": lambda env: CopyleaksProvider(
        _required(env, "COPYLEAKS_EMAIL"), _required(env, "COPYLEAKS_API_KEY")
    ),
    "gptzero": lambda env: GPTZeroProvider(_required(env, "GPTZERO_API_KEY")),
    "simulated": _simulated,
}


def provider_from_name(name: str, env: Mapping[str, str] | None = None) -> DetectionProvider:
    factory = _FACTORIES.get(name)
    if factory is None:
        raise ProviderNotConfiguredError(f"fournisseur de détection inconnu : {name!r}")
    return factory(os.environ if env is None else env)


def external_providers_from_env(env: Mapping[str, str] | None = None) -> list[DetectionProvider]:
    """Fournisseur principal puis repli, dans l'ordre ; vide si aucun n'est configuré."""
    env = os.environ if env is None else env
    names = [env.get("DETECTION_PROVIDER", ""), env.get("DETECTION_FALLBACK_PROVIDER", "")]
    return [provider_from_name(name, env) for name in dict.fromkeys(n for n in names if n)]
