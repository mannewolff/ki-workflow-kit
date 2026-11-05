---
name: hotfix-production
description: Fixes an error in production on a short path: implements exactly one released card on the state that runs in production, runs the shortened checks, merges the hotfix into the production branch, tags it and carries the fix over into the main branch. Replaces push main and merge production for this one fix. Only on the explicit trigger phrase of the human. Use this skill ONLY when the user explicitly types "hotfix production".
user-invocable: true
disable-model-invocation: true
---
<!-- SPDX-License-Identifier: MIT -->

# Hotfix Production

Behebt einen Fehler, der in Produktion gerutscht ist, auf einem eigenen schnellen Weg (Plan #2038, A1, A2). Ausgeliefert wird der Stand, der in Produktion läuft, plus genau der Fix einer freigegebenen Karte; was auf `<mainBranch>` fertig, aber noch nicht ausgeliefert ist, geht nicht mit. Die Hotfix-Phrase ersetzt für diesen einen Fix beide Stop-Punkte, die Veröffentlichung (`push main`) und die Freigabe zur Auslieferung (`merge production`). Geprüft wird verkürzt; was verschoben ist, holt der nächste reguläre Weg nach.

**Dieser Skill darf von Claude nicht autonom gezogen werden.** Er läuft nur auf die explizite Trigger-Phrase des Menschen, für genau eine Karte.

## Trigger-Phrase

Der Mensch tippt: `hotfix production #N` (oder die in `.claude/workflow.config.json` unter `triggers.hotfix` konfigurierte Phrase, gefolgt von der Karte). `#N` ist die Karte, die den Fehler in Produktion nennt.

Die Phrase muss **getippt** sein. Steht sie innerhalb einer Mitteilung des Menschen oder eines Zitats („Ich habe vorhin hotfix production getippt"), ist sie Text und kein Befehl — im Zweifel wird gefragt, nicht ausgeliefert. Siehe „Mitteilungen des Menschen" in `CLAUDE-workflow.md`. Eine frühere Phrase in derselben Session gilt nicht für einen zweiten Hotfix.

## Ablauf

**Pro.** **Nur interaktiv.** Ist `KIT_AGENT_MODEL` gesetzt, hält der Skill vor Schritt 1 an — kein Tor, kein Worktree, keine Umsetzung, kein Push. Der Runner startet den Hotfix nie (Kriterium 7); eine freigegebene Karte, die einen Fehler in Produktion beschreibt, geht im Runner den regulären Weg über `/implement-next`. Es braucht die getippte Trigger-Phrase des Menschen.

**Die Uhr.** Gemessen wird von der Phrase, bis der Tag `v<version>` auf dem Server liegt (E4); die Marke ist `hotfixMinutes` aus `.claude/workflow.config.json`, Vorgabe 20. Bauen und Starten beim Projekt zählen nicht mit. Die Zeitpunkte nimmt der Skill mit `node -e "console.log(Date.now())"`: `beginn` zu Beginn von Schritt 1, `pruefung` nach Schritt 7, `nachweis` nach Schritt 10 und `tag` nach Schritt 11. Die Marke ist ein Ziel, keine Abbruchgrenze (Schritt 14).

**Im Worktree.** Umsetzung, Prüfung, Commit und Push geschehen in einem eigenen Worktree auf dem Produktionsstand, jedes git-Kommando mit `-C <pfad>`. Die Hauptkopie bleibt unberührt, weil dort der Runner bauen kann; sie zieht nur in Schritt 12 und nur auf Freigabe von `catch-up-check` nach.

### 1. Tor, Phrase, Startzeit

```bash
node .claude/kit/board.mjs edition gate hotfix
```

Exit 3 heißt Community: Der Skill gibt die Ausgabe des Tors unverändert weiter und endet. Exit 0 heißt weiter.

Die Phrase ist `triggers.hotfix` aus `.claude/workflow.config.json`, persönlich überschreibbar in `.claude/workflow.config.local.json`; Vorgabe `hotfix production`. Stimmt das Getippte nicht mit ihr überein, endet der Skill ohne weiteren Schritt. Dann nimmt er `beginn`.

### 2. Auslieferungszweig und Karte

Der Hotfix setzt einen eigenen Auslieferungszweig voraus. `<productionBranch>` kommt aus der Config (Vorgabe `production`):

```bash
git ls-remote --exit-code --heads origin <productionBranch>
```

Endet der Aufruf ungleich 0, gibt es den Zweig auf dem Server nicht; der Skill lehnt ab mit dem Grund „Kein Auslieferungszweig `<productionBranch>` auf dem Server — der Hotfix braucht ihn, es gilt der reguläre Weg über `push main` und `merge production`." und endet.

Dann die Karte. Hat die Phrase keine Nummer genannt, fragt der Skill einmal nach ihr. Für die genannte Karte:

```bash
node .claude/kit/board.mjs issue brief <id>
```

Gehandelt wird nach der Folge wie in `/implement-next`, Schritt 0, mit einem Unterschied: Bei jeder Folge außer `beginnen` endet der Hotfix ohne weiteren Schritt und nennt den Grund aus dem Urteil — er bewegt und kommentiert die Karte nicht, denn eine Karte, die nicht beginnen darf, ist kein Fall für einen Hotfix.

**Board nicht erreichbar (E10).** Scheitert `issue brief` mit einem Netzfehler, fragt der Skill einmal: „Das Board ist nicht erreichbar. Welcher Fehler in Produktion wird behoben — in einem Satz?" Mit der Antwort läuft der Hotfix ohne Karte: Der Satz ist die Aufgabe, `<id>` entfällt in jedem folgenden Kommando, und Schritt 13 hält den Eintrag mit `karte: null` fest. Die Karte legt `/session-start` an, sobald das Board wieder läuft.

### 3. Produktionsstand lesen

```bash
node .claude/kit/board.mjs release state
```

`laufend.version` ist `<laufend>`, die Version, die jetzt läuft; `hotfixVersion` ist `<version>`, die Version dieses Hotfix (etwa `3.8.0-hotfix.1`). Ist `laufend.version` `null`, kennt das Kit keine laufende Version; der Skill hält an und nennt den regulären Weg.

`zurueckkehren` nennt jedes Zurückkehren seit der letzten Auslieferung:

- **Ein Eintrag mit `erfolg: true` (E7).** Dann ist `<laufend>` die Vorversion, und der Hotfix gilt nur für einen Fehler, der in ihr selbst auftritt. Der Skill fragt einmal: „Seit der letzten Auslieferung wurde von v`<von>` nach v`<nach>` zurückgekehrt. Liegt der Fehler der Karte in der zurückgenommenen Version v`<von>`?" Bei Ja hält er an und nennt den regulären Weg: Der Fehler der zurückgenommenen Version wird über eine Karte, `push main` und `merge production` behoben. Bei Nein weiter.
- **Nur Einträge mit `erfolg: false`.** Ein gescheitertes Zurückkehren lässt offen, welche Version wirklich läuft. Der Skill hält an, nennt den gescheiterten Eintrag und sagt, dass erst geklärt sein muss, welche Version läuft — etwa durch ein erneutes `rollback production`.

### 4. Worktree auf dem Produktionsstand

```bash
node .claude/kit/worktree.mjs create --prefix hotfix --ref v<laufend> --pristine
```

`<pfad>` ist der ausgegebene Pfad. Der Worktree steht auf dem Tag der laufenden Version, also genau auf dem, was in Produktion läuft. `--pristine` hält ihn so (Issue #2126): Jede versionierte Datei ist die des Tags, auch `.claude/workflow.config.json`, und das `installCommand` kommt aus dem Tag, nicht aus der Hauptkopie. Ohne die Option überschriebe der Spiegel von `.claude/` die Config mit der der Hauptkopie; ein dort eingetragenes, noch nicht ausgeliefertes `installCommand` liefe schon beim Anlegen, ihre `buildChecks` im Prüflauf, beides vor Zustandskontrolle und Sicherheitsprüfung. Scheitert der Aufruf (etwa weil der Tag `v<laufend>` fehlt), hält der Skill an und nennt die Ausgabe.

### 5. Release-Dateien des Hotfix, vor der Umsetzung

Die Release-Befehle kommen aus dem ausgelieferten Stand, bevor die Karte den Worktree ändert (Issue #2120). Eine Karte, die `RELEASING.md` oder ein dort aufgerufenes Skript ändert, ist noch ungeprüft; nach dem Fix gelesen, liefen ihre Befehle mit den Rechten der Sitzung, bevor Prüflauf und Sicherheitsprüfung sie sehen. Zuerst die Probe, dass der Worktree noch genau der Tag ist:

```bash
git -C <pfad> rev-parse HEAD v<laufend>^{commit}
git -C <pfad> status --porcelain
```

Die beiden Hashes müssen gleich sein und `status` leer. Sonst hält der Skill an, nennt die Ausgabe und baut den Worktree ab (Schritt 12, nur `worktree.mjs remove <pfad>`).

Dann führt der Skill den Abschnitt `## hotfix production` aus der `RELEASING.md` **im Worktree** aus, mit `<version>` aus Schritt 3 und `<pfad>` als Arbeitsverzeichnis. Abschnitt und jedes Skript, das er aufruft, stammen damit aus `v<laufend>`, nicht aus der Arbeitskopie und nicht aus dem Fix. `<release-dateien>` sind die Dateien, die danach `git -C <pfad> status --porcelain` nennt. Committet wird noch nicht. Fehlt der Abschnitt oder erzeugt er nichts, ist `<release-dateien>` leer; das steht im Bericht.

### 6. Karte umsetzen, Fix und Release committen

Die Karte wird im Worktree nach dem Ablauf von `/implement-next`, Schritt 2 und 3, umgesetzt: gegen die Karte, Tests zuerst, nur was die Karte verlangt. Jedes Werkzeug arbeitet unter `<pfad>`; gezielte Tests laufen dort. Der volle Lauf ist Schritt 7, kein `checks.mjs run --finish` dazwischen. Der Skill führt danach keinen Befehl aus `RELEASING.md` mehr aus, auch wenn die Karte sie geändert hat.

```bash
git -C <pfad> add <geänderte Dateien>
git -C <pfad> commit -m "fix: <Kurztitel> (Issue #<id>)

<Beschreibung und Begründung>

Refs #<id>"
```

Die `<release-dateien>` gehören nicht in diesen Commit. Ohne Karte (E10) entfallen `(Issue #<id>)` und `Refs`. `<fix>` ist die Ausgabe von `git -C <pfad> rev-parse HEAD`. Dann die Release-Dateien aus Schritt 5:

```bash
git -C <pfad> add <release-dateien>
git -C <pfad> commit -m "chore: v<version>"
```

Ist `<release-dateien>` leer, entsteht kein `chore`-Commit, und der Tag in Schritt 11 zeigt auf `<fix>`. `<release>` ist der `chore`-Commit, sonst `<fix>`.

### 7. Der verkürzte Prüflauf

```bash
node .claude/kit/checks.mjs run --in <pfad> --stage push --hotfix --retry --since v<laufend>
```

Er fährt die Tests des Fix, den vollen Testlauf und jede Prüfung der Stufe `push` außer denen mit `deferOnHotfix: true`; die Mutationsprüfung läuft über die Dateien seit `v<laufend>` und berichtet nur (E1, E2). Ein roter Lauf hält an: kein Push, weiter mit dem Abbau (Schritt 12, nur `worktree.mjs remove <pfad>`), Bericht mit der roten Prüfung. Das Feld `hotfix` der Zusammenfassung `<pfad>/.claude/checks-summary.json` nennt `gelaufen` und `nachDerAuslieferung`; beide braucht Schritt 13. Dann `pruefung` nehmen.

### 8. Sicherheitsprüfung (E5)

Dieselbe Sicherheitsprüfung wie in `/push-main`, Abschnitt „Die Sicherheitsprüfung vor jedem Push", mit dem Anker `v<laufend>` statt des Merge-Base:

```bash
git -C <pfad> diff v<laufend>...HEAD > <tmpdir>/sicherheit-material.txt
```

```bash
node .claude/kit/board.mjs issue-review review-brief --role sicherheit --material-file <tmpdir>/sicherheit-material.txt --file <tmpdir>/sicherheit-auftrag.md
```

Prüfer, Zeitgrenze und Antwortdatei wie dort; ausgewertet wird im Worktree:

```bash
node .claude/kit/worktree.mjs in <pfad> -- node .claude/kit/board.mjs issue-review security-result --file <tmpdir>/sicherheit-antwort.md --base v<laufend> --cards
```

- **`gruen`** — weiter mit Schritt 9.
- **`kritisch`** — hält an wie ein roter Lauf: kein Push, Abbau, der Bericht nennt jeden Befund KRITISCH im Wortlaut und seine Karte.
- **`ausfall`** — der Skill fragt wörtlich: „Sicherheitsprüfung ausgefallen: <Grund>. Den Hotfix ohne sie ausliefern?" Nur `ja` fährt fort; dann gehört `Sicherheitsprüfung` in Schritt 13 zu den nachzuholenden Prüfungen, und der Kommentar vermerkt das Wort. Alles andere hält an wie ein roter Lauf.

### 9. Hotfix-Zweig und Pull Request

Zuerst wird der Stand von `<productionBranch>` eingebunden, ohne seinen Inhalt zu übernehmen:

```bash
git -C <pfad> fetch origin <productionBranch>
git -C <pfad> merge-base --is-ancestor FETCH_HEAD HEAD
```

Endet der zweite Aufruf mit 0, liegt `<productionBranch>` schon auf `v<laufend>`, und der Schritt ist fertig. Sonst, nach einem Zurückkehren, steht `<productionBranch>` noch auf der zurückgenommenen Version: Ohne Einbinden kollidierte der Pull Request in den Versionsdateien, und sein Merge brächte die zurückgenommene Version mit hinaus (Kriterium 3, Issue #2060). Dann:

```bash
git -C <pfad> commit-tree HEAD^{tree} -p FETCH_HEAD -p HEAD -m "chore: Stand von <productionBranch> durch Hotfix v<version> ersetzt"
git -C <pfad> checkout -q <eingebunden>
```

`<eingebunden>` ist die Ausgabe von `commit-tree`. Der Commit trägt den Inhalt des Worktree unverändert, `<productionBranch>` wird Vorfahr, und der Merge legt genau `v<laufend>` plus den Fix auf den Auslieferungszweig, ohne `--force`. `<productionBranch>` steht als erster Elternteil, nicht `HEAD` wie bei `git merge -s ours`: Nur so liest `release state` den Hotfix als jüngste Auslieferung und nicht die zurückgenommene Version. Den Inhalt der zurückgenommenen Version bringt der nächste reguläre Weg zurück: `push main` bindet `<productionBranch>` mit `-s ours` in `<mainBranch>` ein.

```bash
git -C <pfad> push origin HEAD:refs/heads/hotfix/<version>
```

Der volle Name `refs/heads/…` ist nötig, weil der Worktree auf einem losgelösten `HEAD` steht und es den Zweig vor dem Push nicht gibt. Kein `--force`; wird der Push abgewiesen, hält der Skill an.

```bash
node .claude/kit/board.mjs code pr --from hotfix/<version> --to <productionBranch> --title "Hotfix v<version>"
```

`<nummer>` ist die letzte Pfadstelle der ausgegebenen `url`, `<kopf>` die Ausgabe von `git -C <pfad> rev-parse HEAD`. Bei `codeHost` `local` gibt es keine Pull Requests: Statt PR und Merge pusht der Skill in Schritt 11 den Stand selbst auf `<productionBranch>`.

### 10. Nachweis abwarten

Mit Build-Dienst (`codeHost` `github` oder `gitlab`) wartet der Skill wie in `/push-main`, Weg über den Build-Dienst, Schritt 2:

```bash
node .claude/kit/board.mjs code ci-status --commit <kopf>
```

alle 30 Sekunden, solange `status` `laeuft` meldet, mit einer Frist von 120 Minuten. Der Build-Dienst prüft einen Pull Request nach `<productionBranch>` mit seinem verkürzten Satz von Pflichtprüfungen; ein lokaler Nachweis zählt dort nicht. `rot`, Fristablauf oder ein gescheiterter Aufruf halten an: kein Merge, der Bericht nennt den roten Job und die Adresse des Build-Logs, der Zweig `hotfix/<version>` und der Pull Request bleiben für den Menschen stehen. `keine` bei gesetztem Build-Dienst ist ein Widerspruch in der Config und hält ebenso an.

Ohne Build-Dienst (`codeHost` `local`) ist der grüne Lauf aus Schritt 7 der Nachweis, wie auf dem regulären Weg des Projekts. Dann `nachweis` nehmen.

### 11. Merge und Tag

```bash
node .claude/kit/board.mjs code merge-pr --number <nummer> --head <kopf>
```

`ok: false` hält an und nennt den `grund`; kein Tag. Bei `codeHost` `local` statt dessen:

```bash
git -C <pfad> push origin HEAD:<productionBranch>
```

Der Stand auf `<productionBranch>` ist seit Schritt 9 Vorfahr des Worktree; ein abgewiesener Push heißt, dass dort inzwischen ein anderer Stand liegt, und hält an. Dann der Tag auf `<release>`:

```bash
git -C <pfad> tag -a v<version> <release> -m "Hotfix v<version>"
git -C <pfad> push origin v<version>
```

Ist der Tag auf dem Server, endet die Messung: `tag` nehmen. Danach den Zweig löschen (Scheitern steht in einer Zeile im Bericht und hält nicht auf):

```bash
git -C <pfad> push origin --delete hotfix/<version>
```

### 12. Fix in den Hauptzweig übernehmen (E6)

Der Fix soll nicht wieder verloren gehen. Übernommen wird in einem zweiten Worktree auf `<mainBranch>`, nicht in der Hauptkopie:

```bash
node .claude/kit/worktree.mjs create --prefix hotfix-uebernahme --ref <mainBranch>
```

`<uebernahme>` ist der ausgegebene Pfad. Dort, auf einem lokalen Zweig:

```bash
git -C <uebernahme> switch -c hotfix-uebernahme/<version>
git -C <uebernahme> cherry-pick -x <fix>
git -C <uebernahme> commit --amend --no-edit --trailer "Hotfix: v<version>"
```

Die Zeile `Hotfix: v<version>` im Body ist das Zeichen, an dem `push main` die Übernahme erkennt; der Hash ändert sich beim Cherry-Pick, die Zeile bleibt.

**Bei Konflikt** bricht der Skill ab und legt die Karte an:

```bash
git -C <uebernahme> cherry-pick --abort
node .claude/kit/board.mjs issue create --art task --title "Hotfix v<version> in den Hauptzweig übernehmen" --body-file <tmpdir>/<version>-uebernahme.md --derived-from <id>
```

Der Body (nach der Transportregel in `<tmpdir>`) nennt `<fix>`, die Version und die Konfliktdateien. Ohne Karte (E10) entfällt `--derived-from`. Bis die Zeile `Hotfix:` im Bereich liegt, hält `push main` an.

**Nachziehen.** Gelang der Cherry-Pick:

```bash
node .claude/kit/worktree.mjs catch-up-check
```

Bei `nachziehen: true` zieht die Hauptkopie nach: `git merge --ff-only hotfix-uebernahme/<version>`. Bei `nachziehen: false` nicht; der Skill nennt den `grund` und gibt dasselbe Kommando als kopierbare Zeile aus. Der Zweig `hotfix-uebernahme/<version>` bleibt dann bestehen. Danach beide Worktrees abbauen:

```bash
node .claude/kit/worktree.mjs remove <uebernahme>
node .claude/kit/worktree.mjs remove <pfad>
```

### 13. Festhalten, Label, Kommentar

```bash
node .claude/kit/board.mjs release record-hotfix --version <version> --fix-commit <fix> --issue <id> --deferred <pruefung> --durations '<json>'
```

Ein `--deferred` je Prüfung aus `nachDerAuslieferung` (Schritt 7), dazu `statische Analyse`, `Review` und nach einem Ausfall in Schritt 8 `Sicherheitsprüfung`. `<json>` trägt die Dauern in Millisekunden: `{"pruefung": pruefung − beginn, "nachweis": nachweis − beginn, "tag": tag − beginn}`. Ohne Karte entfällt `--issue`; statt dessen trägt `--reason '<Satz>'` den Fehler in einem Satz aus Schritt 2, aus dem `/session-start` die Karte anlegt. Scheitert der Aufruf, nennt der Skill die Ausgabe und den Aufruf zum Wiederholen.

Mit Karte:

```bash
node .claude/kit/board.mjs issue label add <id> kit:hotfix
```

Das Label bleibt, bis `push main` den Hotfix nachgeprüft hat (E9); der Skill nimmt es nie ab. Dann geht der Kommentar ans Issue, nach der Transportregel: Datei `<tmpdir>/<id>-hotfix.md` stückweise per Shell anlegen, dann

```bash
node .claude/kit/board.mjs issue comment <id> --text-file <tmpdir>/<id>-hotfix.md
```

Der Kommentar beginnt mit `## Hotfix v<version> — verkürzt geprüft` und nennt:

- die Dauern bis Prüfung, Nachweis und Tag gegen `hotfixMinutes`, und, wenn der Build-Dienst es meldet, die Dauer von Bauen und Starten;
- `Gelaufen:` mit den Prüfungen aus `gelaufen` (Schritt 7), der Sicherheitsprüfung mit ihrem Ergebnis und dem Ergebnis der Mutationsprüfung, oder dass das Projekt keine eingerichtet hat;
- `Nachzuholen:` mit den Prüfungen aus `nachDerAuslieferung`, statischer Analyse, Review und gegebenenfalls der Sicherheitsprüfung mit dem Wort des Menschen;
- die Übernahme: `Hotfix: v<version>` im Zweig `hotfix-uebernahme/<version>`, oder die Karte aus Schritt 12.

Danach zieht die Karte nach In review:

```bash
node .claude/kit/board.mjs issue move <id> in_review
```

### 14. Gegen `hotfixMinutes` messen

Nach Schritt 7, 10 und 11 vergleicht der Skill die verstrichene Zeit seit `beginn` mit `hotfixMinutes`. Liegt sie darüber, meldet er in einer Zeile `Hotfix über der Marke: <s> s von <hotfixMinutes × 60> s — erreicht: <Schritt>` und läuft weiter; keine Prüfung wird übersprungen, der Mensch kann abbrechen.

**Die Schlussmeldung** nennt: `v<version>` auf `<productionBranch>` mit Tag, die Zeit bis zum Tag gegen die Marke, den Kommentar aus Schritt 13, den Ausgang der Übernahme und des Nachziehens und dass der nächste reguläre Weg (`push main`, dann `merge production`) die verschobenen Prüfungen nachholt und den Hotfix abschließt.

## Stop-Punkte

- Ohne getippte Phrase einen Hotfix starten: nie
- Im Runner oder mit gesetztem `KIT_AGENT_MODEL` einen Hotfix starten: nie
- Mehr als eine Karte oder einen Stand außer dem Fix ausliefern: nie
- Ohne `productionBranch` auf dem Server ausliefern: nie — ablehnen und den regulären Weg nennen
- Den Abschnitt `## hotfix production` nach einer Änderung am Worktree ausführen oder ein Skript, das er aufruft, aus dem Fix lesen: nie — nur in Schritt 5, auf dem unberührten `v<laufend>`
- Einen Fehler der zurückgenommenen Version per Hotfix beheben: nie
- Ohne grünen Prüflauf, bei `kritisch` oder ohne das ausdrückliche Wort nach einem Ausfall der Sicherheitsprüfung ausliefern: nie
- In der Hauptkopie umsetzen, committen oder cherry-picken: nie — nur in den Worktrees
- `--force` beim Push: nie
- Das Label `kit:hotfix` abnehmen: nie — das tut `push main` nach der Nachprüfung
