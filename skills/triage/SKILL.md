---
name: triage
description: Talks an idea through with the human: reads the idea and its attachments, presents all unclear points in one template with recommendations, a summary and a proposed lane with its reason; one yes writes the clarified state into the idea and starts the chosen path without asking again. Use this skill when the user invokes /triage or wants to talk an [Idea] through and bring it onto its lane.
user-invocable: true
---
<!-- SPDX-License-Identifier: MIT -->

# Triage

Eine `[Idea]` auf dem Board sagt oft noch nicht, was sie will. Dieser Skill spricht sie mit dem Menschen durch, bis es klar ist, und bringt sie dann ohne Umweg auf ihre Bahn: Er liest die Idee, ihre Kommentare und die Anhänge aus ihrer Ablage, schreibt die unklaren Punkte als Liste in die Idee und legt sie alle in einer Vorlage vor — jeden mit Empfehlung, dazu Zusammenfassung und Bahnvorschlag mit Begründung. Der Mensch widerspricht nur, wo nötig; sein Ja schreibt den geklärten Stand in die Idee, und der Skill geht ohne weitere Rückfrage den gewählten Weg.

Das Mechanische trägt das Kommando `issue triage`: ob der Ablauf beginnen darf, welche Anhänge die Ablage hat und welche davon die Session liest, welche Punkte schon entschieden sind, welche Bahn gewählt und welches Ergebnis schon angelegt ist, ob ein neuer Body etwas verliert, und der Abschluss der Ablage. Gesprächsführung, Empfehlung und Bahnvorschlag sind Urteil der Session und stehen hier.

**Feste Zeilen.** Überschriften, Marker, Review- und Einarbeitungs-Köpfe und Fundblock-Zeilen, die dieser Skill in Dokumente, Kommentare oder Markerzeilen schreibt, stehen hier deutsch. Vor dem ersten Schreiben `node .claude/kit/board.mjs names` aufrufen: Das Feld `lines` nennt je deutscher Zeile die Fassung der Projektsprache, und der Skill schreibt die ausgegebene Fassung. Eine Zeile mit veränderlichem Rest (`## Einarbeitung, Runde 2`) steht dort mit ihrem festen Anfang, eine Überschrift mit `## ` davor gilt auf jeder Ebene, und was `names` nicht nennt, bleibt, wie es hier steht.

## Ablauf

### 0. Unbeaufsichtigt nicht beginnen

Erster Schritt, vor allem anderen: **Unbeaufsichtigt** (gesetztes, nicht leeres `KIT_AGENT_MODEL`) beginnt der Skill nicht und meldet das — niemand kann antworten, und die Bahn wählt allein der Mensch. An der Idee und ihrer Ablage ändert sich nichts. Dieselbe Bedingung prüft das Kommando und weist mit dem Grund `unbeaufsichtigt` ab.

### 1. Einstieg

`/triage #N` nimmt genau eine Idee.

```bash
node .claude/kit/board.mjs issue triage <N>
```

Die Ausgabe trägt `einstieg` (`start`, `grund`, `meldung`), `ablage` (`pfad`, `vorhanden`, `dateien` je `{ name, gelesen, vorlageZiel, herkunft }`, dazu `anhaenge`, wenn der Aufruf die Anhänge der Karte geladen hat) und `stand` (`punkte`, `offen`, `bahn`, `vorlage`, `ergebnis`). Bei `start: false` meldet der Skill die `meldung` und endet ohne Änderung — eine Karte ohne `[Idea]` (`keine-idee`) oder ein unbeaufsichtigter Lauf (`unbeaufsichtigt`).

Danach liest er die Idee mit ihren Kommentaren:

```bash
node .claude/kit/board.mjs issue get <N>
```

### 2. Anhänge lesen

Jede Idee hat ihre Ablage für Anhänge unter `.claude/ideas/<N>/`. An einer kanban-kit-Karte lädt `issue triage` die Anhänge der Karte selbst dorthin, bevor es die Ablage meldet; die Datei trägt dann `herkunft: "karte"`, eine vom Menschen abgelegte `herkunft: "ablage"`. Liegt schon eine Datei mit demselben Namen in der Ablage, bleibt sie unverändert, und der Anhang wird nicht geladen (`ablage.anhaenge.vorhanden`). Ein Anhang, der sich nicht laden ließ, steht unter `ablage.anhaenge.fehlgeschlagen` mit Namen, Grund und `meldung`; war schon die Liste der Anhänge nicht abrufbar, nennt `ablage.anhaenge.fehler` den Grund. Der Skill führt jeden nicht geladenen Anhang unter „nicht gelesen“ auf, mit seiner `meldung`, und fragt, ob es ohne ihn weitergeht.

Der Skill liest jede Datei mit `gelesen: true` — Bilder, PDFs und Markdown-Dateien — mit seinem Lese-Werkzeug. Eine Datei mit `gelesen: false` liest er nicht, ohne sie umzuwandeln. Zu Beginn nennt er, welche Anhänge er gelesen hat und welche nicht gelesen sind, jede mit Namen.

Fehlt die Ablage oder ist sie leer (`vorhanden: false` oder keine `dateien`), nennt der Skill den Ort `.claude/ideas/<N>/`, an dem Anhänge zu dieser Idee liegen müssen, und fragt, ob es ohne Anhänge weitergeht. An einem Tracker ohne Anhänge (GitHub, GitLab, lokal) gilt: Der Skill legt die Ablage nicht an; legt der Mensch Dateien hinein, beginnt der Skill mit Schritt 1 neu.

### 3. Vorhandener Stand

Trägt die Idee schon einen Abschnitt `## Geklärter Stand`, wurde sie schon einmal durchgesprochen. Der Skill legt den bisherigen Stand vor — die entschiedenen Punkte mit ihrer Antwort, eine gewählte Bahn, eine Vorlage — und setzt bei den offenen Punkten fort (`stand.offen`, die Punkte ohne Antwortzeile). Bestätigte Klärungen und Entscheidungen bleiben, wie sie sind; er fragt sie nicht noch einmal.

Meldet `stand.ergebnis` ein Ergebnis — aus der Ergebnis-Zeile oder aus einem Kommentar `Fortsetzung: …` an der Idee —, ist der gewählte Weg schon begonnen. Dann legt der Skill nichts neu an, sondern setzt bei den offenen Abschlussschritten fort (Schritt 9 bzw. 10): fehlt die Ergebnis-Zeile, schreibt er sie; steht die Ablage noch, ruft er `--finish`; liegt eine Vorlage uncommittet unter `design/ideas/<N>/`, committet er sie.

### 4. Punkte sammeln und in einer Vorlage vorlegen

Der Skill sammelt aus Idee, Kommentaren und Anhängen die Punkte, die unklar sind: was die Idee will, für wen, woran man erkennt, dass sie erfüllt ist, was sie ausdrücklich nicht will. Sobald er sie gesammelt hat, schreibt er die vollständige Punktliste ohne Antwortzeilen in die Idee, als nummerierte Liste unter `## Geklärter Stand` am Ende des Bodys. Ein Punkt ohne Antwortzeile ist offen. Der bisherige Text der Idee bleibt darüber unverändert. Die Liste sichert den Stand bei einem Abbruch; eine Idee gibt keinen Lauf frei.

Danach folgt die Vorlage aller offenen Punkte, nach dem Muster von `/groom` (Schritte 5 bis 8 dort): je Punkt die Empfehlung, ihre Begründung und die fertige Antwortzeile. Ein Punkt, der sich nicht als Frage mit Empfehlung fassen lässt, steht dort als „im Gespräch zu klären“, ohne Empfehlung; der Skill klärt ihn nach dem Ja im freien Gespräch und legt das Ergebnis als Antwort zu diesem Punkt zur Bestätigung vor. In dieselbe Vorlage kommen die Zusammenfassung (Schritt 5), der Bahnvorschlag mit Begründung (Schritt 6) und, wo ein Anhang vorliegt, die Vorlage-Frage mit Empfehlung (Schritt 7). Widerspruch und Zurückstellen gelten je Nummer wie dort; die widersprochenen Punkte verhandelt der Skill danach einzeln nach. Ein im Gespräch neu entstehender Punkt wird an die Liste angehängt.

Die Vorlage endet mit dem Block `kit-vorlage`, geschrieben wie bei `/groom` (Schritt 6 dort), damit die App dieselben Einträge darstellen kann — als Gespräch oder Frage für Frage. Ein Eintrag darf hier zusätzlich `optionen: [{ text, hinweis?, empfohlen? }]` und `art: "frage" | "weg"` tragen. Wo sich eine Antwort als Wahl fassen lässt, stehen Optionen, die empfohlene mit `"empfohlen": true`; eine eigene Antwort bleibt immer möglich. Ein Punkt „im Gespräch zu klären“ steht ohne Optionen und ohne Empfehlung. `art: "frage"` tragen die Punkte und die Vorlage-Frage (Schritt 7), `art: "weg"` trägt genau ein Eintrag: der Bahnvorschlag (Schritt 6). Beide tragen die Nummern nach dem letzten Punkt und stehen nicht in der Punktliste der Idee. Die Texte im Block — Frage, Empfehlung, Begründung, Optionen und Hinweise — sind ohne Begriffe aus der Softwareentwicklung; Maßstab ist die Liste `test/fixtures/entwicklerbegriffe.json`.

````markdown
```json kit-vorlage
[
  { "nr": 2, "art": "frage", "frage": "Für wen ist die Übersicht gedacht?", "empfehlung": "Für das ganze Team", "grund": "Die Idee spricht von allen, die Anfragen bearbeiten.", "einarbeitung": "Die Übersicht ist für das ganze Team gedacht.", "optionen": [{ "text": "Für das ganze Team", "empfohlen": true }, { "text": "Nur für die Leitung", "hinweis": "Dann sehen die anderen sie nicht." }] },
  { "nr": 5, "art": "weg", "frage": "Wie soll es mit der Idee weitergehen?", "empfehlung": "Als Anforderung ausarbeiten", "grund": "Es gibt etwas abzuwägen, und die Idee ändert, was das Team bei der Arbeit erlebt.", "einarbeitung": "Als Anforderung ausarbeiten", "optionen": [{ "text": "Gleich erledigen", "hinweis": "Eine Kleinigkeit, die die KI sofort umsetzt." }, { "text": "Als Aufgabe einplanen", "hinweis": "Klar genug, um sie ohne weiteres Abwägen umzusetzen." }, { "text": "Als Anforderung ausarbeiten", "hinweis": "Die Idee wird beschrieben, geprüft und geklärt, bevor etwas entsteht.", "empfohlen": true }, { "text": "Technisch planen", "hinweis": "Es ändert sich nur das Innere, nicht was jemand bei der Arbeit sieht." }] }
]
```
````

Der Mensch antwortet einmal, in einer Nachricht aus diesen Zeilen: `Zu <n>: <gewählte Option oder eigene Antwort>` je Punkt, an dem er von der Empfehlung abweicht, `<n> zurückstellen` je Punkt, den er offen lässt, und zum Schluss `Ja` oder `Ja, Bahn <wert>` (Schritt 6). Eine Zeile `Zu <n>:` ist seine Antwort zu diesem Punkt und geht mit dem Ja ausgeschrieben als Antwortzeile in den Body; lässt eine eigene Antwort etwas offen, verhandelt der Skill den Punkt danach einzeln nach wie einen Widerspruch. `Zu <n>:` zum Eintrag `art: "weg"` mit einer der vier Optionen wählt dieselbe Bahn wie `Ja, Bahn <wert>`.

Das Ja schreibt alle Antwortzeilen in einem Zug, eingerückt unter ihrem Punkt, in der Form `**Antwort (<Urheber>, <JJJJ-MM-TT>):**` gefolgt vom Inhalt, ausgeschrieben, nie „wie empfohlen“. Mit ihnen gehen Bahn-Zeile und Vorlage-Zeile in den geklärten Stand, und der Skill geht ohne weitere Rückfrage den gewählten Weg (Schritt 8). Der Mensch kann im selben Satz eine andere Bahn wählen; dann steht beides in der Bahn-Zeile (Schritt 6). Bricht die Sitzung ab, bleibt die Punktliste in der Idee, und ein neuer Aufruf setzt bei den offenen Punkten fort.

Jeder neue Body entsteht als `<tmpdir>/<N>-triage-body.md` nach der Transportregel aus `CLAUDE-workflow.md`, Abschnitt „Lange Texte ans Board“: erst `printenv TMPDIR` (bleibt die Ausgabe leer, gilt `/tmp`), dann stückweise `cat >` und `cat >>` mit je höchstens 6.000 Zeichen, jedes Stück ein **eigener** Werkzeugaufruf mit wörtlichem Pfad, nie als Variable. Eine unvollständige Datei wird nicht übertragen; scheitert ein Board-Aufruf, meldet der Skill den Fehler mit dem Pfad und endet ohne weitere Änderung. Vor dem Schreiben prüft das Kommando den neuen Body gegen den am Board:

```bash
node .claude/kit/board.mjs issue triage <N> --body-file <tmpdir>/<N>-triage-body.md
```

Bei `pruefung.ok` (Exit 0) geht er ans Board:

```bash
node .claude/kit/board.mjs issue update <N> --body-file <tmpdir>/<N>-triage-body.md
```

Meldet die Prüfung Verstöße (Exit 1) — der Text der Idee hat sich geändert oder ein bestätigter Punkt hat seine Antwortzeile verloren —, schreibt der Skill nicht. Er korrigiert die Datei und prüft noch einmal. Derselbe Weg gilt für jede spätere Zeile im geklärten Stand: Bahn, Vorlage, Ergebnis.

### 5. Zusammenfassung

Der Skill fasst den geklärten Stand, wie er nach den Empfehlungen stünde, in einer Liste zusammen, ein Eintrag je Punkt; sie steht in der Vorlage aus Schritt 4 vor dem Bahnvorschlag. Ist ein Punkt zurückgestellt, nennt er ihn dort und fragt, ob der Mensch ihn jetzt entscheidet oder ohne ihn weitergeht.

### 6. Bahn vorschlagen

Der Skill schlägt genau eine Bahn vor und begründet sie aus dem geklärten Stand und den drei Bahnen in `CLAUDE-workflow.md`:

- `1` — eine Kleinigkeit nach der zählenden Bahn-1-Regel, ohne etwas abzuwägen. Aus einer Idee ein seltener Randfall.
- `2, fachlich` — es gibt etwas abzuwägen, und die Idee hat fachlichen Bezug.
- `2, technisch` — es gibt etwas abzuwägen, und die Idee ist rein technisch.
- `3` — oberhalb der Kleinigkeit, aber ohne Abwägungsbedarf.

Maßstab zwischen den beiden Formen von Bahn 2 ist der fachliche Bezug: Fachlichen Bezug hat eine Idee, wenn sie ändert, was ein Mensch im Umgang mit dem Werkzeug erlebt; ändert sie nur dessen Inneres, ist sie rein technisch. Im Zweifel schlägt der Skill `2, fachlich` vor.

Im Block `kit-vorlage` (Schritt 4) steht der Vorschlag als Eintrag `art: "weg"` mit vier Optionen in fester Reihenfolge, jede mit einem Satz im Feld `hinweis`; die vorgeschlagene trägt `"empfohlen": true`, die Begründung steht im Feld `grund`:

1. „Gleich erledigen“ — `1`
2. „Als Aufgabe einplanen“ — `3`
3. „Als Anforderung ausarbeiten“ — `2, fachlich`
4. „Technisch planen“ — `2, technisch`

Der Mensch entscheidet: `Ja` wählt die vorgeschlagene Bahn, `Ja, Bahn <wert>` eine andere, mit `<wert>` aus `1`, `2, fachlich`, `2, technisch` und `3` — so nennt er im selben Satz eine andere Bahn. Erst nach der Entscheidung schreibt der Skill die Bahn-Zeile in den geklärten Stand, unter die Punktliste:

```
Bahn: <1 | 2, fachlich | 2, technisch | 3> — vorgeschlagen: <Wert>; gewählt (<Urheber>, <JJJJ-MM-TT>)
```

Vorne steht die gewählte Bahn, dahinter der Vorschlag. Wählt der Mensch eine andere Bahn als vorgeschlagen, steht beides getrennt da, zum Beispiel `Bahn: 3 — vorgeschlagen: 2, fachlich; gewählt (Manfred, 2026-10-13)`.

### 7. Vorlage bestimmen

Liegt in der Ablage ein Anhang, der das Aussehen oder den Aufbau des Ergebnisses zeigt — ein Mockup, eine Skizze, ein Gestaltungsentwurf —, steht bei Bahn 2 und 3 in der Vorlage aus Schritt 4 die Vorlage-Frage mit Empfehlung: ob er zur Vorlage des entstehenden Dokuments wird und ob `verbindlich` oder `Anregung`. Mit dem Ja schreibt der Skill die Zeile in den geklärten Stand:

```
Vorlage: <vorlageZiel> — verbindlich | Anregung
```

Der Pfad ist das Feld `vorlageZiel` der Datei aus `issue triage` — der dauerhafte Ort unter `design/ideas/<N>/`, an den `--finish` sie in Schritt 9 verschiebt. So nennt das Dokument schon beim Anlegen den Pfad, unter dem die Vorlage danach liegt. Die übrigen Anhänge gehen mit der Ablage.

### 8. Den gewählten Weg gehen

Der gewählte Weg beginnt ohne weitere Rückfrage, indem der Skill den bestehenden Skill mit der Nummer der Idee in derselben Sitzung aufruft:

- `2, fachlich` → `/requirement #N`
- `2, technisch` → `/techplan #N`
- `3` → `/task #N`
- `1` → Schritt 10

Es gilt die gewählte Bahn, nicht die vorgeschlagene. Der Zielskill nimmt den geklärten Stand als Eingang und die Bahn-Zeile als bereits getroffene Bahnentscheidung; alles andere — Form, Szenarien, Vorgeschichte, Formprüfung, Spur-Kommentar — bleibt sein Weg.

Die Ergebnis-Zeile schreibt der Skill unmittelbar, nachdem der Zielskill angelegt hat, in den geklärten Stand:

- `Ergebnis: Issue #M` — der Fachplan, der Plan oder das Paket ist am Board angelegt;
- `Ergebnis: Idee <ideaId>` — der Zielskill hat es in den Ideen-Pool gelegt, noch nicht eingeplant;
- `Ergebnis: Commit <sha>` — Bahn 1.

Legt der Zielskill nichts an — er weist ab oder der Mensch bricht ab —, entsteht keine Ergebnis-Zeile, und die Ablage bleibt.

### 9. Abschluss

Steht die Ergebnis-Zeile, hat der gewählte Weg begonnen, und der Skill schließt die Ablage ab. Mit einer Vorlage aus Schritt 7 (der Name der Datei in der Ablage):

```bash
node .claude/kit/board.mjs issue triage <N> --finish --template <datei>
```

Ohne Vorlage:

```bash
node .claude/kit/board.mjs issue triage <N> --finish
```

Danach ist die Ablage gelöscht; `abschluss` nennt, was geschah. Meldet es `ok: false`, bleibt alles stehen, und der Skill nennt die `meldung`.

Gab es eine Vorlage, committet der Skill sie danach allein, ein eigener Commit nur mit der Vorlage — ein liegengebliebener Pfad ließe den Working Tree unsauber und die Abnahme gegen die Vorlage ins Leere zeigen. Wie jeder Commit setzt er einen grünen `node .claude/kit/checks.mjs run` voraus:

```bash
git add design/ideas/<N>/<datei>
git commit -m "Vorlage zu Idee #N abgelegt (Issue #N)"
```

Die Reihenfolge ist fest: Dokument anlegen → Ergebnis-Zeile → `--finish` → Commit der Vorlage. Die Abschlussmeldung nennt das Ergebnis und den nächsten Schritt des Zielskills.

### 10. Bahn 1

Bahn 1 setzt der Skill selbst um, nach den Regeln von Bahn 1 in `CLAUDE-workflow.md`: die Änderung, ein grüner `node .claude/kit/checks.mjs run` auf dem zu committenden Stand, ein Commit, dessen Nachricht `Issue #N` der Idee nennt. Danach schreibt er `Ergebnis: Commit <sha>` in den geklärten Stand und ruft `--finish` wie in Schritt 9. In der Idee stehen damit der geklärte Stand, die Entscheidung des Menschen und der Verweis auf die Änderung.

Die Idee schließt der Mensch. Der Skill nennt dem Menschen den Zug `node .claude/kit/board.mjs issue move <N> done` und führt ihn nicht selbst aus — Done setzt nur der Mensch.

## Stop-Punkte

- Unbeaufsichtigt (`KIT_AGENT_MODEL` gesetzt): nicht beginnen, nichts ändern.
- Keinen Weg gehen, den der Mensch nicht gewählt hat — vorschlagen ja, wählen nie.
- Nichts in die Idee schreiben ohne Zustimmung, und nie einen Body, den `issue triage --body-file` abgewiesen hat.
- Kein zweites Ergebnis anlegen, wenn `stand.ergebnis` eines meldet.
- Die Idee nie nach Done ziehen — den Zug nennt der Skill dem Menschen.
- Kein Label abnehmen.
- Pushen: nie ohne explizite Trigger-Phrase `push main`.
