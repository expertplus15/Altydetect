"""Couche 2 : affinage d'un encodeur (CamemBERT pour le français, DeBERTa-v3 pour l'anglais).
Exécuté seulement sur un GPU Modal ; PyTorch et Transformers n'existent que dans cette image."""

import math
import random
from dataclasses import dataclass
from typing import Any

BASE_MODELS = {"fr": "almanach/camembert-base", "en": "microsoft/deberta-v3-base"}
# FR 0.6 (ADR-0015) : encodeur large (≈ 335 M de paramètres, licence MIT).
LARGE_MODELS = {"fr": "almanach/camembert-large"}
# Runs entraînés avec l'encodeur large.
LARGE_RUNS = frozenset({"v6"})


@dataclass(frozen=True)
class EncoderSettings:
    """Réglages de la couche 2. Lots de `batch_size` textes, gradient accumulé sur
    `accumulation` lots : lot effectif de batch_size fois accumulation."""

    base_model: str
    learning_rate: float = 2e-5
    batch_size: int = 16
    accumulation: int = 1


def encoder_settings(run: str, language: str) -> EncoderSettings:
    """Réglages de 0.1 à 0.5 : encodeur base, taux 2e-5, lots de 16. FR 0.6 (ADR-0015) :
    encodeur large, taux 1e-5 (plus stable pour un encodeur large), lots de 8 accumulés sur
    2 pas : même lot effectif de 16, dans la mémoire d'un L4."""
    if run in LARGE_RUNS and language in LARGE_MODELS:
        return EncoderSettings(
            LARGE_MODELS[language], learning_rate=1e-5, batch_size=8, accumulation=2
        )
    return EncoderSettings(BASE_MODELS[language])


def optimizer_steps(samples: int, settings: EncoderSettings, epochs: int) -> int:
    """Pas de l'optimiseur (et de la planification du taux) sur tout l'entraînement."""
    per_epoch = math.ceil(samples / settings.batch_size)
    return epochs * math.ceil(per_epoch / settings.accumulation)


def fine_tune(
    language: str,
    samples: list[tuple[str, int]],
    out_dir: str,
    epochs: int = 2,
    settings: EncoderSettings | None = None,
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

    settings = settings or EncoderSettings(BASE_MODELS[language])
    batch_size, accumulation = settings.batch_size, settings.accumulation
    rng = random.Random(seed)
    torch.manual_seed(seed)
    base = settings.base_model
    tokenizer = AutoTokenizer.from_pretrained(base)
    model = AutoModelForSequenceClassification.from_pretrained(base, num_labels=2).to("cuda")
    optimizer = torch.optim.AdamW(model.parameters(), lr=settings.learning_rate, weight_decay=0.01)
    steps = optimizer_steps(len(samples), settings, epochs)
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
        starts = range(0, len(order), batch_size)
        for n, i in enumerate(starts, start=1):
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
            (loss / accumulation).backward()
            losses.append(float(loss))
            # Pas de l'optimiseur tous les `accumulation` lots, et au dernier lot de l'époque.
            if n % accumulation and n != len(starts):
                continue
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            optimizer.zero_grad()
    model.save_pretrained(out_dir)
    tokenizer.save_pretrained(out_dir)
    tail = losses[-100:] or [0.0]
    return {
        "base_model": base,
        "steps": steps,
        "learning_rate": settings.learning_rate,
        "batch_size": batch_size,
        "accumulation": accumulation,
        "final_loss": sum(tail) / len(tail),
        "label_smoothing": label_smoothing,
        "balanced": balanced,
    }
