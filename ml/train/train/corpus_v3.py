"""Corpus de Veritas FR 0.3 (ADR-0012) : le corpus 0.2 français enrichi de textes humains de
registre soutenu (universitaire, juridique) et d'autant de textes générés dans les mêmes
registres par les modèles ouverts d'ADR-0011.

Fonctions pures (aucun réseau, aucun GPU) ; les appels Modal sont dans ml/train/pipeline.py.

Règles :
- textes humains antérieurs au 30/06/2022 (avant les assistants grand public) ;
- licences autorisant la réutilisation commerciale seulement, vérifiées document par document ;
- Wikipédia jamais utilisée : elle reste la mesure indépendante du registre encyclopédique
  dans detection-v2 ;
- un texte généré par texte humain, même sujet, même genre ; il suit la partition de son texte
  humain ; Phi-3.5-mini (générateur inconnu de detection-v2) n'est jamais utilisé ;
- la partition test (200 textes humains et 200 générés par registre) forme le jeu gelé
  detection-v3/fr, rangé à part : elle n'entre ni dans l'entraînement ni dans detection-v1.
"""

import re
from collections.abc import Sequence
from typing import Any

from corpus.clean import MAX_WORDS, MIN_WORDS, count_words, fingerprint
from corpus.manifest import assign_split
from detection.robustness import clean_generation

from train.corpus_v2 import (
    BY_LANGUAGE,
    GATES,
    OPEN_GENERATORS,
    OPEN_LICENCES,
    SEEN,
    UNSEEN,
    assign_generator,
    choose,
)

LANGUAGE = "fr"
TESTSET = "detection-v3"
# Avant les assistants grand public (ChatGPT : 30/11/2022), avec une marge.
CUTOFF = "2022-06-30"

# --- Sources (vérifiées le 13/11/2026, ADR-0012) ---

# Articles, thèses et mémoires en accès ouvert (HAL, OpenAlex, DUMAS, TEL), une page par ligne.
# Le dossier « french_open_science » (48 fichiers) ne contient que des licences ouvertes ;
# « hal_open_access » mêle licences libres et droits réservés : écarté.
FSC_BASE = (
    "https://huggingface.co/datasets/PleIAs/French-Science-Commons/resolve/main/french_open_science"
)
FSC_FILES = tuple(f"french_open_science_{n:03d}.parquet" for n in (1, 9, 17, 25, 33, 41))
FSC_COLUMNS = ["id", "page", "language", "license", "publication_date", "source", "doi", "text"]
# Licences autorisant la réutilisation commerciale (formes rencontrées dans le jeu).
ACADEMIC_LICENCES = {
    "cc-by": "CC BY",
    "cc-by/4.0": "CC BY 4.0",
    "cc-by-sa": "CC BY-SA",
    "cc-by-sa/4.0": "CC BY-SA 4.0",
    "cc0": "CC0",
    "etalab-2.0": "Licence ouverte 2.0",
    "pdm": "Domaine public",
}

# Décisions de la Cour de cassation (Judilibre), Licence ouverte 2.0.
JURIS_URL = (
    "https://huggingface.co/datasets/antoinejeannot/jurisprudence/resolve/main/"
    "cour_de_cassation.jsonl.gz"
)
JURIS_FROM = "2005-01-01"  # style de rédaction proche de l'actuel
JURIS_SAMPLE = 25  # une ligne sur 25 lue (≈ 22 000 sur 553 000), tirage stable
JURIS_LICENCE = "Licence ouverte 2.0 (Etalab), Judilibre, via antoinejeannot/jurisprudence"

REGISTERS = ("academic", "legal")
# Par registre : textes humains retenus, dont TEST_SIZE pour detection-v3.
SIZES = {"academic": 1200, "legal": 1200}
TEST_SIZE = 200

Job = tuple[str, str, dict[str, Any], int]  # langue, catégorie, source, mots

# --- Filtres ---


def academic_licence(raw: str | None) -> str | None:
    """Libellé de la licence si elle autorise la réutilisation commerciale, sinon None."""
    return ACADEMIC_LICENCES.get(str(raw or "").strip().lower())


def in_period(date: str | None, start: str = "0000", end: str = CUTOFF) -> bool:
    """Date ISO (ou année seule) comprise dans [start, end] ; inconnue : refusée."""
    value = str(date or "").strip()[:10]
    if not re.fullmatch(r"\d{4}(-\d{2}(-\d{2})?)?", value):
        return False
    return start <= value <= end


# --- Nettoyage ---

_SENTENCE_END = tuple(".!?…»”)")
_MARKUP = re.compile(r"^\s*(#|\||!\[|<|\$\$|\\\[|[-*•\u2013]\s|\d+[.)]\s|\(?[ivxlc]+[.)]\s)", re.I)
_MATH = re.compile(r"\$|\\\(|\\\[|\\[a-z]+\{|\^\{|\[\d+(?:[,\u2013-]\s?\d+)*\]")
_TAG = re.compile(r"<[^<>]{1,120}>")  # appels de note de la reconnaissance (« <fnref n="1" /> »)
_EMPHASIS = re.compile(r"(?<!\w)[*_]{1,3}|[*_]{1,3}(?!\w)")
_HYPHEN = re.compile(r"\b([a-zà-öø-ÿ]{2,})-([a-zà-öø-ÿ]{2,})\b")
# Composés légitimes : un mot coupé en fin de ligne par la mise en page (« com-mence ») est un
# indice propre aux textes numérisés, que le modèle ne doit pas apprendre.
_HYPHEN_SUFFIXES = {
    "ci", "là", "il", "ils", "elle", "elles", "on", "je", "tu", "nous", "vous", "moi", "toi",
    "lui", "leur", "même", "mêmes", "être", "dire", "delà", "dessus", "dessous", "dedans",
    "dehors", "clé", "clés", "type", "types", "cadre", "test", "tests", "faire", "valoir",
}  # fmt: skip
_HYPHEN_PREFIXES = {
    "peut", "au", "sous", "non", "auto", "anti", "inter", "intra", "post", "pré", "semi",
    "multi", "socio", "néo", "micro", "macro", "quasi", "demi", "mi", "ex", "après", "avant",
    "contre", "grand", "grande", "arrière", "ci", "vis", "franco", "gréco", "judéo", "anglo",
    "euro", "afro", "extra", "ultra", "super", "hyper", "sur", "sans", "porte", "garde",
    "savoir", "bien", "mal", "nord", "sud", "est", "ouest", "état", "états", "nouveau",
    "nouvelle", "haut", "bas", "moyen", "trans", "bio", "psycho", "physico", "médico",
    "politico", "technico", "ethno", "géo", "hydro", "électro", "thermo", "photo", "radio",
    "agro", "éco", "cyber", "chef", "arc", "rez", "plus", "moins", "court", "long", "libre",
    "dix", "vingt", "trente", "quarante", "cinquante", "soixante", "quatre", "cent",
}  # fmt: skip


def _suspect_hyphen(text: str) -> bool:
    for left, right in _HYPHEN.findall(text):
        if left.lower() not in _HYPHEN_PREFIXES and right.lower() not in _HYPHEN_SUFFIXES:
            return True
    return False


def _plain(text: str, letters: float = 0.7, digits: float = 0.05) -> bool:
    n = max(len(text), 1)
    return (
        sum(c.isalpha() for c in text) >= letters * n
        and sum(c.isdigit() for c in text) <= digits * n
    )


def _longest_run(blocks: list[str | None]) -> str | None:
    """Plus longue suite de blocs gardés (None : bloc refusé, qui coupe la suite), tronquée à
    MAX_WORDS par la fin ; None si elle n'atteint pas MIN_WORDS. Une suite contiguë garde un
    texte cohérent : des paragraphes recollés de part et d'autre d'un trou seraient un indice
    propre aux textes humains du corpus."""
    best: list[str] = []
    current: list[str] = []
    for block in [*blocks, None]:
        if block is not None:
            current.append(block)
            continue
        if sum(count_words(b) for b in current) > sum(count_words(b) for b in best):
            best = current
        current = []
    while best and sum(count_words(b) for b in best) > MAX_WORDS:
        best = best[:-1]
    text = "\n\n".join(best)
    return text if count_words(text) >= MIN_WORDS else None


def clean_academic(page: str) -> str | None:
    """Prose d'une page d'article ou de mémoire (Markdown issu de la reconnaissance du PDF) :
    ni titres, ni listes, ni tableaux, ni formules, ni vers, ni notes, ni mots coupés."""
    blocks: list[str | None] = []
    for paragraph in re.split(r"\n\s*\n", page):
        lines = [line.strip() for line in paragraph.strip().splitlines() if line.strip()]
        if not lines or _MARKUP.match(lines[0]) or _MATH.search(paragraph):
            blocks.append(None)
            continue
        if len(lines) > 1 and sum(count_words(line) < 8 for line in lines) > len(lines) / 2:
            blocks.append(None)  # vers, adresses, légendes
            continue
        text = _EMPHASIS.sub("", _TAG.sub("", " ".join(lines)))
        text = " ".join(text.split())
        ok = (
            not re.search(r"[<>^]", text)  # restes de balises ou de formules
            and count_words(text) >= 20
            and text.endswith(_SENTENCE_END)
            and _plain(text)
            and not _suspect_hyphen(text)
        )
        blocks.append(text if ok else None)
    return _longest_run(blocks)


_LEGAL_HEADER = re.compile(
    r"^(la cour|statuant|avocat|greffier|sur le rapport|vu |par ces motifs|ainsi fait|"
    r"président|composée|en présence|après en avoir|rejette|casse|condamne|dit n'y avoir|"
    r"moyens? annexés?|réponse de la cour|faits et procédure|examen du moyen|énoncé du moyen)",
    re.I,
)
# Parties anonymisées : « M. Y... », « [K] », « [Adresse 1] ».
_ANONYMIZED = re.compile(r"\b[A-Z]\.\.\.|\[[^\]]{1,40}\]")
_LEGAL_NUMBER = re.compile(r"^\d{1,3}\.\s+")


def clean_legal(text: str) -> str | None:
    """Passage des motifs d'un arrêt : lignes de prose juridique contiguës, sans en-têtes, sans
    citations de l'arrêt attaqué ni des moyens, sans partie anonymisée, sans numéro de
    paragraphe."""
    blocks: list[str | None] = []
    for raw in text.splitlines():
        # « 706¿96 » : trait d'union mal décodé dans la source.
        line = _LEGAL_NUMBER.sub("", " ".join(raw.replace("¿", "-").split()))
        ok = (
            count_words(line) >= 12
            and line.endswith((".", ";", ":", "»"))
            and not line.startswith(('"', "“", "«", "'"))
            and not _LEGAL_HEADER.match(line)
            and not _ANONYMIZED.search(line)
            and _plain(line, digits=0.08)
            and "\ufffd" not in line
        )
        blocks.append(line if ok else None)
    return _longest_run(blocks)


# --- Documents ---

_NBSP = re.compile(r"[\u00a0\u202f]")


def match_typography(text: str, reference: str) -> str:
    """Donne au texte généré la typographie de son texte humain apparié : apostrophe droite ou
    courbe, espaces insécables ou non. Les modèles écrivent presque toujours « ' » et des
    espaces simples, les PDF « ’ » et des espaces insécables : sans cet alignement, le modèle
    apprendrait la typographie au lieu du style."""
    if reference.count("’") > reference.count("'"):
        text = text.replace("'", "’")
    else:
        text = text.replace("’", "'")
    if _NBSP.search(reference):
        space = max("\u00a0\u202f", key=reference.count)
        text = re.sub(r" ([;:!?»])", lambda m: space + m.group(1), text).replace("« ", "«" + space)
    else:
        text = _NBSP.sub(" ", text)
    return text


def human_document(
    register: str, text: str, source: str, url: str, licence: str, date: str
) -> dict[str, Any]:
    digest = fingerprint(text)
    return {
        "id": f"h-{LANGUAGE}-{digest[:16]}",
        "sha256": digest,
        "label": "human",
        "category": f"human_{register}",
        "register": register,
        "language": LANGUAGE,
        "text": text,
        "words": count_words(text),
        "source": source,
        "url": url,
        "licence": licence,
        "date": str(date)[:10],
    }


def split_humans(register: str, documents: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """SIZES[register] textes tirés de façon stable, dont TEST_SIZE en partition test (le jeu
    detection-v3) ; les autres en entraînement ou calibration (1 sur 10)."""
    unique = {d["sha256"]: d for d in documents}
    chosen = choose(list(unique.values()), SIZES[register], f"v3-{register}")
    test = {d["id"] for d in choose(chosen, TEST_SIZE, f"v3-{register}-test")}
    out = []
    for d in chosen:
        d = dict(d)
        d["split"] = assign_split(d, test=d["id"] in test)
        out.append(d)
    return sorted(out, key=lambda d: d["id"])


TOPIC_WORDS = 30
PROMPTS = {
    "academic": (
        "Voici le début d'un passage d'article scientifique ou de mémoire universitaire en "
        "français :\n\n« {start} »\n\n"
        "Écris un passage original d'environ {words} mots sur le même sujet et dans le même "
        "genre (registre universitaire ; tu peux citer des travaux au format (Auteur, année)). "
        "Ne recopie pas ce début. Réponds uniquement par le texte, en paragraphes, sans titre, "
        "sans liste ni commentaire."
    ),
    "legal": (
        "Voici le début d'un passage des motifs d'un arrêt de la Cour de cassation :\n\n"
        "« {start} »\n\n"
        "Écris un passage original d'environ {words} mots sur le même sujet et dans le même "
        "genre (motifs d'une décision de justice, style juridique). Désigne les personnes par "
        "leur qualité (le salarié, la société, le demandeur), jamais par un nom. Ne recopie pas "
        "ce début. Réponds uniquement par le texte, en paragraphes, sans titre, sans liste ni "
        "commentaire."
    ),
}


def prompt(job: Job) -> str:
    _, _, source, _ = job
    start = " ".join(str(source["text"]).split()[:TOPIC_WORDS])
    target = max(150, round(int(source["words"]) / 50) * 50)
    return PROMPTS[source["register"]].format(start=start, words=target)


def plan_jobs(humans: Sequence[dict[str, Any]]) -> dict[str, list[Job]]:
    """Une consigne par texte humain, partition test comprise (detection-v3 a besoin de textes
    générés), réparties uniformément entre les générateurs français d'ADR-0011."""
    jobs: dict[str, list[Job]] = {key: [] for key in BY_LANGUAGE[LANGUAGE]}
    for h in humans:
        key = assign_generator(f"{h['id']}/v3", LANGUAGE)
        jobs[key].append((LANGUAGE, f"ai_{h['register']}", h, int(h["words"])))
    return jobs


def generated_document(job: Job, generator: str, raw: str) -> dict[str, Any] | None:
    """Texte généré nettoyé (comme en 0.2), ou None s'il est inutilisable."""
    _, category, source, _ = job
    text = clean_generation(raw)
    if text is None:
        return None
    text = match_typography(text, str(source["text"]))
    digest = fingerprint(text)
    name = OPEN_GENERATORS[generator]
    document: dict[str, Any] = {
        "id": f"f-{LANGUAGE}-{digest[:16]}",
        "sha256": digest,
        "label": "ai",
        "category": category,
        "register": source["register"],
        "language": LANGUAGE,
        "text": text,
        "words": count_words(text),
        "generator": name,
        "source": f"generated:{name}",
        "licence": f"Généré par {name} ({OPEN_LICENCES[generator]})",
        "paired_with": source["id"],
        "derived_from": source["id"],
    }
    document["split"] = assign_split(document, test=source["split"] == "test")
    return document


# --- Portes de sortie (ADR-0012 : celles d'ADR-0011, detection-v3 en plus) ---

V3_AI = ("ai_academic", "ai_legal")


def check_gates(v1: dict[str, Any], v2: dict[str, Any], v3: dict[str, Any]) -> dict[str, Any]:
    """`v1` : detection_metrics sur detection-v1 ; `v2`, `v3` : category_report sur
    detection-v2 et detection-v3. Faux positifs sur tous les textes humains des trois jeux ;
    « générateurs vus » : catégories vues de detection-v2 et textes générés de detection-v3."""

    def rows(report: dict[str, Any], categories: Sequence[str]) -> list[dict[str, Any]]:
        return [
            report[c] for c in categories if report.get(c) and report[c]["likely_ai"] is not None
        ]

    def recall(selected: list[dict[str, Any]]) -> float:
        total = sum(r["documents"] - r["errors"] for r in selected)
        hits = sum(r["likely_ai"] * (r["documents"] - r["errors"]) for r in selected)
        return round(hits / total, 4) if total else 0.0

    humans = [
        (v1["false_positive_rate"], v1["documents"]["human"]),
        (v2["_overall"]["false_positive_rate"] or 0.0, v2["_overall"]["humans"]),
        (v3["_overall"]["false_positive_rate"] or 0.0, v3["_overall"]["humans"]),
    ]
    fp = sum(rate * n for rate, n in humans) / max(sum(n for _, n in humans), 1)
    wikipedia = v2.get("human_wikipedia", {}).get("likely_ai")
    measured = {
        "false_positive_rate": round(fp, 4),
        "false_positive_rate_wikipedia": wikipedia,
        "false_positive_rate_v3": v3["_overall"]["false_positive_rate"],
        "recall_claude": round(v1["recall"], 4),
        "recall_seen": recall(rows(v2, SEEN) + rows(v3, V3_AI)),
        "recall_unseen": recall(rows(v2, UNSEEN)),
    }
    checks = {
        "false_positive_rate": measured["false_positive_rate"] <= GATES["max_false_positive_rate"],
        "recall_claude": measured["recall_claude"] >= GATES["min_recall_claude"],
        "recall_seen": measured["recall_seen"] >= GATES["min_recall_seen"],
        "recall_unseen": measured["recall_unseen"] >= GATES["min_recall_unseen"],
    }
    return {"gates": GATES, "measured": measured, "checks": checks, "passed": all(checks.values())}


def sample_line(line: bytes, every: int = JURIS_SAMPLE) -> bool:
    """Tirage stable d'une ligne sur `every` (même sélection d'un run à l'autre)."""
    import zlib

    return zlib.crc32(line) % every == 0
