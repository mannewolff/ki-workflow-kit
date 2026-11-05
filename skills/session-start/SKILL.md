---
name: session-start
description: Loads the memory vault and gives a short session start status. Use this skill when the user invokes /session-start or wants to start the session with the project status.
user-invocable: true
---
<!-- SPDX-License-Identifier: MIT -->

# Kontext

Session-Start: Vault laden, Projektstand holen, kurzen Überblick geben. Werkzeug neben dem Prozess — nützlich zu Beginn jeder Session, aber der Prozess läuft auch ohne.

## Vorbedingung: Config-Modus bestimmen

Beide Configs werden gelesen und **feldweise gemergt**, lokale Felder gewinnen:
1. `~/.claude/kontext.config.json` (global) — die Basis
2. `.claude/kontext.config.json` im aktuellen Projektverzeichnis — überschreibt einzelne Felder

Kein "erstes gefundenes gewinnt": Eine lokale Config, die nur `project`/`parentProject` setzt, erbt `vault` und `always` von global. Bei "erstes gewinnt" wäre der Vault-Pfad verloren.

Daraus ergibt sich einer von zwei Modi:

**Modus A (Vollmodus):** Nach dem Merge ist `vault` gesetzt. Normaler Ablauf mit Vault, Projektnotizen, always-Dateien.

**Modus B (Degraded Mode):** Nach dem Merge kein `vault` (kein Feld gesetzt oder gar keine Config gefunden). Vault-Schritte überspringen. Nur Vorhaben und projectDocs laden. Am Ende Hinweis ausgeben: "Kein Vault konfiguriert, arbeite ohne persistentes Memory."

Kein harter Abbruch. Beide Modi liefern sinnvollen Output.

## Ablauf

### 1. Config lesen

Felder aus `kontext.config.json` (alle optional):
- `vault`: absoluter Pfad zum Memory-Vault
- `always`: Array von Dateipfaden relativ zum `vault`-Root (immer lesen)
- `projectDocs`: Array von Pfaden oder Glob-Mustern relativ zum Projektverzeichnis. Fallback wenn nicht gesetzt: `["CLAUDE-*", ".claude/CLAUDE-*"]`
- `project`: Override für den Vault-Projektnamen (nur nötig wenn Repo-Name ≠ Vault-Ordnername)
- `parentProject`: Dach-Projekt im Multi-Repo-Setup. Gesetzt, wenn dieses Repo ein Service eines größeren Systems ist — dann liegen die Service-Notizen im Ordner des Dach-Projekts und die Dach-Notiz kommt dazu
- `logPath`: Muster für die Tageslog-Datei relativ zum `vault`-Root, Default `Log/{date}.md`. Nur `/document` schreibt dorthin

### 2. Vault-Dateien lesen (nur Modus A)

Lies alle Dateien aus `always` relativ zum `vault`-Pfad. Typisch: `Index.md` (Struktur + aktive Projekte) und `Profil.md` (Nutzerprofil).

### 3. Projektnotizen lesen (nur Modus A)

Der Skill baut keine Vault-Pfade selbst zusammen. Ein Aufruf liefert sie:

```bash
node .claude/kit/board.mjs context paths
```

Relevante Felder im JSON:
- `parentNote`: absolute Datei der Dach-Notiz — nur gesetzt wenn `parentProject` konfiguriert ist, sonst `null`
- `projectNote`: absolute Datei der Notiz dieses Repos
- `project`, `parentProject`: für die Kopfzeile in Schritt 7

Lesereihenfolge: **`parentNote` zuerst** (sofern nicht `null`), **`projectNote` danach**. Die gemeinsame Klammer bildet den Rahmen, in den der Service-Kontext gehört — umgekehrt gelesen steht die Service-Sicht ohne System-Kontext da.

Fehlt eine der beiden Dateien im Vault: leise überspringen, kein Fehler. Nur die `always`-Dateien zeigen reicht.

**Der Fallback gilt genau einem Fall: unbekannte Achse `context`** (für `update` siehe Schritt 6) — ein Projekt mit älterer `board.mjs`. Dann auf das bisherige Verhalten zurückfallen statt abzubrechen: Projektname über `node .claude/kit/board.mjs code repo-name` (letztes Segment ohne `.git`, `project`-Feld aus der Config gewinnt), Projektnotiz `{vault}/Projekte/{name}/{name}.md`, keine Dach-Notiz. Ein Session-Start darf daran nicht scheitern.

**Jeder andere Fehler wird sichtbar gemeldet**, insbesondere eine mehrdeutige Notiz (zwei Dateien, die sich nur in der Groß-/Kleinschreibung unterscheiden) und ein nicht lesbarer Notizordner. Die Meldung des Kommandos unverändert ausgeben und keinen Pfad selbst konstruieren. Wer hier zurückfällt, verdeckt genau den Befund, den das Kommando gerade gemeldet hat (Issue #286).

### 4. Projekt-spezifische Docs lesen (beide Modi)

Lies alle Dateien aus `projectDocs` relativ zum Projektverzeichnis. Einträge können konkrete Dateinamen oder Glob-Muster sein:

```bash
find . -maxdepth 1 -name "CLAUDE-*" -type f
```

Fehlende Dateien und Muster ohne Treffer leise überspringen (kein Fehler).

### 5. Vorhaben holen (beide Modi)

Vorhaben und Repo-Name ueber den Board-Adapter:

```bash
node .claude/kit/board.mjs issue epics
node .claude/kit/board.mjs code repo-name
```

**Welche Vorhaben erscheinen.** Ein Vorhaben erscheint, wenn mindestens eines
seiner Arbeitspakete noch nicht erledigt ist (`done` kleiner als `total`).
Ausgeblendet wird damit beides: was alle seine Arbeitspakete erledigt hat und
was gar keine hat (`0/0`) — ein Vorhaben ohne Arbeitspakete ist nicht begonnen
worden und traegt den Einstieg nicht. Erfuellt kein Vorhaben die Regel,
entfaellt der Abschnitt `### Vorhaben` ganz.

**Ein Fehlschlag von `issue epics` wird still uebersprungen**, nicht gemeldet:
GitHub und GitLab kennen keine Vorhaben, der Adapter weist das Kommando dort ab.
Ein Fehler ist bei diesen Trackern der Normalfall und kein Befund — wer ihn
ausgibt, produziert bei jedem Session-Start in einem GitHub-Projekt eine Warnung
ueber eine Faehigkeit, die es dort nie geben wird.

Wenn der Adapter bei den uebrigen Aufrufen einen Fehler zurueckgibt: Schritt
ueberspringen, kein harter Abbruch.

### 6. Neue Fassung des Kits (beide Modi)

**Pro.** Die Erinnerung an eine neue Fassung gehört zu Pro (Plan #2008, A9). In Community entfällt dieser Schritt ohne Zeile; ob die Installation Community ist, sagt das Feld `ausgabe` aus Schritt 6b, dessen Aufruf die Session darum zuerst fährt. Ein Community-Projekt kommt auf eine neue Fassung, indem der Mensch den Installer von docs.mwolff.org erneut aufruft. In Pro sagt ein eigener Aufruf, ob eine neue Fassung des Kits erschienen ist:

```bash
node .claude/kit/board.mjs update check
```

Trägt die Ausgabe das Feld `hinweis`, steht dieser Satz wörtlich im Startstatus, als eigene Zeile unter der Kopfzeile — sonst nichts dazu. Eine Ausgabe ohne `hinweis` (aktuelle Kopie, `ok: false` ohne Netz, das Kit-Repo selbst) bleibt still. Exit ungleich 0 bleibt ebenfalls still, kein Fehler: Die Ausnahme der unbekannten Achse `context` aus Schritt 3 gilt auch für die unbekannte Achse `update` — ein Projekt mit älterer `board.mjs` kennt sie nicht, und ein Session-Start darf daran nicht scheitern.

### 6b. Ausgabe der Installation (beide Modi)

Ob die Installation Community oder Pro ist, sagt ein eigener Aufruf:

```bash
node .claude/kit/board.mjs edition show
```

Ausgabe und Version des Kits stehen als eigene Zeile `Kit: <ausgabe> <version>` unter der Kopfzeile, aus den Feldern `ausgabe` und `version` (Plan #2008, A9); fehlt das Feld `version` (eine ältere `board.mjs`), steht nur die Ausgabe. Ist das Feld `zeile` nicht leer, steht es unverändert als eigene Zeile unter der Kopfzeile — es nennt in Community die Pro-Einstellungen, die das Projekt trägt und die übergangen werden; in Pro ist es leer, und es erscheint nichts. Exit ungleich 0 bleibt still, kein Fehler: Die Ausnahme der unbekannten Achse aus Schritt 3 gilt auch für die Achse `edition`.

### 6c. Strenge des Projekts (beide Modi)

Wie streng das Kit dieses Projekt prüft, sagt ein eigener Aufruf (Plan #2102, A12, A16):

```bash
node .claude/kit/board.mjs config strictness
```

Das Feld `zeile` (etwa `Strenge: Normal`) steht unverändert als eigene Zeile unter der Kopfzeile, direkt nach der Zeile `Kit: …`. Die Strenge legt der Skill nicht selbst aus. Exit ungleich 0 bleibt still, kein Fehler: Die Ausnahme der unbekannten Achse aus Schritt 3 gilt auch für die Achse `config`.

### 6d. Hotfix und Zurückkehren (beide Modi)

**Pro.** Offene Hotfixes und ein Zurückkehren gehören zu Pro (Plan #2038, A5). In Community entfällt dieser Schritt ohne Zeile; ob die Installation Community ist, sagt das Feld `ausgabe` aus Schritt 6b. In Pro sagt ein eigener Aufruf, was in Produktion offen ist:

```bash
node .claude/kit/board.mjs release state
```

Je Eintrag steht eine eigene Zeile unter der Kopfzeile, sonst nichts dazu:

- je Hotfix in `offen`: `Hotfix <version> offen: Karte #<karte>, nachzuholen: <nachzuholen>` — ohne Karte `Karte fehlt` statt `Karte #<karte>`;
- je Hotfix in `ohneKarte`, der nicht schon in `offen` steht: `Hotfix <version> ohne Karte: <fehler>`;
- je Eintrag in `zurueckkehren`: `Zurückgekehrt von <von> nach <nach> am <zeitpunkt>`, bei `erfolg: false` `Zurückkehren nach <nach> gescheitert am <zeitpunkt>, laufend bleibt <von>`.

Leere Listen bleiben still. `veraltet: true` ergänzt eine Zeile `Produktionsstand nicht frisch geholt`. Exit ungleich 0 bleibt still, kein Fehler: Die Ausnahme der unbekannten Achse aus Schritt 3 gilt auch für die Achse `release`.

**Karte eines Hotfix ohne Board (E10).** Für jeden Hotfix in `ohneKarte` legt der Schritt die Karte an, sobald das Board erreichbar ist — erreichbar heißt, `issue epics` aus Schritt 5 oder ein anderer Board-Aufruf dieser Sitzung hat ohne Netzfehler geantwortet; sonst bleibt es bei der Zeile oben, und der nächste Session-Start versucht es wieder. Der Inhalt kommt allein aus dem Eintrag: `fehler` (der Fehler in einem Satz), `fixCommit` und `nachzuholen`. Datei `<tmpdir>/hotfix-<version>.md` nach der Transportregel (`CLAUDE-workflow.md`, „Lange Texte ans Board") stückweise per Shell anlegen:

```
## Kontext
Hotfix <version> ging ohne erreichbares Board hinaus; diese Karte entsteht aus dem Eintrag in refs/kit/produktion (Plan #2038 E10).
Fehler in Produktion: <fehler>
Fix-Commit: <fixCommit>

## Aufgabe
Nachholen beim naechsten regulaeren Weg:
- <je Eintrag aus nachzuholen eine Zeile>
```

Fehlt `fehler` (ein Eintrag von vor Issue #2063), steht dort `Fehler in Produktion: nicht festgehalten`. Dann:

```bash
node .claude/kit/board.mjs issue create --art task --title 'Hotfix <version> ohne Board: <fehler>' --body-file <tmpdir>/hotfix-<version>.md
```

```bash
node .claude/kit/board.mjs issue label add <n> kit:hotfix
```

```bash
node .claude/kit/board.mjs release attach-card --version <v> --issue <n>
```

`<n>` ist das Feld `id` aus `issue create`, `<v>` die `version` des Eintrags. Erst mit `attach-card` greifen die Nachprüfung in `push main` und das Label aus E9. Scheitert `issue create`, bleibt es bei der Zeile oben. Scheitert `label add`, wird das gemeldet und hält nicht auf. Scheitert `attach-card`, nennt der Startstatus die angelegte Karte und den Aufruf zum Wiederholen — ein zweites `issue create` für denselben Hotfix entfällt dann. Die angelegte Karte steht als Zeile `Hotfix <version>: Karte #<n> angelegt` statt der Zeile `ohne Karte`. Dieser Schritt legt nur Karten an; er ändert keine Datei im Projekt.

### 7. Zusammenfassung ausgeben

Kompakter Session-Start-Stand.

**Ohne `parentProject`** (Ein-Repo-Fall, eine Projektebene):

```
## Session-Start — {Projektname}

### Vorhaben
- #N [KUERZEL] Titel — done/total
- ...
(aus `issue epics`; Abschnitt weglassen, wenn der Tracker keine kennt)

### Letzte Entscheidungen / Zuletzt aktualisiert
(aus der Projektnotiz — nur Modus A; nur der jüngste dokumentierte Tag)

### Was als nächstes kommt
(aus der Projektnotiz)
```

**Mit `parentProject`** (Multi-Repo-Setup): Der Kopf benennt beide Ebenen, damit sofort sichtbar ist, in welchem Service man sitzt und zu welchem System er gehört. Wurden beide Notizen gelesen, bleiben systemweiter Stand und Stand dieses Service getrennt — eine zusammengerührte Liste wäre beim Einstieg wertlos, weil nicht mehr erkennbar ist, was für alle Services gilt:

```
## Session-Start — {parentProject} / {project}

### Vorhaben
- #N [KUERZEL] Titel — done/total
- ...
(aus `issue epics`; Abschnitt weglassen, wenn der Tracker keine kennt)

### Systemweiter Stand ({parentProject})
(aus der Dach-Notiz — Abschnitt weglassen wenn sie fehlt)

### Stand {project}
(aus der Projektnotiz — letzte Entscheidungen / zuletzt aktualisiert; nur der jüngste dokumentierte Tag)

### Was als nächstes kommt
(aus der Projektnotiz)
```

**Nur der jüngste dokumentierte Tag.** Unter den letzten Entscheidungen steht, was am jüngsten in der Notiz dokumentierten Tag festgehalten wurde — auch dann, wenn dieser Tag keine Entscheidung enthält.
- Maßgeblich sind ausschließlich Datumsangaben der Form `JJJJ-MM-TT`, die einen Eintrag einleiten, gesucht in der ganzen Notiz und nicht nur im ersten `## Zuletzt aktualisiert`-Abschnitt. Eine Notiz kann mehrere solcher Abschnitte tragen.
- Ein Datum leitet einen Eintrag ein, wenn es am Zeilenanfang steht, allenfalls nach einem Listenpunkt, und ihm ein `:` oder ein Klammerzusatz folgt — die Form, in der `/document` schreibt: `- JJJJ-MM-TT: …` oder `- JJJJ-MM-TT (Fortsetzung): …`.
- Datumsnennungen im Fließtext eines Eintrags zählen nicht, ebenso wenig ein Datum in anderer Form wie `**Stand JJJJ-MM-TT**`.
- Gehören mehrere Einträge zum jüngsten Tag, gehören sie alle dazu; ein Klammerzusatz wie „(Fortsetzung)" macht keinen anderen Tag.
- Trägt die Notiz keine Datumsangabe, die einen Eintrag einleitet, erscheint ihr zuletzt geschriebener Abschnitt so, wie er dasteht — die Verdichtungsregel gilt für diesen Rückfall nicht.
- Werden zwei Notizen gelesen, wird der Tag je Notiz getrennt bestimmt.

**Die Vorhaben stehen oben**, weil sie die Gliederung sind, unter der die Arbeit
haengt: Wer sie zuerst sieht, hat den Rahmen, in den alles Weitere gehoert. Die
einzelnen Arbeitspakete stehen auf dem Board und werden hier nicht wiederholt —
was der Session-Start ausgibt, steht danach im Kontextfenster der ganzen Sitzung
und fehlt dort fuer die eigentliche Arbeit.

Im Degraded Mode am Ende anfuegen:
> "Kein Vault konfiguriert, arbeite ohne persistentes Memory. Fuer Vollmodus: `~/.claude/kontext.config.json` anlegen mit vault-Pfad."

Keine vollstaendige Wiedergabe der Vault-Inhalte — nur was fuer den sofortigen Einstieg relevant ist.

## Was dieser Skill nicht tut

- Kein Schreiben in den Vault (das ist /document)
- Keine Code-Änderungen
- Kein eigenmächtiges Starten anderer Skills
