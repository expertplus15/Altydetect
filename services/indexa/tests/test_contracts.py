"""Les modèles Pydantic générés acceptent ce que le contrat zod accepte, et refusent le reste."""

import pytest
from pydantic import ValidationError

from indexa.contracts import PlagiarismInput, PlagiarismOutput, PlagiarismTask, Scope


def test_input_valide() -> None:
    value = PlagiarismInput.model_validate(
        {"text": "Bonjour", "scope": "both", "workspace_id": "u1"}
    )
    assert value.scope is Scope.both


@pytest.mark.parametrize(
    "payload",
    [{"text": "", "scope": "web"}, {"text": "x", "scope": "partout"}, {"scope": "web"}],
)
def test_input_invalide(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        PlagiarismInput.model_validate(payload)


def test_tache_terminee_avec_resultat() -> None:
    task = PlagiarismTask.model_validate(
        {
            "task_id": "t1",
            "status": "done",
            "progress": 1,
            "result": {
                "similarity": 0.18,
                "matches": [
                    {
                        "start": 0,
                        "end": 10,
                        "source_url": "https://ex.fr",
                        "excerpt": "…",
                        "score": 1,
                    }
                ],
                "engine": "IDX-WEB-1.0",
            },
        }
    )
    assert isinstance(task.result, PlagiarismOutput)
    assert task.result.matches[0].end == 10
