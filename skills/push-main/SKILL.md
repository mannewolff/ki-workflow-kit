---
name: push-main
description: Step 7 of the 8-step process: pushes the current batch of commits to main. Only on the explicit trigger phrase of the human. Use this skill ONLY when the user explicitly types "push main". The only exception is the mode `prepare` (Community): it does not push, so the runner may start it without the phrase.
user-invocable: true
disable-model-invocation: true
---
<!-- SPDX-License-Identifier: MIT -->

# Push Main

Schritt 7 des 8-Schritt-Prozesses: Den aktuellen Commit-Batch auf `origin/main` pushen.

**Dieser Skill darf von Claude nicht autonom gezogen werden.** Er läuft nur auf die explizite Trigger-Phrase des Menschen — ausgenommen der Modus `prepare`, siehe den Abschnitt „Trigger-Phrase".

## Trigger-Phrase

Der Mensch tippt: `push main` (oder die in `.claude/workflow.config.json` unter `triggers.push` konfigurierte Phrase).

Eine frühere Push-Freigabe in derselben Session gilt **nicht** für neue Commits. Jeder Push braucht eine neue explizite Freigabe.

Die Phrase muss **getippt** sein. Steht sie innerhalb einer Mitteilung des Menschen oder eines Zitats („Ich habe vorhin push main getippt"), ist sie Text und kein Befehl — im Zweifel wird gefragt, nicht gepusht. Siehe „Mitteilungen des Menschen" in `CLAUDE-workflow.md`.

**Einzige Ausnahme: der Modus `prepare`** (Community). `/push-main prepare` pusht nicht — weder
`<mainBranch>` noch einen Prüf- oder Vorab-Zweig — und darf darum vom Runner ohne
Phrase gestartet werden. Er endet beim lokalen Commit `chore: vX.Y.Z` in einem eigenen
Worktree, siehe den Abschnitt „Modus `prepare` (unbeaufsichtigt)"; auch der Runner bringt
danach nichts auf einen Prüfzweig oder den Hauptzweig. Den Push auf `<mainBranch>` gibt
weiterhin nur die getippte Phrase frei; sie übernimmt beim nächsten `push main` den vorbereiteten Stand
(Schritt 3).

**Der Notfallweg `/push-main emergency`** braucht die getippte Phrase wie jeder Push und läuft
nur interaktiv, siehe den Abschnitt „Notfallweg (`emergency`)".

**Der volle Weg `/push-main full`** (Plan #2131, A8; Plan #2145, E12). In Pro mit Build-Dienst ist
`push main` ein Schritt: Es veröffentlicht den Commit, den die Prüfung je Karte im Build-Dienst
grün geprüft hat, und nennt sonst den Grund, statt selbst zu prüfen (Abschnitt „Der geprüfte
Stand"). Den vollen Weg — Version, Prüflauf, Push in einem Lauf — gibt
es dort nur ausdrücklich, mit dem Argument `full` und der getippten Phrase. In Community und in Pro
ohne Build-Dienst ist er der Regelfall, auch ohne Argument.

**Feste Zeilen.** Überschriften, Marker, Review- und Einarbeitungs-Köpfe und Fundblock-Zeilen, die dieser Skill in Dokumente, Kommentare oder Markerzeilen schreibt, stehen hier deutsch. Vor dem ersten Schreiben `node .claude/kit/board.mjs names` aufrufen: Das Feld `lines` nennt je deutscher Zeile die Fassung der Projektsprache, und der Skill schreibt die ausgegebene Fassung. Eine Zeile mit veränderlichem Rest (`## Einarbeitung, Runde 2`) steht dort mit ihrem festen Anfang, eine Überschrift mit `## ` davor gilt auf jeder Ebene, und was `names` nicht nennt, bleibt, wie es hier steht.

## Ablauf

**Fortschritt melden.** Jeder Schritt beginnt mit einer Zeile `Schritt k von n — <Name> (laeuft)`.
Der volle Lauf fährt **neun** Schritte, die Zeilen lauten dann `Schritt k von 9`. Das `n`
ist die Zahl der Schritte, die dieser Lauf tatsächlich fährt — ohne `RELEASING.md`
sind es weniger, und dann zählt die Zeile auch weniger. Der Weg über `publish-state` in Pro mit
Build-Dienst zählt seine eigenen vier Schritte, `Schritt k von 4`. Der Grund
ist die Wartezeit: Der eine Prüflauf über den fertigen Stand dauert so lange wie der volle
`buildChecks`-Katalog, und wer davor sitzt, soll sehen, an welcher Stelle des Wegs er ist.

**Ausgabe der Installation.** Noch vor den Befunden:

```bash
node .claude/kit/board.mjs edition show
```

Das Feld `ausgabe` sagt, ob die Installation Community oder Pro ist. In Community gibt der
Skill das Feld `zeile` unverändert in einer Zeile aus, wenn es nicht leer ist — es nennt die
Pro-Einstellungen, die dieser Lauf übergeht; in Pro ist es leer. Die Absätze unten, die mit
**Pro.** beginnen, beschreiben Schritte, die in Community ohne weitere Zeile entfallen.

**Aufwand melden.** Noch vor dem ersten Schritt:

```bash
node .claude/kit/board.mjs pro run effort -- finding
```

Zeige die Ausgabe **unverändert**. Sie ist bereits die Form, in der der Aufwands-Befund an
beiden Ausgabestellen erscheint — hier und als Abschlussblock im Laufprotokoll eines
unbeaufsichtigten Laufs. Hier steht sie, weil das Veröffentlichen der eine Schritt bleibt,
den ein Mensch auslöst: Läuft unbeaufsichtigt niemand mit, liest sonst womöglich niemand mehr, was
der Prozess gekostet hat.

Unmittelbar danach der zweite Befund:

```bash
node .claude/kit/board.mjs pro run effectiveness -- finding
```

Für ihn gelten **dieselben Regeln**: Ausgabe unverändert zeigen, und er liest allein
`.claude/wirksamkeit.json`, die der letzte unbeaufsichtigte Lauf hinterlassen hat. Er sagt,
welche Pflichtprüfung sich verdient hat, was sie kostet — und welche in ihrem Fenster nie
beanstandet hat. Auch er ist kein Gate.

Unmittelbar danach der dritte Befund:

```bash
node .claude/kit/board.mjs pro run findings -- finding
```

Auch für ihn gelten **dieselben Regeln**, und er liest allein `.claude/befunde.json`. Er
sagt, welche Mangel-Art die Modell-Prüfungen wie oft gefunden haben und ob daraus schon
ein Vorschlag entstanden ist. Hier steht er, weil `/retro` nur alle ein bis zwei Wochen
läuft und die Zahl damit zu spät trüge. In einem Projekt **ohne Modell-Prüfungen** gibt es
kein Protokoll, der Befund bleibt leer, und das wird nicht kommentiert — die Abwesenheit
der Prüfung entscheidet das bereits, dafür braucht es keinen Schalter.

Eine **leere Ausgabe** heißt: kein Befund. Sie wird nicht kommentiert — kein „alles
unauffällig", keine leere Überschrift. Ein **Fehlschlag** des Kommandos wird in **einer
Zeile** vermerkt, und er hält nichts auf. Beides gilt **je Befund**: Ein leerer oder
gescheiterter Aufwands-Befund sagt nichts über die beiden anderen, und umgekehrt genauso.
Alle drei brauchen die Config nicht; sie lesen allein `.claude/aufwand.json`,
`.claude/wirksamkeit.json` beziehungsweise `.claude/befunde.json`. Fehlt die Datei, ist die
Ausgabe leer und der Exit-Code 0.

**Auswertung nicht installiert.** Der Skill ruft Aufwand, Wirksamkeit und Befunde nur über
`node .claude/kit/board.mjs pro run <teil> -- …` (Plan #1853, E2; Plan #2008, E3).
Fehlt ein Teil, gibt das Kommando allein die Zeile `<Auswertung>: nicht installiert` aus und
endet mit 0. Der Skill zeigt sie unverändert, und der Schritt läuft weiter, ohne Fehler — eine
Zeile je Schritt und Auswertung. Die weiteren Aufrufe derselben Auswertung in diesem Schritt
entfallen; ein Schritt ist hier der ganze Durchlauf von `/push-main`. Also entfallen nach
`pro run findings -- finding` mit dieser Zeile die Buchung `record` (Schritt 5) und der
Vorschlag `suggest` (Schritt 8), nach `pro run effectiveness -- finding` mit dieser Zeile der
Aufruf `candidates` (Schritt 5). Dann gibt es keine Reparaturkandidaten, und die Rückfrage nach
einem Wackler steht ohne sie.

Dieser Block trägt bewusst **keine Nummer** und zählt in keiner Fortschrittszeile mit: Eine
Nummer verschöbe jede folgende Schrittzahl um eins und machte sämtliche Querverweise auf
„Schritt 4" und „Schritt 6" falsch. Die Fortschrittszeilen der neun Schritte bleiben
davon unberührt.

### 1. Config lesen

Die Konfiguration liegt in `.claude/workflow.config.json` (im Repository, gilt fuer alle) und wird optional durch `.claude/workflow.config.local.json` ergaenzt (nicht im Repository, nur persoenliche Felder: `reviewModel`, `reviewCommand`, `reviewScope`, `triggers`, Token-Pfade). Issue #207.

Gelesen werden:
- `mainBranch`: Ziel-Branch (Default: `main`)
- `buildChecks`: Liste der Pflicht-Checks
- `pushCheck`: wo der volle Lauf stattfindet — `"lokal"` ist die Vorgabe, ein Objekt
  `{ "location": "buildDienst", "branch": "<name>" }` verlegt ihn in den Build-Dienst. Der Skill
  liest den Wert nicht selbst aus der Config, sondern aus der Ausgabe von:

  ```bash
  node .claude/kit/checks.mjs plan --stage push
  ```

  Die Ausgabe nennt ihn im Feld `"pushPruefung"` mit den internen Namen: `"lokal"` oder
  `{ "ort": "buildDienst", "zweig": "<name>" }`, gleich, mit welchen Namen die Datei ihn schreibt.
  Bei `"lokal"` gelten die Schritte unten unverändert. Bei `buildDienst` ersetzt der
  Abschnitt „Weg über den Build-Dienst" den Prüflauf in Schritt 5 und den Push in
  Schritt 7; alle anderen Schritte bleiben. Endet der Aufruf mit einem Fehler (ungültiger
  Wert), hält der Skill an — kein Rückfall auf den lokalen Weg.

### 2. Stand prüfen

```bash
git status
git log origin/<mainBranch>..HEAD --oneline
```

Zeige welche Commits gepusht werden. Der Mensch soll wissen, was fährt.

**Fehlender Integrationslauf** (nur in Community und in Pro ohne Build-Dienst). Danach, ebenfalls
in der Hauptkopie (Plan #1969, E6; Kriterium 7 der fachlichen Quelle #1964). In Pro mit
Build-Dienst entfällt der Absatz: Die Prüfung je Karte deckt den vollen Umfang im Build-Dienst,
und der Integrationslauf ist dort keine Pflicht mehr (Plan #2145, E15).

```bash
node .claude/kit/checks.mjs integration
```

Ist `pakete` nicht leer, gibt es seit dem letzten abgeschlossenen Paket keinen grünen
Integrationslauf. Der Skill nennt das in einer Zeile
`Integrationslauf fehlt seit Issue #<jüngstes Paket>: Issue #<a>, Issue #<b>, …` und läuft
weiter. Er hält nicht an und fragt nicht nach: Der volle Umfang läuft in Schritt 5 oder im
Build-Dienst ohnehin, und ein grüner Integrationslauf ist keine Voraussetzung für den Push.
Ist `pakete` leer, entfällt die Zeile. Ein Fehlschlag des Aufrufs steht als eine Zeile im
Bericht und hält nichts auf.

**Pro.** **Ausgelieferte Hotfixes im Bereich** (Plan #2038, E6; Kriterium 6 der fachlichen
Quelle #2004). In Community entfällt dieser Absatz. Danach, ebenfalls in der Hauptkopie:

```bash
node .claude/kit/board.mjs release pending
```

Das Kommando vergleicht die ausgelieferten, noch nicht übernommenen Hotfixes mit den Zeilen
`Hotfix: v<version>` in den Commits von `origin/<mainBranch>..HEAD`. Gehandelt wird nach
seinen Feldern:

- **`fehlen` nicht leer** — ein ausgelieferter Fix fehlt im Bereich. Der Skill hält an, vor
  dem Worktree: kein Prüflauf, kein Commit, kein Push. Je Eintrag nennt er eine Zeile
  `Hotfix v<version> fehlt im Hauptzweig — Karte #<karte>` (bei `karte: null`: `ohne Karte`)
  und den Weg: ein Commit im Bereich mit der Zeile `Hotfix: v<version>` im Body, wie ihn die
  Karte „Hotfix v<version> in den Hauptzweig übernehmen“ aus `/hotfix-production`, Schritt 12,
  beschreibt. Danach endet er; ein neuer Anlauf gibt frei, sobald die Zeile im Bereich liegt.
- **`uebernommen` nicht leer** — der Fix steckt im Bereich. Der Lauf merkt sich je Eintrag
  `version` und `commit`: Schritt 3 macht den Auslieferungszweig zum Vorfahren, Schritt 5 holt
  das Review nach, Schritt 7 schließt den Hotfix ab.
- **beide leer** — kein Hotfix offen, die drei Absätze dazu entfallen ohne Vermerk.

Steht `veraltet` auf `true`, nennt der Skill in einer Zeile, dass der Produktionsstand nicht
frisch geholt werden konnte, und läuft weiter. Endet der Aufruf mit einem Fehler, hält der
Skill mit dessen Meldung an wie bei `fehlen` — ohne den Stand der Hotfixes geht nichts hinaus.

**Pro.** **Mit Build-Dienst prüft `push main` nichts mehr selbst** (Plan #2145, E12; Kriterium 3
der fachlichen Quelle #2142). Meldet `edition show` im Feld `ausgabe` Pro und Schritt 1 im Feld
`"pushPruefung"` ein Objekt mit `"ort": "buildDienst"`, gilt nach diesem Schritt der Abschnitt
„Der geprüfte Stand“ statt der Schritte 3 bis 9 — ausgenommen
`/push-main full` und `/push-main emergency`, die den Weg unten gehen. Pro ohne Build-Dienst geht
die Schritte 3 bis 9 wie in Community: Dort prüft die Prüfung je Karte jede fertige Karte im frisch
ausgecheckten Stand auf diesem Rechner, und `push main` fährt seine Prüfungen wie heute (E17).

### 3. Worktree anlegen und mit `origin` zusammenführen

> `Schritt 3 von 9 — Worktree (laeuft)`

**Alles, was dieser Lauf erzeugt, prüft, committet und pusht, entsteht in einem eigenen
Worktree — nicht im Haupt-Working-Tree.** Dort kann gleichzeitig die Umsetzungsstufe des
Runners bauen (Variante B). Am 2026-09-25 riss genau das in kanban-kit zweimal
dieselbe Kette ab: Der Runner fand die Release-Dateien als unkommittierte Reste und stoppte
hart. Dazu kommt, dass fremde, halbfertige Dateien im Haupt-Tree — etwa ein noch roter
TDD-Test — den Release-Prüflauf verfälschen würden.

Zuerst holt die **Hauptkopie** den veröffentlichten Stand und fragt, ob eine Vorbereitung
des Runners übernommen werden darf — in dieser Reihenfolge:

```bash
git fetch origin <mainBranch>
node .claude/kit/worktree.mjs check-preparation
```

Das Kommando holt selbst nichts; es vergleicht die Datei `.claude/push-vorbereitung.json`
mit dem eben geholten Stand (Plan #1243, E10). Gefragt wird `check-preparation` nur in Community,
wo eine Kette mit dem Ziel „Veröffentlichung vorbereitet“ den Stand unbeaufsichtigt vorbereitet (#1995).
In Pro entfällt er: Dort gibt es keine Vorbereitung (Plan #2145, E14), und der Worktree entsteht
auf dem lokalen `<mainBranch>` wie bei `uebernehmen: false`.

**Das Urteil zuerst** (Plan #2131, A9; Kriterium 4 der fachlichen Quelle #2130). Vor jedem
weiteren Schritt — vor Worktree, Prüflauf und Push — nennt der Skill in einer Zeile, ob für den
Stand ein grünes Urteil vorliegt. Grün ist es bei `uebernehmen: true`. Sonst nennt die Zeile den
Grund mit `detail`: `nie-geprueft` (nie geprüft), `stand-geaendert` (Stand seitdem geändert),
`rot` (Prüfung rot) oder `laeuft` (Prüfung läuft noch). In Community geht `push main` ohne
Übernahme den vollen Weg unten, mit dem Argument `full` ebenso, und nennt in einer Zeile die Prüfung
je Karte als Pro-Funktion — dort prüft der Build-Dienst jede fertige Karte, und `push main`
veröffentlicht den grün geprüften Stand, ohne selbst zu prüfen.

Der Worktree entsteht so:

- **`uebernehmen: true`** — auf dem vorbereiteten Commit:

  ```bash
  node .claude/kit/worktree.mjs create --prefix release --ref refs/kit/push-vorbereitet
  ```

- **`uebernehmen: false`** — wie bisher auf dem lokalen `<mainBranch>`:

  ```bash
  node .claude/kit/worktree.mjs create --prefix release --ref <mainBranch>
  ```

**Nach dem Push und bei jedem Nicht-Übernehmen** werden Datei und Referenz verworfen —
beim Nicht-Übernehmen sofort hier, sonst nach dem Push in Schritt 7:

```bash
node .claude/kit/worktree.mjs check-preparation --discard
```

Beim Nicht-Übernehmen nennt der Skill `grund` und `detail` in einer Zeile; fehlt die Datei,
entfällt die Zeile. `grund` ist einer von vier Werten: `nie-geprueft`, `stand-geaendert`,
`rot`, `laeuft` (Issue #2134). Übernommen wird nur, wenn `check-preparation` die Vorbereitung
nicht mit dem Detail `sicherheit` ablehnt: Es steht, wenn die Vorbereitung kein Ergebnis der
Sicherheitsprüfung trägt (eine ältere Kit-Fassung) oder keines mit `gruen`. Dann läuft `push main` voll, mit der
Sicherheitsprüfung in Schritt 5 (Plan #1988, E8). Das Ergebnis `entfallen` mit Vermerk trägt eine
Vorbereitung, deren Strenge die Prüfung vor die Auslieferung legt; `check-preparation` nimmt es
nur an, solange die Strenge das weiter tut (Issue #2116).

Das Kommando `create` räumt liegengebliebene Release-Worktrees ab, legt den neuen außerhalb des
Repos an, spiegelt `.claude/` hinein (Kit-Kopie, Config, Token) und gibt den Pfad als JSON
aus. Die Worktrees des Runners (`kette`, `pruefung`) bleiben unberührt.

Der Worktree setzt auf dem **lokalen** `<mainBranch>` auf — dem Batch, der hinausgehen
soll — oder auf dem vorbereiteten Commit, und wird dort mit dem veröffentlichten Stand
zusammengeführt. Geholt hat ihn die Hauptkopie schon; der Worktree teilt ihre Referenzen:

```bash
git -C <pfad> rebase origin/<mainBranch>
```

Das Rebase ist nötig, weil ein früherer Worktree-Release seinen Commit nur auf `origin`
gelegt hat; ohne es liefe der Push ins `non-fast-forward`. Schon übernommene Commits
überspringt das Rebase von selbst. **Ein Konflikt hält an:** kein Prüflauf, kein Commit,
kein Push. Der Skill meldet die Konfliktdateien, entfernt den Worktree (Schritt 8) und
endet — das Zusammenführen ist Handarbeit des Menschen.

**Pro.** **Den Hotfix-Stand übernehmen** (Plan #2038, E6). Hat Schritt 2 einen übernommenen
Hotfix gemeldet, macht der Skill nach dem Rebase und vor dem Prüflauf den Auslieferungszweig
zum Vorfahren des Batches. `<productionBranch>` ist der Wert aus der Config (Default:
`production`):

```bash
git -C <pfad> fetch origin <productionBranch>
git -C <pfad> merge-base --is-ancestor origin/<productionBranch> HEAD
```

Endet die zweite Zeile mit Exit 0, ist er schon Vorfahr, und der Merge entfällt. Sonst:

```bash
git -C <pfad> merge -s ours origin/<productionBranch> -m "chore: Hotfix-Stand von <productionBranch> übernommen"
```

Der Fix steckt über die Zeile `Hotfix:` bereits im Batch; `-s ours` behält dessen Stand und
verwirft nur die Versions- und Changelog-Zeilen des Hotfix, die allein auf
`<productionBranch>` liegen. Ohne diesen Merge träfe der nächste `merge production` in
Versions- und Änderungsprotokolldateien einen Konflikt, den `code pr` nicht löst. Scheitert
der Merge, hält der Skill an wie bei einem Rebase-Konflikt.

**Alle Kommandos der Schritte 4 bis 7 laufen in diesem Worktree — ohne `cd`.** Claude Code
setzt das Arbeitsverzeichnis außerhalb der erlaubten Verzeichnisse nach jedem Aufruf zurück,
und ein zusammengesetzter Aufruf mit vorangestelltem `cd` fällt nicht mehr unter
`sandbox.excludedCommands` — der Prüflauf liefe in der Sandbox (Issue #1372). Darum nennt
jeder Aufruf den Worktree selbst und steht allein:

- **git:** `git -C <pfad> …`
- **der Prüflauf:** `checks.mjs run --in <pfad> …` (Schritt 5)
- **jedes andere Kommando**, etwa aus `RELEASING.md`:
  `node .claude/kit/worktree.mjs in <pfad> -- <kommando> [argumente]` — es startet das
  Kommando ohne Shell mit dem Worktree als Arbeitsverzeichnis und reicht Ausgabe und
  Exitcode durch.

Ein Commit im falschen Baum ist genau der Fehler, den dieser Schritt beseitigt; mit `-C`
und `--in` steht der Baum in jedem Aufruf.

**Bei Übernahme entfallen die Schritte 4 bis 6.** Der vorbereitete Commit trägt Bump und
Changelog schon, und sein Prüflauf war grün; ein zweiter Bump wäre eine weitere Version.
Statt der drei Schritte steht eine Zeile mit `zeitpunkt` und `commit` aus der Ausgabe von
`check-preparation`:

> `Übernimmt den vorbereiteten Stand vom <zeitpunkt> (<commit>)`

Schritt 7 fährt dann, was in der Vorbereitung offen blieb (das Feld `offen`): den Vor-Push-Schritt aus
`RELEASING.md` wie beschrieben. Auf dem Weg über den Build-Dienst ist das der Push auf den
Prüfzweig, das Warten auf den Build-Dienst und der Push auf `<mainBranch>` nur bei Grün,
wie im Abschnitt „Weg über den Build-Dienst" (Plan #1243, E17). Den Mutationstest hat der vorbereitende
Lauf über genau diesen Stand gefahren; sein Ergebnis nennt der Bericht in Schritt 9 aus dem
Feld `mutation` von `check-preparation` (Plan #1671, E4). Ein offener Punkt `Gewackelt: <cmd> — Entscheidung beim push main` (ein Wackler im Lauf
der Vorbereitung, Plan #1395, E14) wird wie jeder offene Punkt vor dem Push in Schritt 7 erfragt,
mit der Frage aus Schritt 5: Der Skill nennt die Prüfung und fragt „Trotzdem fortfahren? (ja/nein)“;
nur `ja` pusht. Die Fortschrittszeilen zählen die entfallenen Schritte nicht mit.

Vor der Frage nennt der Skill die Reparaturkandidaten aus
`pro run effectiveness -- candidates`.

**Abhängigkeiten im frischen Worktree.** Er trägt nur, was versioniert ist, plus das
gespiegelte `.claude/`. Braucht ein Pflichtcheck Abhängigkeiten **im Projektverzeichnis**
(`node_modules`, `.venv`, `vendor/`), fehlen sie dort. Ist `installCommand` in der Config
gesetzt, stellt `worktree.mjs create` sie bereits selbst her — das Feld nennt das
Installationskommando des Projekts (`npm ci`, `uv sync`, …), und ein roter Lauf baut den
Worktree wieder ab. Ohne gesetztes Feld bleibt es am Aufrufer: Dann werden sie vor dem
Prüflauf von Hand angelegt. **Nicht** aus der
Hauptkopie herüberkopieren oder verlinken: Ein geteiltes Bauverzeichnis ist genau die
Vermischung, die dieser Weg beendet — im Vorfall teilten sich zwei `mvn verify` dasselbe
`target/`. Caches **außerhalb** des Projektverzeichnisses (`~/.m2`, npm-Cache) gelten
weiter und brauchen nichts. Lässt sich die Installation nicht herstellen, endet der Lauf
**ohne Commit und ohne Push** mit diesem Grund: Ein Check, der an fehlenden Abhängigkeiten
scheitert, wird nie als grüner Lauf gemeldet und nie ausgelassen.

### 4. Release-Dateien erzeugen (falls `RELEASING.md` existiert)

> `Schritt 4 von 9 — Release-Dateien erzeugen (laeuft)`

Prüfe, ob im Repo-Root eine `RELEASING.md` liegt.
- **Ja:** Führe die dort unter dem Push-Trigger (`push main`) beschriebenen Schritte aus —
  **bis zum ersten festschreibenden Schritt**, also typischerweise Bump, Stempel und
  Changelog. Nicht committen, nicht pushen: Das kommt aus Schritt 5 und 6. Jeder Schritt
  läuft im Worktree über `node .claude/kit/worktree.mjs in <pfad> -- <kommando>`, etwa
  `node .claude/kit/worktree.mjs in <pfad> -- node tools/version.mjs --patch`.
- **Nein:** Nichts weiter tun — direkt weiter zu Schritt 5.

**Fremde `RELEASING.md`.** Die Grenze ist der erste Schritt, der festschreibt oder
veröffentlicht (`git commit`, `git push`, `git tag`, ein Release-Kommando). Alles davor
fährt der Skill; ab dort übernimmt er mit Lauf, Commit und Push. Stehen **hinter** dem
ersten festschreibenden Schritt noch weitere Schritte, führt der Skill sie nach seinem
Commit aus und sagt das im Abschlussbericht.

**Reihenfolge der Schritte.** Der Skill fährt die Schritte in der Reihenfolge der
`RELEASING.md`. Im Kit-Repo heißt das: `changelog.mjs --marke` vor `sync-blobs.mjs`, weil
`sync-blobs.mjs` die fertige `CHANGELOG.md` als Blob in den Installer bettet.

**Nach-Push-Schritt.** Nennt `RELEASING.md` einen Nach-Push-Schritt, gehört er nicht in
diesen Schritt: Der Skill fährt ihn in Schritt 8, in der Hauptkopie nach dem Nachziehen.

Der Skill selbst kennt keine projektspezifische Versions- oder Release-Logik; diese lebt
ausschließlich in der `RELEASING.md` des jeweiligen Repos.

### 5. Der eine Prüflauf (Gate — vor Commit und Push)

> `Schritt 5 von 9 — Prueflauf (laeuft)`

Jetzt liegen alle Dateien des Wegs auf der Platte: die Release-Dateien aus Schritt 4 — **im
Worktree**, und dort misst der Lauf sie. Genau diesen Stand misst **ein** Lauf:

Der Lauf misst mit `--in` im Worktree (Issue #1372):

```bash
node .claude/kit/checks.mjs run --in <pfad> --stage push --retry --since "$(git -C <pfad> merge-base HEAD origin/<mainBranch>)"
```

`<mainBranch>` ist der Wert aus der Config (Default: `main`).

**`--retry`: eine rote Prüfung einmal auf demselben Stand** (Plan #1395, E2). Ist sie
bei der Wiederholung grün, gilt sie als bestanden und hat gewackelt; der Berichtsblock
trägt unter ihrer Zeile `gelaufen:` die Zeile `Gewackelt: <cmd> → erst rot, dann gruen`.
Bleibt sie rot, ist sie rot wie bisher.

**Dieser Skill fährt die Push-Stufe, und die fährt den vollen Umfang.** Es laufen
zusätzlich zu den Prüfungen der Paketstufe alle, die ihr Projekt für den Zeitpunkt des
Veröffentlichens vorgesehen hat — und zwar **jede von ihnen**, auch bei unberührten
Bereichen und auch dann, wenn seit dem Anker nichts geändert wurde. Vor dem Push wird der
Stand gemessen, der hinausgeht, und der besteht aus mehr als dem letzten Arbeitspaket. Der
Lauf nennt die **zusätzlichen Prüfungen vorab** in einer eigenen Zeile (`Stufe push:
zusaetzlich zur Paketstufe laeuft …`) — er wird darum spürbar **länger dauern** als der
Lauf je Arbeitspaket in `/implement-next`. Das ist der vorgesehene Zeitpunkt und kein
Grund, ihn abzukürzen.

**Der Mutationstest verlängert den Vordergrundlauf.** Hat das Projekt `mutationCommand`
eingerichtet, fährt der Lauf ihn nach allen `buildChecks` genau einmal, auch mit `--retry`
kein zweites Mal; dieselbe Zeile `Stufe push:` kündigt ihn an. Er dauert oft länger als alle
übrigen Prüfungen zusammen, und der Lauf bleibt dabei im Vordergrund. Ein roter
Mutationstest hält nichts an: Der Berichtsblock trägt ihn als Zeile `Mutationstest: …` —
nur berichtet, ohne Einfluss auf Exitcode und Ergebnis. Ist eine Prüfung rot, entfällt er.

**Der Anker ist der Batch, nicht `HEAD`.** Er entscheidet nicht mehr, **was** läuft — an
dieser Stufe läuft ohnehin alles —, sondern welchen Stand die Zusammenfassung **bezeugt**:
`basis`, `geaendert` und die Blob-Hashes, gegen die das Commit-Gate den Index prüft. Ohne
`--since` nimmt `planen` in `kit/checks.mjs` `HEAD` als Basis, und der Nachweis spräche
dann über das letzte Stück statt über den Batch, der gleich hinausgeht.

- **Im Vordergrund ausführen** und die Exit-Codes ehrlich auswerten — niemals den
  Exit-Code durch ein nachgestelltes `echo` oder eine Umleitung maskieren. Den
  Rückgabewert jedes Prüfkommandos und die allgemeinen Fehlermerkmale in seiner
  Ausgabe liest `checks.mjs run` selbst; ein Treffer färbt die Prüfung rot.
- **Ein roter Lauf hält alles an:** kein Commit, kein Push. Klare Meldung, **welcher**
  Check mit welchem Fehler fehlschlug. Der Lauf nennt dazu je roter Prüfung die
  **Verursacher-Karten** in einer eigenen Zeile (`Verursacher (<cmd>): …`) — die Karten,
  deren Commits seit dem Anker die Dateien dieser Prüfung berührt haben. Übernimm die
  Zeilen unverändert in den Bericht. Die Reparatur ist eine **neue Karte**: Die
  verursachende Karte wandert **nicht aus „In review" zurück** — sie ist abgeschlossen
  und wartet auf den Test des Menschen, und ein Rückzug verlöre genau diesen Stand.
  Genannt wird sie, damit die neue Karte weiß, wo sie ansetzt. Der Worktree wird trotzdem **abgebaut** (Schritt 8),
  und der Bericht sagt das: Der Bump ist seit Issue #656 idempotent, ein neuer Anlauf
  erzeugt ihn wieder — ein stehengebliebener Worktree wäre genau der Rest, den dieser Weg
  beseitigt.
- **Hinweise werden gezeigt, nicht gewertet.** Eine Hinweis-Prüfung endet grün und
  schreibt ihre Funde als `hinweis: <Datei und Grund>` in den Block `Fuer den
  Abschlussbericht:`. Die `hinweis:`-Zeilen gehen unverändert in den Bericht an den
  Menschen und halten weder Commit noch Push an — sie verlangen keine Freigabe
  (Issue #1156).
- Ist `buildChecks` leer: Hinweis „Keine buildChecks konfiguriert." und weiter zu
  Schritt 6 (kein Abbruch).

**Nach einem Wackler hält der Skill vor dem Commit an** (Plan #1395, E13). Unmittelbar
nach dem grünen Lauf, vor Schritt 6, liest er den Block `Fuer den Abschlussbericht:`
**dieses** Laufs. Auslöser ist allein eine Zeile `Gewackelt:` ohne den Zusatz
`(früherer Lauf vom …)` — sie steht für das Feld `gewackelt` an einem Eintrag in
`laufen[]` dieses Laufs. Nie ausgelöst wird der Halt durch `gewackeltKarte` oder eine
vorige Zusammenfassung. Dann, in dieser Reihenfolge:

1. Die gewackelten Prüfungen mit Namen nennen, die `Gewackelt:`-Zeilen unverändert.
2. Die Reparaturkandidaten holen und nennen (Plan #1395, E15):

   ```bash
   node .claude/kit/board.mjs pro run effectiveness -- candidates
   ```

   Es liest `.claude/wirksamkeit.json` der Hauptkopie und gibt je Kandidat eine Zeile
   `Reparaturkandidat: <cmd> — <n> Wackler im Zeitfenster` aus; leere Ausgabe heißt kein
   Kandidat.
3. Wörtlich fragen: „Trotzdem fortfahren? (ja/nein)“ Nur `ja` fährt fort mit Schritt 6.
   Alles andere endet wie ein roter Lauf: kein Commit, kein Push, weiter mit Schritt 8,
   der Worktree wird abgebaut.

`checks.mjs run` endet in diesem Fall mit Exitcode 0 — die Prüfung ist bestanden, die
Entscheidung liegt beim Menschen.

**Ohne Wackler** ruft der Skill `pro run effectiveness -- candidates` ebenfalls, an
derselben Stelle: Reparaturkandidaten ohne Wackler werden genannt, halten aber nicht an.

Warum überhaupt noch ein Lauf, wenn `/implement-ready` je Issue schon prüfte: Der
Nachweis gehört zum **Commit**, und die Dateien aus Schritt 4 hat kein früherer Lauf
gesehen. Ohne Nachweis für genau diesen Stand weist das Commit-Gate den
Commit ab.

**Befunde buchen, wenn Code-Review-Befunde eingearbeitet wurden.** Sind vor diesem Push
Funde aus einem `/kit-review` eingearbeitet worden, hält die Session das in einem
Einarbeitungs-Kommentar am Issue fest — übernommen / abgelehnt mit Grund je Fund, im Muster
von `/issue-review` —, ergänzt den Befunde-Text je Fundblock um die Zeile
`Uebernahme: uebernommen` beziehungsweise `Uebernahme: abgelehnt` und schreibt ihn nach der
Transportregel als eigene Datei außerhalb des Projektverzeichnisses:

```bash
node .claude/kit/worktree.mjs in <pfad> -- node .claude/kit/board.mjs pro run findings -- record --file <tmpdir>/<id>-buchung.md --stage code --card <id>
```

**Gebucht wird im Worktree**, weil der Vergleichsstand die Zusammenfassung des Prüflaufs
liest — und die liegt dort. Die Buchung kommt in Schritt 8 in die Hauptkopie zurück, und
**erst dort** entsteht je Art ein Vorschlag: Die Schwelle zählt den Gesamtstand des
Projekts, und der steht in der Hauptkopie.

**Hier und nicht früher.** Der Vergleichsstand der Code-Stufe fragt, ob jede heute geänderte
Datei von `.claude/checks-summary.json` gedeckt ist. Vor Schritt 5 trüge die Zusammenfassung
den Stand **vor** der Einarbeitung, und jede dabei geänderte Datei machte den Stand
`nicht-vergleichbar`, obwohl die Pflichtprüfungen gleich darauf grün laufen. Nach dem
Prüflauf liegt eine Zusammenfassung über genau den Stand vor, auf dem gebucht wird.

Liegen keine Code-Review-Befunde vor, entfällt dieser Block **ohne Vermerk**. **Kein Gate:**
Ein Fehlschlag von `buchen` oder `vorschlag` wird in **einer Zeile** vermerkt und hält
Commit und Push nicht auf. Wie der Befund-Block vor Schritt 1 trägt dieser Block **keine
Nummer** und zählt in keiner Fortschrittszeile mit.

**Nach einem roten Prüflauf legt der Skill die Reparaturkarten an** (Plan #2087, A1, A4). Der
Lauf der Push-Stufe sammelt alle Funde: Eine rote Prüfung beendet ihn nicht, jede Prüfung
bekommt ein Ergebnis, bis die Obergrenze erreicht ist. Die Meldung nennt darum alle roten
Prüfungen auf einmal. Noch vor Schritt 8, solange der Worktree steht, legt der Skill aus
der Zusammenfassung dieses Laufs die Reparaturkarten an:

```bash
node .claude/kit/board.mjs issue repair --summary <pfad>/.claude/checks-summary.json
```

Der Befehl legt je Ursache und Plan eine Karte im Backlog an und kommentiert stattdessen eine
schon offene Karte derselben Ursache; ein Fund an der Umgebung wird keine Karte, sondern ein
Handgriff. Die Meldung nennt die angelegten und die kommentierten Karten mit Nummer und die
Handgriffe, jeden mit seinem einen Schritt. Nach Ready zieht der Skill keine Karte: Das GO
für die Reparatur gibt der Mensch. Scheitert der Aufruf, steht das mit seinem Grund in der
Meldung; der Halt bleibt, wie er ist.

**Die Sicherheitsprüfung vor jedem Push** (Plan #1988, E3 bis E6). Nach dem grünen Prüflauf
und einem beantworteten Wackler, vor Schritt 6. Den Ablauf beschreibt `sicherheit.md` neben
diesem Skill (`.claude/skills/push-main/sicherheit.md`); der Skill liest die Datei und fährt
ihn, wie er dort steht.

Vorher fragt er die Strenge ab:

```bash
node .claude/kit/board.mjs config strictness
```

Steht im Feld `vorgaben` der Ausgabe `sicherheit` auf `vor-auslieferung` (die Vorgabe von
`light`), entfällt die Sicherheitsprüfung hier: weiter mit Schritt 6, und Schritt 9 trägt die
Zeile `Sicherheitsprüfung: entfällt (Strenge <strenge>, sicherheit vor-auslieferung) — nachgeholt
vor der Auslieferung in merge production`. Bei `vor-push` läuft sie nach `sicherheit.md`. Scheitert
die Abfrage, läuft sie ebenfalls — wie in `normal`.

**Pro.** **Das nachgeholte Review je offenem Hotfix** (Plan #2038, E3; Kriterium 5 und 10 der
fachlichen Quelle #2004). Nach der Sicherheitsprüfung, vor Schritt 6, für jeden Eintrag aus
`uebernommen` (Schritt 2). Geprüft wird der Commit mit der Zeile `Hotfix:` — er ist der
reguläre Stand, der den Fix enthält, samt einer Konfliktlösung bei der Übernahme:

```bash
git -C <pfad> show <commit> > <tmpdir>/hotfix-<version>-material.txt
```

```bash
node .claude/kit/board.mjs issue-review review-brief --role code-review --material-file <tmpdir>/hotfix-<version>-material.txt --file <tmpdir>/hotfix-<version>-auftrag.md
```

Den Prüfer wählt dasselbe Feldpaar wie bei der Sicherheitsprüfung, mit derselben Grenze von
10 Minuten; die Antwort steht danach unverändert in `<tmpdir>/hotfix-<version>-antwort.md`.
Ausgewertet wird sie vom Kit:

```bash
node .claude/kit/board.mjs issue-review review-result --file <tmpdir>/hotfix-<version>-antwort.md
```

Gehandelt wird allein nach `ergebnis`:

- **`ok`** — kein Fund KRITISCH. Weiter; die übrigen Befunde nennt Schritt 9 und der
  Kommentar an die Hotfix-Karte in Schritt 7.
- **`kritisch`** — endet wie ein roter Prüflauf: kein Commit, kein Push, weiter mit
  Schritt 8. Der Bericht nennt jeden Fund KRITISCH im Wortlaut; die Reparatur ist eine neue
  Karte, und der Hotfix bleibt offen.
- **`ausfall`** — keine auswertbare Antwort, die Zeitgrenze überschritten oder ein
  gescheiterter Aufruf, auch von `review-brief` oder `review-result` selbst. Der Skill fragt
  wörtlich: „Review des Hotfix v<version> ausgefallen: <Grund>. Ohne es veröffentlichen?“ Nur
  `ja` fährt fort, und Schritt 7 vermerkt an der Karte „ohne Review abgeschlossen“ mit dem
  Grund. Alles andere endet wie ein roter Lauf: kein Commit, kein Push, weiter mit Schritt 8.

**Pro.** **Rote Nachprüfung eines Hotfix** (Kriterium 10). Ist der Prüflauf dieses Schritts
bei offenem Hotfix rot, gilt dasselbe wie ohne Hotfix: Der
Lauf nennt die Reparatur als neue Karte, nichts geht hinaus, und der Hotfix bleibt offen. Die
Zeile `Hotfix:` liegt dann weiter im Bereich, und der nächste Anlauf prüft ihn wieder nach.

### 6. Der eine Commit

> `Schritt 6 von 9 — Commit (laeuft)`

**Im Worktree** — jedes git-Kommando mit `-C <pfad>`, siehe Schritt 3.

```bash
git -C <pfad> add <die Dateien aus Schritt 4>
git -C <pfad> commit -m "<Betreff nach der Regel unten>"
```

**Betreff.** Hat Schritt 4 Release-Dateien erzeugt: `chore: vX.Y.Z` mit der Kennung aus
dem Bump.

**Nie ein Suffix `(Issue #N)` am Betreffende.** Daran und nur daran liest
`tools/changelog.mjs` die Paketnummer, und dieser Commit ist kein Arbeitspaket. Er
erscheint weiterhin im Changelog, dann ohne Paketreferenz; das ist gewollt. Aus demselben
Grund stehen in der Botschaft **keine** `#N`-Referenzen auf Nicht-Pakete.

Committet wird nur bei tatsächlichem staged Diff. Ist aus Schritt 4 nichts entstanden,
gibt es nichts festzuschreiben; der Ablauf geht ohne Commit weiter zu Schritt 7, und der
Push fährt allein die Commits aus Schritt 2.

### 7. Pushen

> `Schritt 7 von 9 — Push (laeuft)`

**Vor-Push-Schritt.** Nennt `RELEASING.md` einen Vor-Push-Schritt, fährt der Skill ihn
nach dem Commit (Schritt 6) und vor dem Push, im Worktree über
`node .claude/kit/worktree.mjs in <pfad> -- <kommando>`, **im Hintergrund**, und wartet
auf dessen Ende — er kann länger laufen, als ein Werkzeugaufruf im Vordergrund darf, und
endet nach seiner eigenen Frist von selbst. Seine Fortschrittszeilen und seine Schlusszeile
zeigt der Skill, bevor er pusht. Er ist kein eigener Schritt: Die Zählung bleibt `von 9`.
Nennt `RELEASING.md` keinen, oder gibt es keine `RELEASING.md`, entfällt er ersatzlos.

- Exit 0 — weiter zum Push.
- Exit 1 — die Prüfung ist rot. Der Skill zeigt das Ergebnis und fragt wörtlich:
  „Vor-Push-Prüfung rot. Trotzdem pushen? (ja/nein)“ Nur `ja` pusht;
  alles außer „ja“ heißt kein Push, weiter mit Schritt 8.
- Jeder andere Exit — Halt ohne Push, mit der Meldung des Werkzeugs; weiter mit Schritt 8.

Aus dem Worktree, der auf einem losgelösten `HEAD` steht:

```bash
git -C <pfad> push origin HEAD:<mainBranch>
```

**Kein `--force`, auch nicht nach dem Rebase.** Der Push ist nach Schritt 3 ein
Fast-Forward; wird er abgewiesen, ist `origin` zwischenzeitlich weitergelaufen — dann endet
der Lauf mit dieser Meldung, und der Mensch entscheidet.

Nach dem Push auf `<mainBranch>` — auch auf dem Weg über den Build-Dienst — verwirft der
Skill eine übernommene Vorbereitung mit `check-preparation --discard`, wie in
Schritt 3 beschrieben. Ohne Push bleibt sie für den nächsten Anlauf liegen.

**Nullpunkt des Integrationslaufs.** Nur nach einem gelungenen Push auf `<mainBranch>` —
auf jedem Weg: lokal, über den Build-Dienst, auf dem Notfallweg und über `publish-state`
(Abschnitt „Der geprüfte Stand“) — trägt der Skill den gepushten Commit mit dem Ergebnis `gruen` in
`.claude/integration.json` der Hauptkopie ein (Plan #1969, E6). Der Stand ist dann im
vollen Umfang geprüft, und der nächste Integrationslauf zählt seine Pakete ab hier.
`<sha>` ist die Ausgabe von `git -C <pfad> rev-parse HEAD`, der Aufruf läuft in der
Hauptkopie:

```bash
node .claude/kit/checks.mjs integration --pushed <sha>
```

Ohne Push, nach einem abgewiesenen Push und nach einem Halt entfällt er. Scheitert er,
steht das als eine Zeile im Bericht; der Push ist schon geschehen.

**Pro.** **Den Hotfix abschließen** (Plan #2038, E9; Kriterium 10). Nur nach einem gelungenen
Push auf `<mainBranch>`, auf jedem Weg wie der Nullpunkt, für jeden Eintrag aus `uebernommen`
(Schritt 2), in der Hauptkopie. Zuerst die Karte und die nachgeholten Prüfungen: Das Feld
`offen` von

```bash
node .claude/kit/board.mjs release state
```

nennt je Version `karte` und `nachzuholen`. Dann gilt der Hotfix als nachgeprüft:

```bash
node .claude/kit/board.mjs release verified --version <version>
```

Steht die Karte am Board (`karte` nicht `null`), geht ein Kommentar an sie — Hotfix
v<version> abgeschlossen, der gepushte Commit, je Prüfung aus `nachzuholen` ihr Ergebnis aus
Schritt 5, das Ergebnis des Reviews samt Befunden und bei einem Ausfall „ohne Review
abgeschlossen“ mit Grund. Er geht nach der Transportregel: Datei
`<tmpdir>/<karte>-hotfix-abgeschlossen.md` stückweise per Shell anlegen, dann

```bash
node .claude/kit/board.mjs issue comment <karte> --text-file <tmpdir>/<karte>-hotfix-abgeschlossen.md
```

Danach nimmt der Skill das Label ab:

```bash
node .claude/kit/board.mjs issue label remove <karte> kit:hotfix
```

Ohne Karte (`karte: null`, ein Hotfix ohne Board) entfallen Kommentar und Label; die Karte
entsteht später mit `release attach-card`, und der Hotfix steht bis dahin in `ohneKarte`.
Ein Fehlschlag eines dieser Aufrufe steht als eine Zeile im Bericht und hält nichts auf, der
Push ist schon geschehen. Ohne Push, nach einem abgewiesenen Push und nach einem Halt entfällt
der Absatz, und der Hotfix bleibt offen.

### 8. Rückweg, Nachziehen, Worktree abbauen

> `Schritt 8 von 9 — Rueckweg und Abbau (laeuft)`

Die drei Schritte laufen **immer**, auch nach einem roten Prüflauf, einem Rebase-Konflikt,
einem Halt im Vor-Push-Schritt oder einem abgewiesenen Push — ein liegengebliebener Worktree ist genau der Rest, den
dieser Weg beseitigt.

**Den Anlauf festhalten** (Plan #2131, A12; Kriterium 6 der fachlichen Quelle #2130). Zuerst,
in der Hauptkopie, eine Zeile für diesen Anlauf in `.claude/veroeffentlichungen.tsv`:

```bash
node .claude/kit/worktree.mjs attempt --base <sha> --commit <sha> --result <green|red|aborted|pushed> --reason "<grund>"
```

Das erste `<sha>` ist die Basis, `git rev-parse origin/<mainBranch>` in der Hauptkopie nach dem
Fetch aus Schritt 3 und vor dem Push: Anläufe mit derselben Basis zählen zu einer
Veröffentlichung. Das zweite ist `git -C <pfad> rev-parse HEAD`. Der Ausgang:

- `pushed` — der Push auf `<mainBranch>` ist gelungen, auf jedem Weg; `--reason` entfällt.
- `red` — eine Prüfung war rot: der Prüflauf oder der Nachweislauf (Schritt 5), die
  Sicherheitsprüfung mit `kritisch`, die Vor-Push-Prüfung ohne `ja` oder das Urteil des
  Build-Diensts. `--reason` nennt die rote Prüfung.
- `green` — alles war grün, gepusht wurde trotzdem nicht, etwa nach einem `nein` auf eine
  Rückfrage. `--reason` nennt, warum nicht.
- `aborted` — der Lauf hielt an, bevor ein Urteil feststand: Rebase-Konflikt, fehlende
  Abhängigkeiten, abgewiesener Push, Ablauf der Frist, kein Lauf im Build-Dienst.
  `--reason` nennt den Halt.

Scheitert der Aufruf, steht das als eine Zeile im Bericht; der Abbau läuft weiter.

Erst das, was in der Hauptkopie weiterzählt:

```bash
node .claude/kit/worktree.mjs return <pfad>
```

Das Kommando ersetzt `.claude/checks-summary.json` der Hauptkopie durch die des Worktrees
(sie bezeugt den frisch gemessenen Stand), hängt das Ausführungsprotokoll
(`.claude/ausfuehrungen.tsv`) und die Befunde (`.claude/befunde.tsv`) an und nennt in
`befundeArten` die Arten, die damit die Schwelle erreichen.

Für **jede** davon ein Aufruf:

```bash
node .claude/kit/board.mjs pro run findings -- suggest --kind <a>
```

Dann das lokale `<mainBranch>`, das nach dem Push aus dem Worktree hinter `origin`
zurückliegt:

```bash
node .claude/kit/worktree.mjs catch-up-check
```

- **`nachziehen: true`** — in der Hauptkopie `git fetch origin <mainBranch>` und
  `git rebase origin/<mainBranch>`. Ist das Rebase durch, fährt der Skill den
  **Nach-Push-Schritt** aus `RELEASING.md`, falls sie einen nennt — in der Hauptkopie, als
  eigener Aufruf ohne Verkettung. Die Hauptkopie steht dann auf dem eben veröffentlichten
  Stand, an den sich auch jeder unbeaufsichtigte Lauf bindet. Scheitert er, steht das als
  eine Zeile im Bericht, mit seiner Meldung — kein Halt, der Push ist schon geschehen.
- **`nachziehen: false`** — **nicht** nachziehen. Der Skill nennt den `grund` und gibt die
  beiden Kommandos als kopierbare Zeile aus, dahinter das Kommando des Nach-Push-Schritts,
  falls `RELEASING.md` einen nennt: Er entfällt dann, denn er soll dem veröffentlichten
  Stand folgen, nicht einem älteren. Ein Rebase unter einer laufenden Umsetzung
  verschöbe ihr den Boden, und in einem schmutzigen Baum hielte er ohnehin an.

Nennt `RELEASING.md` keinen Nach-Push-Schritt, oder gibt es keine `RELEASING.md`, entfällt
er ersatzlos.

Zuletzt der Abbau:

```bash
node .claude/kit/worktree.mjs remove <pfad>
```

### 9. Bestätigung

Melde den neuen Stand auf `origin/<mainBranch>` mit dem letzten Commit-Hash.

**Die Nachweiszeile, je erzeugtem Commit.** Nenne den Hash, das Ergebnis des deckenden
Laufs und dessen `zeitpunkt` aus der Prüf-Zusammenfassung (`.claude/checks-summary.json`,
Issue #655):

```
<hash> — gedeckt von: node --test, node tools/sync-blobs.mjs --check (gruen, 2026-09-16 08:14)
```

Gelesen wird die Zusammenfassung des **Worktrees** — dort lief die Prüfung. Nach Schritt 8
liegt sie in der Hauptkopie und sagt dasselbe; vor dem Abbau ist der Worktree die Quelle.
Der Zeitpunkt ist der Punkt: Er sagt, ob der Nachweis zu diesem Stand gehört oder von
einem früheren Lauf stammt. Hat Schritt 6 keinen Commit erzeugt, gehört auch **das** in
den Bericht — ein Lauf ohne Commit sieht sonst aus wie ein Lauf mit Commit.

**Wackler und Reparaturkandidaten.** Der Bericht nennt jede `Gewackelt:`-Zeile des
Prüflaufs unverändert samt der Antwort des Menschen auf die Rückfrage. Ohne sie und ohne
Reparaturkandidaten entfällt der Absatz.

Dazu nennt er jede Zeile `Reparaturkandidat:` aus
`pro run effectiveness -- candidates` (Schritt 5).

**Strenge.** Der Bericht nennt die Strenge in der Zeile `zeile` aus `config strictness`
(Schritt 5).

**Sicherheitsprüfung.** Der Bericht nennt ihr `ergebnis` aus Schritt 5, jede angelegte und
jede kommentierte Karte mit Nummer und Titel und die Befunde WICHTIG und HINWEIS. Hat der
Mensch nach einem Ausfall mit `ja` geantwortet, steht dort „ohne Sicherheitsprüfung
veröffentlicht“ mit dem Grund des Ausfalls. Hat Schritt 3 eine Vorbereitung übernommen,
nennt der Bericht das Ergebnis der Vorbereitung aus dem Feld `sicherheit` von
`check-preparation`. Ist sie wegen der Strenge entfallen, steht dort die Zeile
`Sicherheitsprüfung: entfällt …` aus Schritt 5, bei übernommener Vorbereitung der `vermerk` aus
dem Feld `sicherheit`.

**Mutationstest.** Der Bericht nennt das Ergebnis des Mutationstests: die Zeile
`Mutationstest: …` aus dem Berichtsblock des Prüflaufs in Schritt 5 unverändert, bei
Übernahme einer Vorbereitung das Feld `mutation` von `check-preparation` (Kommando,
Ergebnis, Exit, Dauer). Auf dem Weg über den Build-Dienst steht dort
`Mutationstest: im Build-Dienst gelaufen, Ergebnis im Build-Log` (Plan #1671, E5). Ohne
eingerichteten Mutationstest entfällt der Absatz.

**In den Bericht gehören außerdem:** der Pfad des Worktrees und sein Abbau, ob das lokale
`<mainBranch>` nachgezogen wurde oder mit welchem Grund nicht, und dass der
Haupt-Working-Tree unberührt geblieben ist.

**CI-Hinweis, abhängig vom `codeHost`.** Bei `github` und `gitlab` gehört in den Abschlussbericht: „Falls der Push einen CI-Lauf auslöst, wird er hier nicht gegatet; `merge production` prüft den Commit." Einzige Ausnahme ist die Vor-Push-Prüfung aus Schritt 7, wenn `RELEASING.md` eine nennt: Ihr Ergebnis lag vor dem Push vor, und der Bericht nennt es. Bei `local` entfällt der Hinweis ersatzlos. Der Zustand der CI wird hier **nicht abgefragt** — der Lauf zum eben gepushten Commit ist Sekunden später nie fertig, ein Gate müsste warten, und `push main` ist der häufige Trigger. Geprüft wird die CI am Release, in `/merge-production` (Issue #316).

Hinweis auf nächsten Schritt:
> "Commit-Batch gepusht. Wenn der Test-Server automatisch zieht: dort prüfen. Dann auf Wunsch \`merge production\` für den PR nach production."

## Der geprüfte Stand (`publish-state`)

**Pro.** Gilt, wenn Schritt 1 im Feld `"pushPruefung"` ein Objekt mit `"ort": "buildDienst"`
meldet, ohne das Argument `full` und außerhalb des Notfallwegs (Plan #2145, E12; Kriterium 3 der
fachlichen Quelle #2142). Die Prüfung je Karte hat jeden fertigen Stand schon im Build-Dienst
geprüft, samt Sicherheitsprüfung; `push main` prüft hier nichts mehr selbst und startet nichts —
kein Worktree, kein Prüflauf, kein Commit. Es schiebt genau den Commit, den der Build-Dienst grün
geprüft hat, oder nennt, warum es das nicht kann. Die Schritte 1 und 2 oben laufen vorher, die
Schritte 3 bis 9 entfallen; dieser Weg zählt seine eigenen, `Schritt k von 4`.

**Offene Hotfixes.** Hat Schritt 2 übernommene Hotfixes gemeldet (`uebernommen` nicht leer),
endet der Lauf vor Schritt 1 mit diesem Grund: Den Auslieferungszweig zum Vorfahren machen und das
Review nachholen (Schritt 3 und 5) veränderte den geprüften Stand. Der Weg nach vorn ist
`/push-main full`.

> `Schritt 1 von 4 — Stand lesen (laeuft)`

In der Hauptkopie:

```bash
node .claude/kit/worktree.mjs publish-state
```

Das Kommando holt `origin` selbst und meldet als JSON `ergebnis`, `commit`, `zweig` (der eigene
Prüfzweig dieses Rechners), `karten`, `jobs`, `adresse`, `sicherheit`, `kitStand`, `handgriff`,
`ursache` und `naechsterSchritt`. Im Kit-Repo steht davor eine Zeile `Kit-Stand:` mit Commit und
Herkunft; der Skill gibt sie unverändert weiter, denn mit diesem Stand des Kits arbeitet der Lauf
(Plan #2145, E16). Dann nennt er in einer Zeile das `ergebnis` mit den Karten aus `karten`.
Gehandelt wird allein nach `ergebnis`:

- **`gruen`** — der Build-Dienst hat `commit` grün geprüft, `commit` enthält jeden lokalen Commit
  und den Kopf jedes fremden Prüfzweigs und folgt als Fast-Forward auf `origin/<mainBranch>`.
  Weiter mit Schritt 2.
- **`rot`** — der Skill nennt die roten Prüfungen aus `ursache`, je rotem Job den Namen aus
  `jobs` und die `adresse` (fehlt sie: „keine Adresse“).
- **`laeuft`** — der Skill meldet, dass die Prüfung noch läuft, mit `ursache`, und gibt nichts
  frei; er wartet nicht.
- **`nicht-geprueft`**, **`konflikt`** und **`unvollstaendig`** — der Skill nennt `ursache`, bei
  einem Fund an der Umgebung dazu `handgriff`.
- **`nichts`** — es gibt nichts zu veröffentlichen.

Bei jedem anderen `ergebnis` als `gruen` endet der Lauf mit `naechsterSchritt` als letzter
Zeile — ohne Push, ohne `attempt`, ohne eigene Prüfung und ohne Start. Ein solches `push main`
zählt nicht als Anlauf (Kriterium 6 der fachlichen Quelle #2130). Eine erneute Prüfung desselben
Stands löst der Mensch aus; `naechsterSchritt` nennt dann
`node .claude/kit/night.mjs --card-check --again`. Fällt der Build-Dienst aus, bleibt dem
Inhaber der Notfallweg `/push-main emergency`; den vollen Weg mit eigenem Prüflauf gibt es nur
mit `/push-main full`.

> `Schritt 2 von 4 — Push (laeuft)`

Ohne grünes Urteil der Sicherheitsprüfung gibt nur das ausdrückliche `ja` des Menschen frei
(#1978, Kriterium 9). Trägt `sicherheit` kein `ergebnis` `gruen` oder ist es `null`, fragt der
Skill wörtlich: „Sicherheitsprüfung für <commit> nicht grün: <ergebnis oder keine>. Ohne sie
veröffentlichen?“ Alles außer `ja` endet ohne Push; den Anlauf hält dann `attempt` mit
`--result red` (Sicherheitsprüfung `rot`) oder `--result aborted` (sonst) fest, beide mit
`--reason`. Nach einem `ja` vermerkt die Bestätigung „ohne Sicherheitsprüfung veröffentlicht“.

Dann der veröffentlichte Stand vor dem Push, in der Hauptkopie; seine Ausgabe ist `<basis>`, und
Anläufe mit derselben Basis zählen zu einer Veröffentlichung:

```bash
git rev-parse origin/<mainBranch>
```

Dann der Push, `<commit>` ist der volle Wert aus `publish-state`:

```bash
git push origin <commit>:<mainBranch>
```

Der Push geht ohne Worktree, ohne Prüflauf und ohne Commit: Hinaus geht genau der Commit, den der
Build-Dienst geprüft hat, bei erreichbarem Code-Host in höchstens 10 Minuten und im ersten Anlauf.
Den Schutz des Hauptzweigs prüft der Code-Host am Commit selbst (#1346). **Kein `--force`.** Wird
der Push abgewiesen, ist `origin` seit `publish-state` weitergelaufen: Der Skill hält den Anlauf mit
`--result aborted --reason "<Meldung>"` fest und endet; ein neues `push main` liest den Stand neu.

> `Schritt 3 von 4 — Anlauf und Nullpunkt (laeuft)`

Nach dem gelungenen Push, in der Hauptkopie, je ein Aufruf:

```bash
node .claude/kit/worktree.mjs attempt --base <basis> --commit <commit> --result pushed
```

```bash
node .claude/kit/checks.mjs integration --pushed <commit>
```

Der erste hält den einen Anlauf dieser Veröffentlichung fest (wie in Schritt 8), der zweite setzt
den Nullpunkt des Integrationslaufs (wie in Schritt 7). Scheitert einer, steht das als eine Zeile
im Bericht; der Push ist schon geschehen.

> `Schritt 4 von 4 — Nachziehen und Prüfzweig (laeuft)`

```bash
node .claude/kit/worktree.mjs catch-up-check
```

Bei `nachziehen: true` zieht die Hauptkopie nach, je Zeile ein Aufruf:

```bash
git fetch origin <mainBranch>
git rebase origin/<mainBranch>
```

Das Rebase überspringt die lokalen Commits, deren Patch der geprüfte Commit schon trägt, und
bringt so den Release-Commit und die Reparatur-Commits der Prüfung je Karte in den lokalen Zweig
(Plan #2145, E11). Danach fährt der Skill den Nach-Push-Schritt aus `RELEASING.md` wie in
Schritt 8. Bei `nachziehen: false` gilt Schritt 8: `grund` nennen, die Kommandos als kopierbare
Zeile, kein Nach-Push-Schritt.

Zuletzt der eigene Prüfzweig, `<zweig>` ist der Wert aus `publish-state`:

```bash
git push --force-with-lease=refs/heads/<zweig>:<commit> origin --delete <zweig>
```

Gelöscht wird nur der eigene Prüfzweig und nur, solange er auf `<commit>` steht; die Lease
schützt einen Stand, den die Prüfung je Karte inzwischen neu übertragen hat. Fremde Prüfzweige
löscht der Skill nie: Sie räumt der andere Rechner bei seiner nächsten Prüfung selbst, sobald
`origin/<mainBranch>` seine Commits als Patch enthält, damit seine Statusdatei nie auf einen fremd
gelöschten Zweig zeigt. Scheitert das Löschen, steht es als eine Zeile im Bericht.

**Bestätigung.** Der Bericht nennt den neuen Stand von `origin/<mainBranch>` mit dem Hash, die
Zeile `Kit-Stand:`, falls `publish-state` sie ausgab, die Karten aus `karten` und die
Nachweiszeile:

```
<commit> — gedeckt von: Build-Dienst, Prüfzweig <zweig> (gruen, <adresse>)
```

Dazu das Ergebnis der Sicherheitsprüfung aus `sicherheit` mit ihren Befunden, nach einem `ja`
„ohne Sicherheitsprüfung veröffentlicht“, ob das lokale `<mainBranch>` nachgezogen wurde oder mit
welchem Grund nicht und ob der Prüfzweig gelöscht ist. Hat das Projekt einen Mutationstest
eingerichtet, steht `Mutationstest: im Build-Dienst gelaufen, Ergebnis im Build-Log` dort. Der
CI-Hinweis entfällt: Der Build-Dienst hat vor dem Push geprüft. Den Hinweis auf den nächsten Schritt
gibt der Skill wie in Schritt 9.

## Weg über den Build-Dienst (`pushCheck`)

Gilt nur, wenn `checks.mjs plan --stage push` in Schritt 1 im Feld `"pushPruefung"` ein Objekt mit
`"ort": "buildDienst"` meldet (Issue #1216, Plan #1199 E14). Der volle Lauf findet dann im
Build-Dienst des Projekts statt statt auf diesem Rechner. **Die Pflicht ist dieselbe:**
Grün vor dem Push auf `<mainBranch>`, ein Rot hält an, `productionBranch` bleibt
unberührt. `<zweig>` ist der Wert aus `"zweig"` dieses Objekts, in der Config `pushCheck.branch`. Schritte, Zählung `von 9` und
Fortschrittszeilen bleiben; anders sind nur Schritt 5 und Schritt 7.

**Was der Build-Dienst fahren muss.** Ein Push auf `<zweig>` startet dort den Lauf der
Stufe `push` über den Batch:

```bash
node .claude/kit/checks.mjs run --stage push --since "$(git merge-base HEAD origin/<mainBranch>)"
```

Diesen Job richtet das Projekt in seinem Build-Dienst ein — dieser Skill legt ihn nicht an.
Weil der Lauf dort `checks.mjs` fährt, steht im Build-Log bei Rot dieselbe Zeile
`Verursacher (<cmd>): …` wie beim lokalen Lauf.

**Schritt 5 auf diesem Weg — Nachweis für den Commit.** Der volle Lauf fällt hier weg. Das
Commit-Gate verlangt für die Release-Dateien aus Schritt 4 trotzdem einen grünen Lauf, der
sie gesehen hat. Ihn liefert ein Lauf der Paketstufe über genau diese Dateien, im Worktree:

```bash
node .claude/kit/checks.mjs run --in <pfad> --since HEAD --finish --retry
```

Mit `--finish` wählt der Lauf wie beim Abschluss eines Pakets nach Tests (Plan #1969, E15):
Er fährt die Tests, die Version, Änderungsprotokoll und Installer selbst laden oder nennen,
und lässt den übrigen Katalog dem Build-Dienst. Mit `--retry` wie in Schritt 5
(Plan #1395, E3), und ein Wackler hält vor dem Commit an wie dort. Der Job des
Build-Dienstes oben bleibt ohne den Schalter (E18). Auf dem lokalen Weg bleibt Schritt 5
der volle Lauf der Stufe `push`.

Rot hält an wie in Schritt 5: kein Commit, kein Push, weiter mit Schritt 8. Hat Schritt 4
nichts erzeugt, meldet er `leeresPaket`, und Schritt 6 entfällt wie beschrieben.

Nach dem grünen Nachweislauf, vor dem Commit, folgt die Sicherheitsprüfung aus Schritt 5 —
mit demselben Anker `merge-base HEAD origin/<mainBranch>`, nicht mit `HEAD`, denn geprüft
wird der Batch, der hinausgeht. `kritisch` und `ausfall` halten an wie dort.

**Schritt 7 auf diesem Weg — Push über den Prüfzweig.** Der Vor-Push-Schritt aus
`RELEASING.md` läuft wie beschrieben davor. Dann, aus dem Worktree:

1. Den Stand auf den Prüfzweig pushen. Vor jedem Push auf den Prüfzweig holt der Skill in
   der Hauptkopie eine offen gebliebene Freigabe des Runners nach (Plan #1965, E8); das
   Kommando löscht nur mit Lease auf den Commit des Runners und lässt einen fremden Stand
   stehen. Sein `grund` steht als eine Zeile im Bericht, ein `bereinigt: false` hält nicht
   an — ein belegter Zweig weist den Push danach ab:

   ```bash
   node .claude/kit/worktree.mjs clean-check-branch
   git -C <pfad> push origin HEAD:refs/heads/<zweig>
   ```

   Der volle Name `refs/heads/<zweig>` ist nötig: Der Worktree steht auf einem losgelösten
   `HEAD`, und den Prüfzweig gibt es vor dem Push nicht, weil Schritt 8 ihn nach jedem Lauf
   löscht. Mit dem kurzen Namen weist git den Push ab, weil es das Ziel nicht als Zweig
   erkennt (Issue #1518). Wird er abgewiesen, liegt auf `<zweig>` noch ein fremder Stand — der Lauf endet mit
   dieser Meldung, weiter mit Schritt 8. Kein `--force`.
2. Warten, bis der Build-Dienst fertig ist. `<sha>` ist die volle Ausgabe von
   `git -C <pfad> rev-parse HEAD`, nie ein gekürzter Hash:

   ```bash
   node .claude/kit/board.mjs code ci-wait --commit <sha> --timeout-min 120
   ```

   Das Kommando wartet selbst (Plan #2131, A10; Kriterium 5 der fachlichen Quelle #2130); der
   Skill wiederholt nichts. Es läuft im Hintergrund, weil es länger dauern kann, als ein
   Werkzeugaufruf im Vordergrund darf, und der Skill wartet auf sein Ende. Die **Frist ist
   120 Minuten**; findet es nach 5 Minuten keinen Lauf zu `<sha>`, endet es vorher. Gehandelt
   wird nach dem Feld `ergebnis`:

   - `gruen` — weiter mit 3.
   - `rot` — Halt, wie unten beschrieben.
   - `kein Lauf` — der Build-Dienst hat zu `<sha>` keinen Lauf gestartet. Fehlschlag: kein
     Push auf `<mainBranch>`, weiter mit Schritt 8.
   - `frist` — die 120 Minuten sind abgelaufen; das Feld `schritt` nennt den erreichten
     Schritt. Fehlschlag wie bei `kein Lauf`.
   - `keine` — siehe unten.

   Ein Fehlschlag des Aufrufs selbst (Netz, Anmeldung) zählt wie `frist`. Bei `kein Lauf`,
   `frist` und einem Fehlschlag nennt der Skill dem Inhaber den Notfallweg
   `/push-main emergency` als Möglichkeit, falls der Build-Dienst ausgefallen ist (Abschnitt
   „Notfallweg“), und startet ihn nicht selbst.
3. `<mainBranch>` nur bei `gruen` pushen — mit demselben Kommando wie in Schritt 7:

   ```bash
   git -C <pfad> push origin HEAD:<mainBranch>
   ```

   Für ihn gilt der Absatz zu `--force` und zum abgewiesenen Push aus Schritt 7.

**Bei `rot` hält der Skill an wie bei einem roten Lauf in Schritt 5:** kein Push auf
`<mainBranch>`, Meldung, welcher Job rot ist (die Liste `jobs` des Aufrufs), und die
**Adresse des Build-Logs** zum Commit `<sha>` — dort stehen die rote Prüfung und die Zeile
`Verursacher (<cmd>): …`. Bei `codeHost` `github` ist das
`https://github.com/<repo>/commit/<sha>/checks`, bei `gitlab` die Pipeline-Seite des
Projekts zum Commit (`<projekt-url>/-/pipelines?sha=<sha>`); `<repo>` nennt
`node .claude/kit/board.mjs code repo-name`. Die Reparatur ist eine neue Karte, wie in
Schritt 5. Der Build-Job legt sie nicht an; wer sein Urteil liest, tut es (Plan #2087, A5).
Der Skill liest die Funde aus dem Protokoll der roten Jobs zum Commit `<sha>`:

```bash
node .claude/kit/board.mjs issue repair --ci <sha>
```

Die Meldung nennt danach die angelegten und die kommentierten Karten und die Handgriffe, wie
nach dem roten Lauf in Schritt 5.

**Meldet der Aufruf `keine`**, hat das Projekt keinen Build-Dienst (`codeHost` `local`).
Das ist ein Widerspruch in der Config: kein Push auf `<mainBranch>`, Meldung mit diesem
Grund, weiter mit Schritt 8.

**Schritt 8 auf diesem Weg** löscht zusätzlich den Prüfzweig, sobald er gepusht wurde — vor
dem Rückweg, auch nach Rot, Fristablauf oder abgewiesenem Push:

```bash
git -C <pfad> push origin --delete <zweig>
```

So beginnt der nächste Lauf auf einem leeren Prüfzweig und braucht nie `--force`. Scheitert
das Löschen, steht es in einer Zeile im Bericht und hält den Abbau nicht auf.

**Schritt 9 auf diesem Weg** nennt in der Nachweiszeile statt der lokalen Prüfungen den
Build-Dienst: `<hash> — gedeckt von: Build-Dienst, Prüfzweig <zweig> (gruen, <Zeitpunkt>)`.
Der CI-Hinweis entfällt — die CI hat vor dem Push gegatet.

## Notfallweg (`emergency`)

`/push-main emergency` veröffentlicht, wenn der Build-Dienst ausfällt und der Code-Host den
Hauptzweig schützt (Plan #1405, A6). Am Schutz vorbei kommt nur der Inhaber des
Repositories: Aussetzen kann bei GitHub nur, wer Admin-Rechte hat — das setzt der Code-Host
durch, nicht das Kit. Die Rulesets tragen keine dauerhafte Umgehung; der Schutz fällt nur
für diesen einen Push weg.

**Nur interaktiv.** Ist `KIT_AGENT_MODEL` gesetzt, hält der Skill vor Schritt 1 an — kein
Worktree, kein Lauf, kein Push. `code protection suspend` bricht ohne Aufsicht ohnehin ab
(E8); der Halt im Skill kommt dem zuvor. Auch hier braucht es die getippte Trigger-Phrase
des Menschen.

**Schritte 1 bis 6 wie auf dem lokalen Weg**, auch wenn `pushCheck` den Build-Dienst
nennt: Schritt 5 ist der volle lokale Lauf der Stufe `push` mit `--retry` im
Worktree, die Ersatzprüfung für den ausgefallenen Build-Dienst. Ein roter Lauf hält an wie
dort. Ein Wackler hält vor dem Commit an und wird erfragt wie dort. Die Sicherheitsprüfung
läuft wie in Schritt 5; `kritisch` hält an, `ausfall` wird erfragt wie dort.

**Statt Schritt 7**, aus dem Worktree, in dieser Reihenfolge:

1. Der Vor-Push-Schritt aus `RELEASING.md` wie in Schritt 7, aber **kein „Trotzdem pushen?“**: Jedes Ergebnis außer Exit 0 hält ohne Push an,
   weiter mit Schritt 8. Der Notfallweg läuft nur nach grünem Lauf, ohne Ausnahme.
2. Den Schutz aussetzen:

   ```bash
   node .claude/kit/board.mjs code protection suspend --in <pfad>
   ```

   Das Kommando setzt das Ruleset des Hauptzweigs nur aus, wenn die Prüf-Zusammenfassung
   des Worktrees einen grünen Lauf der Stufe `push` für genau diesen Stand bezeugt.
   Verweigert es, endet der Lauf ohne Push mit seiner Meldung, weiter mit Schritt 8.
3. Pushen — mit demselben Kommando wie in Schritt 7, kein `--force`:

   ```bash
   git -C <pfad> push origin HEAD:<mainBranch>
   ```

4. **Sofort** den Schutz wiederherstellen, auch nach abgewiesenem Push — gleich, wie der
   Push ausging:

   ```bash
   node .claude/kit/board.mjs code protection restore
   ```

   Scheitert `restore`, ist der Lauf ein Fehlschlag, auch wenn der Push gelang
   (E10): Der Skill meldet es so und nennt das Kommando zum Wiederholen
   (`node .claude/kit/board.mjs code protection restore`). Bis es gelingt, steht der
   Hauptzweig ungeschützt, und `code protection status` nennt das unter `fehlt`.
5. Nur wenn der Push gelang: den Nullpunkt des Integrationslaufs eintragen wie in
   Schritt 7, in der Hauptkopie, nach dem Wiederherstellen:

   ```bash
   node .claude/kit/checks.mjs integration --pushed <sha>
   ```

Danach Schritt 8 wie oben, auch nach einem Halt.

**Schritt 9 auf diesem Weg** nennt in der Nachweiszeile den lokalen Lauf wie auf dem
lokalen Weg und dazu, dass der Stand über den Notfallweg kam. In die Abschlussmeldung gehört
die Ausgabe von:

```bash
node .claude/kit/board.mjs code protection status
```

Nennt sie unter `ungeprueft` den eben gepushten Commit, sagt die Meldung dazu, dass der
Build-Dienst ihn nachträglich prüfen kann, sobald er wieder läuft, mit dem Kommando
`node .claude/kit/board.mjs code protection verify`. Bis dahin bleibt der Stand als
Ausnahme sichtbar.

## Modus `prepare` (unbeaufsichtigt)

`/push-main prepare` startet der Runner am Ende eines Laufs, wenn eine Kette das
Ziel „Veröffentlichung vorbereitet" erreicht hat (Plan #1243, A5). Die Session läuft in der
Hauptkopie, während der Runner die Umsetzungssperre hält: Nichts baut mehr. Sie fährt alles,
was vor dem Veröffentlichen ohne Menschen und ohne Push geht, und hält das Ergebnis fest.
Der nächste `push main` übernimmt den Stand, wenn er sich nicht geändert hat (Schritt 3). Der Modus
gehört zu Community: In Pro gibt es keine Vorbereitung, an ihre Stelle tritt die Prüfung je Karte
(Plan #2145, E14).

**Schritte 1 bis 6** wie oben, mit diesen Abweichungen:

- **Schritt 3:** Der Fetch in der Hauptkopie (`git fetch origin <mainBranch>`) ist erlaubt,
  weil der Runner die Umsetzungssperre hält — kein Bau verliert dabei den Boden.
  `check-preparation` entfällt. Der Worktree entsteht mit eigenem Präfix:

  ```bash
  node .claude/kit/worktree.mjs create --prefix vorbereitung --ref <mainBranch>
  ```

  Danach `git -C <pfad> rebase origin/<mainBranch>` wie oben. **Scheitert der
  Fetch**, ist das kein Abbruch: Gerebased wird auf die vorhandene Referenz
  `origin/<mainBranch>`, der Lauf geht weiter und übergibt beim Festhalten
  `--fetch failed`. Ein Rebase-Konflikt endet wie oben ohne Festhalten; der Runner
  liest dann keine Vorbereitung dieses Laufs.
- **Schritt 4:** Ohne `RELEASING.md` entfällt er wie oben (E15).
- **Schritt 5:** der volle Prüflauf der Push-Stufe. Auf dem Weg über den Build-Dienst ist
  Schritt 5 der Nachweislauf der Paketstufe aus dem Abschnitt „Weg über den Build-Dienst"
  (`checks.mjs run --in <pfad> --since HEAD --finish --retry`), danach der Commit (E17). Der volle Lauf im Build-Dienst
  bleibt offen; ihn fährt der nächste `push main` in Schritt 7 über den Prüfzweig. Ein Wackler hält hier nicht an und wird
  nicht erfragt: `record-preparation` macht aus ihm selbst einen offenen Punkt
  `Gewackelt: <cmd> — Entscheidung beim push main` (Plan #1395, E14).
  Danach die Sicherheitsprüfung wie in Schritt 5, mit Karten wie dort, aber ohne Frage:
  `kritisch` und `ausfall` halten hier nicht an und werden nicht erfragt, sie gehen als
  `--security` ins Festhalten. Ein solcher Stand wird beim nächsten `push main` nicht übernommen, und
  `push main` prüft dann selbst (Plan #1988, E8). Entfällt sie wegen der Strenge
  (`sicherheit vor-auslieferung`), läuft sie nicht, und `--security` entfällt: Das Festhalten
  schreibt dann selbst den Vermerk ins Feld `sicherheit` (Issue #2116).
  Nach einem roten Prüflauf ruft die Session `issue repair` nicht: Die Reparaturkarten legt
  der Runner an, wenn er das Ergebnis der Vorbereitung liest (Plan #2087, A4, A5).
- **Schritt 6:** der Commit `chore: vX.Y.Z` im Worktree, wie oben.

**Statt Schritt 7** hält die Session das Ergebnis fest, auch nach einem roten Prüflauf:

```bash
node .claude/kit/worktree.mjs record-preparation <pfad> --result <green|green-open|red> --security <gruen|kritisch|ausfall>
```

- `--security` trägt das `ergebnis` der Sicherheitsprüfung; das Kommando schreibt es mit dem
  Commit der Vorbereitung als Feld `sicherheit` nach `.claude/push-vorbereitung.json`. Nach
  einem roten Prüflauf lief keine Sicherheitsprüfung, und `--security` entfällt.
- Nach einem gescheiterten Fetch zusätzlich `--fetch failed`.
- Der Vor-Push-Schritt aus `RELEASING.md` geht als `--open "<Text>"` mit. **Gestartet
  wird er nicht** (E9): Ob ein Vor-Push-Schritt pusht, ist unbeaufsichtigt nicht prüfbar. Mit einem
  offenen Punkt heißt das Ergebnis `green-open`.
- Den Build-Dienst-Punkt setzt das Kommando selbst — die Session übergibt ihn nicht.

**Danach Schritt 8 ohne Nachziehen:** `return` und `remove` wie oben,
`catch-up-check` und das Rebase des lokalen `<mainBranch>` entfallen. Schritt 9 meldet
das Ergebnis von `record-preparation`.

**Die Session selbst pusht nie** — weder auf `<mainBranch>`, noch auf den Prüfzweig, noch
auf einen Vorab-Zweig: kein Prüfzweig, kein Vorab-Zweig, kein Tag. Die Session endet beim
lokalen Commit im Worktree; was nur mit einem Push ginge, ist offen.

**Nach der Session bringt der Runner nichts auf den Prüfzweig** (Plan #2145, E14). Der volle
Lauf im Build-Dienst bleibt offen, und der nächste `push main` fährt ihn auf dem Weg über den
Build-Dienst. Bis Plan #2145 brachte der Runner in Pro den vorbereiteten Commit selbst auf den
Prüfzweig und hielt das Urteil fest; das entfällt mit der Vorbereitung in Pro.

## Was dieser Skill nicht tut

- Kein Commit und kein Push bei einem roten Prüflauf (Schritt 5)
- Kein Commit und kein Push bei einem Befund KRITISCH der Sicherheitsprüfung, und nach ihrem
  Ausfall nur auf das ausdrückliche `ja` des Menschen (Schritt 5)
- Kein Erzeugen, Prüfen oder Committen im Haupt-Working-Tree — das läuft ausschließlich im
  Worktree aus Schritt 3
- Kein zurückgelassener Worktree, auch nicht nach einem roten Lauf (Schritt 8)
- Kein Rebase des lokalen `<mainBranch>`, während eine Sperre des Runners liegt oder
  der Haupt-Tree schmutzig ist (Schritt 8)
- Kein zweiter Commit und kein `--amend` auf diesem Weg
- Keine Force-Pushes
- Kein Push auf `production` oder andere Branches — ausgenommen der Vorab-Zweig, den ein Vor-Push-Schritt selbst anlegt und löscht
- Kein Push auf den Prüfzweig außerhalb des Wegs über den Build-Dienst — ausgenommen das
  Löschen des eigenen Prüfzweigs über `publish-state` —, und auf ihm kein Push auf
  `<mainBranch>` ohne grünes Ergebnis des Build-Dienstes
- Keine eigene Prüfung und kein Start einer Prüfung oder Vorbereitung auf dem Weg über
  `publish-state`: Hinaus geht dort nur der Commit, den der Build-Dienst grün geprüft hat
- Kein Push ohne vorherige Bestätigung durch den Menschen (Trigger-Phrase)
- Kein Push durch die Session im Modus `prepare`, auch nicht auf den Prüfzweig oder einen
  Vorab-Zweig; auch der Runner bringt den vorbereiteten Stand nicht dorthin (Abschnitt
  „Modus `prepare`")
- Kein Push des Runners auf `<mainBranch>` oder `productionBranch` — den Hauptzweig schiebt
  nur der getippte `push main` vor
- Kein automatischer Push nach Commit, nach grünem Check oder nach Review
- Kein Halt wegen des Aufwands-, des Wirksamkeits- oder des Befunds zu den
  Modell-Prüfungen: Alle drei sind **kein Gate**, weder ihr Inhalt noch ihr Fehlschlag
  hält das Veröffentlichen auf. Sie sagen, was auffällt — was daraus folgt, entscheidet
  der Mensch.
- Kein Halt wegen der Buchung der Code-Review-Befunde: Auch sie ist kein Gate, und sie
  bucht nichts ohne Übernahmevermerk — entschieden hat der Mensch, bevor eingearbeitet
  wurde.
