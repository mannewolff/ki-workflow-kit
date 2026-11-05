Prüfe das Material auf diese Angriffsklassen:
- `fremder-text-steuert`: Wo das Projekt Sprachmodelle hat, die fremden Text als Anweisung lesen.
- `befehl-aus-text`: Wo das Projekt Befehle oder Pfade aus fremdem Text hat.
- `oberflaeche-rechte`: Wo das Projekt eine Oberfläche mit Rechten auf dem Rechner hat.
- `zugangsschluessel`: Wo das Projekt Zugangsschlüssel hat: in Ausgaben, Protokollen, bei falschen Empfängern?
- `auslieferung`: Wo das Projekt Auslieferung oder Abhängigkeiten hat, die fremden Code bringen.

Je Fund ein Block:
- Schweregrad KRITISCH / WICHTIG / HINWEIS als fette Kopfzeile
- Angreifer: <wer>
- Grenze: <überschrittene Vertrauensgrenze>
- Folge: <beobachtbare Wirkung>
- Angriffsklasse: <kennung>
- Fundstelle: <datei>[:<zeile>], Problem, Behebung
- Gegenprobe: <was den Fund widerlegte> — geprüft, bestätigt
- Art: sicherheit, sonst ein Name aus:
{{ARTEN}}
KRITISCH oder WICHTIG nur mit Angreifer, Grenze und Folge, sonst HINWEIS mit „— nicht geprüft“.

Findest du nichts, schreibe das hin.

Herkunft: sinngemäß nach `cloudflare/security-audit-skill` (https://github.com/cloudflare/security-audit-skill), MIT-Lizenz.

--- REVIEW-MATERIAL ---
{{REVIEW_MATERIAL}}
<!-- SPDX-License-Identifier: MIT -->
