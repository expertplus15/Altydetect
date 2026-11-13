"""Couche 2 : affinage d'un encodeur (CamemBERT pour le français, DeBERTa-v3 pour l'anglais).
Exécuté seulement sur un GPU Modal ; PyTorch et Transformers n'existent que dans cette image."""

import math
import random
from typing import Any

BASE_MODELS = {"fr": "almanach/camembert-base", "en": "microsoft/deberta-v3-base"}


def fine_tune(
    language: str,
    samples: list[tuple[str, int]],
    out_dir: str,
    epochs: int = 2,
    learning_rate: float = 2e-5,
    batch_size: int = 16,
    seed: int = 0,
    label_smoothing: float = 0.0,
    balanced: bool = False,
) -> dict[str, Any]:
    """`label_smoothing` et `balanced` (poids des classes inverses de leurs effectifs) : Veritas
    0.2, contre des probabilités trop tranchées et le déséquilibre humains / générés. Valeurs
    par défaut : comportement de 0.1, inchangé."""
    import torch
    from transformers import (
        AutoModelForSequenceClassification,
        AutoTokenizer,
        get_linear_schedule_with_warmup,
    )
    from veritas.engine.torch_encoder import MAX_LENGTH

    rng = random.Random(seed)
    torch.manual_seed(seed)
    base = BASE_MODELS[language]
    tokenizer = AutoTokenizer.from_pretrained(base)
    model = AutoModelForSequenceClassification.from_pretrained(base, num_labels=2).to("cuda")
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=0.01)
    steps = epochs * math.ceil(len(samples) / batch_size)
    weights = None
    if balanced:
        positives = sum(y for _, y in samples)
        negatives = len(samples) - positives
        weights = torch.tensor(
            [len(samples) / (2 * max(negatives, 1)), len(samples) / (2 * max(positives, 1))],
            device="cuda",
        )
    scheduler = get_linear_schedule_with_warmup(optimizer, int(0.06 * steps), steps)

    model.train()
    losses: list[float] = []
    for _ in range(epochs):
        order = samples[:]
        rng.shuffle(order)
        for i in range(0, len(order), batch_size):
            batch = order[i : i + batch_size]
            encoded = tokenizer(
                [t for t, _ in batch],
                truncation=True,
                max_length=MAX_LENGTH,
                padding=True,
                return_tensors="pt",
            ).to("cuda")
            labels = torch.tensor([y for _, y in batch], device="cuda")
            with torch.autocast("cuda", dtype=torch.bfloat16):
                logits = model(**encoded).logits
            loss = torch.nn.functional.cross_entropy(
                logits.float(), labels, weight=weights, label_smoothing=label_smoothing
            )
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            optimizer.zero_grad()
            losses.append(float(loss))
    model.save_pretrained(out_dir)
    tokenizer.save_pretrained(out_dir)
    tail = losses[-100:] or [0.0]
    return {
        "base_model": base,
        "steps": steps,
        "final_loss": sum(tail) / len(tail),
        "label_smoothing": label_smoothing,
        "balanced": balanced,
    }
