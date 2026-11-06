"""Couche 2 en PyTorch : logits d'un encodeur affiné (CamemBERT, DeBERTa).

Code d'inférence unique, utilisé par l'évaluation de l'entraînement et par l'application Modal
déployée (services/veritas/modal/encoder_app.py). PyTorch et Transformers ne sont installés que
dans les images Modal : jamais dans le service CPU.
"""

from typing import Any

MAX_LENGTH = 512


class TorchEncoder:
    def __init__(self, model_dir: str, device: str = "cuda", batch_size: int = 32) -> None:
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        self._torch = torch
        self._device = device
        self._batch_size = batch_size
        self.tokenizer: Any = AutoTokenizer.from_pretrained(model_dir)
        self.model: Any = AutoModelForSequenceClassification.from_pretrained(model_dir)
        self.model.to(device).eval()

    def logits(self, passages: list[str]) -> list[float]:
        """Un logit par passage : logit(IA) moins logit(humain)."""
        torch = self._torch
        out: list[float] = []
        for i in range(0, len(passages), self._batch_size):
            batch = passages[i : i + self._batch_size]
            encoded = self.tokenizer(
                batch, truncation=True, max_length=MAX_LENGTH, padding=True, return_tensors="pt"
            ).to(self._device)
            with torch.no_grad(), torch.autocast(self._device, dtype=torch.bfloat16):
                scores = self.model(**encoded).logits.float()
            out.extend((scores[:, 1] - scores[:, 0]).tolist())
        return out
