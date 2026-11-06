"""Textes sources du jeu de test plagiat, rédigés pour AltyDetect (licence CC0).

Chaque source est une « page web » du corpus simulé ; les cas de test en copient des passages.
"""

SOURCES: dict[str, tuple[str, str]] = {
    "https://revue-pedagogie.example/evaluation-formative": (
        "L'évaluation formative au collège",
        "L'évaluation formative transforme la relation des élèves à l'erreur. Dans les classes "
        "observées, les enseignants donnent un retour régulier et précis, ce qui permet à chacun "
        "de corriger ses méthodes avant l'examen final. Les résultats montrent un gain moyen de "
        "trente-deux pour cent sur l'année scolaire, avec un effet plus marqué chez les élèves "
        "qui rencontraient des difficultés en début de trimestre.",
    ),
    "https://climat-info.example/glaciers-alpins": (
        "Le recul des glaciers alpins",
        "Les glaciers alpins ont perdu près de la moitié de leur volume depuis le milieu du "
        "vingtième siècle. Les relevés effectués chaque automne montrent une accélération nette "
        "de la fonte depuis deux décennies, liée à des étés plus chauds et à des hivers moins "
        "enneigés. Les communes de montagne adaptent déjà leurs ressources en eau potable et "
        "leurs activités touristiques à cette évolution rapide du paysage.",
    ),
    "https://histoire-france.example/canal-du-midi": (
        "Le canal du Midi",
        "Construit au dix-septième siècle sous la direction de Pierre-Paul Riquet, le canal du "
        "Midi relie Toulouse à la mer Méditerranée sur plus de deux cent quarante kilomètres. "
        "Son système d'alimentation en eau, conçu à partir des rivières de la Montagne Noire, "
        "reste considéré comme une prouesse technique remarquable pour son époque. Le canal est "
        "inscrit au patrimoine mondial de l'humanité depuis la fin du vingtième siècle.",
    ),
    "https://sante-publique.example/sommeil-adolescents": (
        "Le sommeil des adolescents",
        "Les adolescents dorment en moyenne une heure et demie de moins que ce que recommandent "
        "les spécialistes du sommeil. L'usage des écrans en soirée retarde l'endormissement et "
        "réduit la qualité du repos, ce qui se traduit par une baisse de la concentration en "
        "classe le lendemain. Plusieurs établissements expérimentent un début des cours plus "
        "tardif afin de mieux respecter le rythme biologique des élèves.",
    ),
    "https://economie-locale.example/circuits-courts": (
        "Les circuits courts alimentaires",
        "Les circuits courts permettent aux producteurs agricoles de vendre directement leurs "
        "produits aux consommateurs, sans intermédiaire ou avec un seul intermédiaire. Cette "
        "organisation améliore la rémunération des agriculteurs et renforce le lien entre la "
        "ville et la campagne environnante. Les marchés de producteurs et les paniers "
        "hebdomadaires se sont fortement développés dans les communes moyennes ces dernières années.",
    ),
    "https://numerique.example/donnees-personnelles": (
        "Protéger ses données personnelles",
        "Le règlement général sur la protection des données impose aux entreprises d'expliquer "
        "clairement quelles informations elles collectent et dans quel but. Chaque personne peut "
        "demander à consulter, corriger ou supprimer les données qui la concernent, et une "
        "autorité de contrôle veille au respect de ces droits. Les sanctions financières prévues "
        "en cas de manquement grave peuvent atteindre plusieurs millions d'euros.",
    ),
    "https://litterature.example/roman-epistolaire": (
        "Le roman épistolaire",
        "Le roman épistolaire raconte une histoire à travers une suite de lettres échangées entre "
        "les personnages. Ce genre, très apprécié au dix-huitième siècle, donne au lecteur "
        "l'impression d'accéder directement à l'intimité des protagonistes. La multiplicité des "
        "points de vue permet à l'auteur de jouer sur les malentendus et sur ce que chacun "
        "choisit de dire ou de taire.",
    ),
    "https://science-daily.example/urban-heat-islands": (
        "Urban heat islands",
        "Cities are often several degrees warmer than the surrounding countryside, a phenomenon "
        "known as the urban heat island. Dark roofs, asphalt roads and the lack of vegetation "
        "absorb heat during the day and release it slowly at night. Planting trees and painting "
        "roofs in light colours are among the most effective ways to reduce summer temperatures "
        "in dense neighbourhoods.",
    ),
    "https://business-review.example/remote-work-productivity": (
        "Remote work and productivity",
        "Studies of remote work show that productivity depends less on location than on the "
        "clarity of goals and the quality of communication within the team. Employees who "
        "receive regular feedback and clear priorities tend to perform as well at home as in "
        "the office. However, newcomers often struggle to build relationships and learn informal "
        "rules when most of their colleagues work remotely.",
    ),
    "https://history-today.example/printing-press": (
        "The printing press",
        "The invention of the movable type printing press in the fifteenth century dramatically "
        "reduced the cost of producing books. Within a few decades, printed texts spread across "
        "Europe, encouraging literacy and the rapid circulation of new scientific ideas. Many "
        "historians consider this technology one of the main conditions for the religious and "
        "intellectual changes of the following century.",
    ),
    "https://ocean-watch.example/coral-reefs": (
        "Coral reefs under pressure",
        "Coral reefs cover less than one percent of the ocean floor but shelter around a quarter "
        "of all marine species. Rising water temperatures cause coral bleaching, a stress "
        "response in which corals expel the algae that give them both colour and food. Reefs "
        "can recover from a single bleaching event, but repeated episodes leave them too little "
        "time to regenerate.",
    ),
    "https://learning-lab.example/spaced-repetition": (
        "Spaced repetition",
        "Spaced repetition is a learning technique in which information is reviewed at "
        "increasing intervals over time. Each review takes place just before the learner is "
        "likely to forget, which strengthens long-term memory far more than intensive cramming "
        "the night before an exam. Language learners and medical students widely use flashcard "
        "applications built on this principle.",
    ),
}

# Phrases originales sans rapport avec les sources (remplissage et cas négatifs).
FILLER_FR = [
    "Ce travail présente une réflexion personnelle construite à partir de lectures variées et d'observations de terrain.",
    "Nous avons choisi ce sujet parce qu'il touche directement la vie quotidienne de nombreux habitants de notre région.",
    "La méthode retenue combine des entretiens courts, quelques mesures simples et une analyse des documents disponibles.",
    "Plusieurs limites doivent être signalées, notamment la taille réduite de l'échantillon et la durée limitée de l'étude.",
    "En conclusion, ces premiers éléments invitent à prolonger l'enquête sur une période plus longue et avec d'autres partenaires.",
    "Les participants ont accepté de répondre librement, sans contrepartie, ce qui mérite d'être souligné et remercié.",
]
FILLER_EN = [
    "This essay offers a personal reflection based on a range of readings and some direct observation.",
    "We chose this topic because it affects the daily life of many people in our area in very concrete ways.",
    "The approach combines short interviews, a few simple measurements and a review of the available documents.",
    "Several limitations should be noted, in particular the small sample and the short duration of the study.",
    "In conclusion, these first findings suggest extending the inquiry over a longer period and with other partners.",
    "The participants agreed to answer freely and without any reward, which deserves to be acknowledged here.",
]

# Retouches légères (synonymes, tournures) appliquées aux passages copiés.
LIGHT_EDITS = {
    "régulier et précis": "fréquent et détaillé",
    "près de la moitié": "environ la moitié",
    "considéré comme": "vu comme",
    "en moyenne": "globalement",
    "directement": "sans détour",
    "clairement": "de façon claire",
    "très apprécié": "fort prisé",
    "several degrees": "a few degrees",
    "regular feedback": "frequent feedback",
    "dramatically": "sharply",
    "around a quarter": "roughly a quarter",
    "far more": "much more",
}

# Paraphrases fortes, rédigées à la main (mesurées à part : hors de portée d'un alignement exact).
PARAPHRASES = {
    "https://climat-info.example/glaciers-alpins": (
        "Depuis les années cinquante, les glaciers des Alpes ont fondu d'environ cinquante pour cent, "
        "et le phénomène s'est accéléré ces vingt dernières années à cause d'étés chauds et de neige rare."
    ),
    "https://science-daily.example/urban-heat-islands": (
        "Because asphalt and dark rooftops store warmth by day and give it back after sunset, "
        "towns stay hotter than nearby fields, so greening streets and lightening roofs helps a lot."
    ),
}
