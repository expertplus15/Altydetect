"""Client de la couche 2 déployée sur Modal (GPU à la demande, mis à l'échelle jusqu'à zéro).

Le service Veritas (CPU) appelle la classe Encoder de l'application Modal
« altydetect-veritas-encoder » (services/veritas/modal/encoder_app.py) avec la référence du
modèle. Identifiants : MODAL_TOKEN_ID et MODAL_TOKEN_SECRET.
"""

from typing import Any

APP_NAME = "altydetect-veritas-encoder"
CLASS_NAME = "Encoder"


class ModalEncoder:
    def __init__(self, reference: str, app: str = APP_NAME, cls: str = CLASS_NAME) -> None:
        self._reference = reference
        self._app = app
        self._cls = cls
        self._instance: Any = None

    def logits(self, passages: list[str]) -> list[float]:
        if self._instance is None:
            import modal

            self._instance = modal.Cls.from_name(self._app, self._cls)(reference=self._reference)
        return [float(x) for x in self._instance.logits.remote(passages)]
