"""Application Modal de la couche 2 de Veritas : inférence GPU à la demande (ADR-0008).

Aucun GPU permanent : un conteneur démarre à la première requête et s'arrête après
SCALEDOWN_SECONDS sans activité. Les poids sont lus dans le volume des modèles, écrit par
l'entraînement (ml/train/pipeline.py).

Déploiement : modal deploy services/veritas/modal/encoder_app.py
"""

import modal

SCALEDOWN_SECONDS = 120
MODELS = "/models"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("torch==2.8.0", "transformers==4.57.1", "sentencepiece==0.2.1", "protobuf==6.33.0")
    .add_local_python_source("veritas")
)
volume = modal.Volume.from_name("altydetect-veritas-models", create_if_missing=True)
app = modal.App("altydetect-veritas-encoder", image=image)


@app.cls(gpu="L4", volumes={MODELS: volume}, scaledown_window=SCALEDOWN_SECONDS, timeout=300)
class Encoder:
    reference: str = modal.parameter()

    @modal.enter()
    def load(self) -> None:
        from veritas.engine.torch_encoder import TorchEncoder

        self.encoder = TorchEncoder(f"{MODELS}/{self.reference}/encoder")

    @modal.method()
    def logits(self, passages: list[str]) -> list[float]:
        return self.encoder.logits(passages)
