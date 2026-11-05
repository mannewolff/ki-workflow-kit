<!-- de: 5c3bbbc885fb -->
Check the material for these attack classes:
- `fremder-text-steuert`: Where the project has language models that read foreign text as instructions.
- `befehl-aus-text`: Where the project has commands or paths built from foreign text.
- `oberflaeche-rechte`: Where the project has a user interface with rights on the machine.
- `zugangsschluessel`: Where the project has access keys: in output, logs, with the wrong recipients?
- `auslieferung`: Where the project has delivery or dependencies that bring in foreign code.

For each finding, one block (the line starts and marks stay German: Angreifer means attacker, Grenze trust boundary, Folge consequence, Angriffsklasse attack class, Fundstelle location):
- Severity KRITISCH / WICHTIG / HINWEIS as a bold header line
- Angreifer: <who>
- Grenze: <trust boundary crossed>
- Folge: <observable effect>
- Angriffsklasse: <class id>
- Fundstelle: <file>[:<line>], problem, fix
- Counter-check: <what would refute the finding> — checked, confirmed
- Kind: sicherheit, otherwise a name from:
{{ARTEN}}
KRITISCH or WICHTIG only with Angreifer, Grenze and Folge, otherwise HINWEIS with "— nicht geprueft".

If you find nothing, say so.

Origin: adapted from `cloudflare/security-audit-skill` (https://github.com/cloudflare/security-audit-skill), MIT licence.

--- REVIEW-MATERIAL ---
{{REVIEW_MATERIAL}}
<!-- SPDX-License-Identifier: MIT -->
