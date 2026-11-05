<!-- SPDX-License-Identifier: MIT -->

# Die Sicherheitsprüfung

Der Ablauf der Sicherheitsprüfung an einer Stelle (Issue #2116, Plan #2102, A7). `/push-main`
fährt ihn in Schritt 5, `/merge-production` vor Schritt 6, wenn die Strenge die Prüfung vor die
Auslieferung legt. Die Schritte, die der Text nennt (Schritt 6, 8 und 9), sind die von
`/push-main`; wie `/merge-production` sie liest, steht dort.

**Die Sicherheitsprüfung vor jedem Push** (Plan #1988, E3 bis E6). Nach dem grünen Prüflauf
und einem beantworteten Wackler, vor Schritt 6, prüft ein Modell die Änderungen, die
hinausgehen, auf Sicherheitslücken — von selbst, ohne dass jemand `/kit-review` gestartet
hat, in Community wie in Pro. Sie trägt keine eigene Nummer und zählt in keiner
Fortschrittszeile mit.

Material ist der Batch gegen den veröffentlichten Stand, auf jedem Weg derselbe Anker —
auch auf dem Weg über den Build-Dienst, dessen Nachweislauf `--since HEAD` fährt. Erst den
Anker, `<anker>` ist dessen Ausgabe:

```bash
git -C <pfad> merge-base HEAD origin/<mainBranch>
```

Dann das Material und den Auftrag, beide in `<tmpdir>` wie in `/kit-review`, Schritt 1:

```bash
git -C <pfad> diff <anker>...HEAD > <tmpdir>/sicherheit-material.txt
```

```bash
node .claude/kit/board.mjs issue-review review-brief --role sicherheit --material-file <tmpdir>/sicherheit-material.txt --file <tmpdir>/sicherheit-auftrag.md
```

Eingebettete Blobs im Material — Base64-Literale ab 1000 Zeichen, etwa die Konstanten eines
Installers — kürzt das Kit selbst auf eine Platzhalterzeile und meldet ihre Zahl als
`blobsGekuerzt`; ihre Quellen stehen, sofern geändert, selbst im Diff (Issue #2081). Gekürzt
wird nur ein Blob, dessen Inhalt als versionierte Datei im Projekt liegt, oder einer in einer
entfernten Zeile; jeder andere bleibt im Wortlaut stehen und wird als `blobsErhalten` gezählt
(Issue #2083). Der Platzhalter nennt Länge, SHA-256 des Inhalts und den Quellpfad, damit ein
Blob nicht unbemerkt auf eine andere Projektdatei umgestellt wird (Issue #2127).

Geprüft wird mit der Rolle `sicherheit` für den ganzen Push, mit der Rolle `code-review` nur
je offenem Hotfix, ausgewertet mit `issue-review review-result` (Absatz unten). Den Prüfer
wählt das Feldpaar aus `/kit-review`, genau einer, kein weiterer:

- **Bei gesetztem `reviewModel`** startet der Skill über das Agent-Tool einen Agenten mit
  `subagent_type: kit-pruefer` und dem Modell aus `reviewModel`, **im Hintergrund**, mit dem
  Auftrag `Lies <tmpdir>/sicherheit-auftrag.md`. Er wartet höchstens 10 Minuten auf die
  Abschlussnachricht, stoppt den Agenten danach und wertet das als Ausfall `zeitgrenze`.
  Die Abschlussnachricht schreibt er unverändert nach `<tmpdir>/sicherheit-antwort.md`.
- **Bei gesetztem `reviewCommand`** startet das Kit das Kommando und beendet es nach
  10 Minuten selbst; dann meldet es den Ausfall `zeitgrenze`:

  ```bash
  node .claude/kit/board.mjs issue-review start --code-review --timeout-min 10 --brief <tmpdir>/sicherheit-auftrag.md --output <tmpdir>/sicherheit-antwort.md
  ```

Endet `review-brief` oder `start` mit Exit ungleich 0, ist das ein Ausfall mit diesem Grund.
Die Antwort wertet das Kit aus, nicht die Session — im Worktree, weil die Verursacher-Karten
aus seinen Commits seit dem Anker kommen:

```bash
node .claude/kit/worktree.mjs in <pfad> -- node .claude/kit/board.mjs issue-review security-result --file <tmpdir>/sicherheit-antwort.md --base <anker> --cards
```

Das Kommando stuft einen Befund KRITISCH oder WICHTIG ohne Angreifer, Grenze oder Folge
selbst auf HINWEIS herab, legt mit `--cards` je Befund KRITISCH oder WICHTIG eine
`[Task]`-Karte im Backlog an oder kommentiert die offene Karte mit demselben Titel und gibt
im Feld `ergebnis` das Urteil aus. Keine Karte geht nach Ready. Eine Karte, die
`issue check-form` nicht besteht oder am Board scheitert, steht mit Titel und Grund im Feld
`nichtAngelegt`; sie ändert das Urteil nicht, hält nicht an, und der Bericht in Schritt 9
nennt sie mit ihrem Grund (Issue #2213). Gehandelt wird allein nach `ergebnis`:

- **`gruen`** — kein Befund KRITISCH. Weiter mit Schritt 6. `gruen` kann Befunde WICHTIG
  und HINWEIS tragen; sie halten nicht an, ihre Karten entstehen trotzdem, und Schritt 9
  nennt sie.
- **`kritisch`** — endet wie ein roter Prüflauf: kein Commit, kein Push, weiter mit
  Schritt 8, der Worktree wird abgebaut. Der Bericht nennt jeden Befund KRITISCH im Wortlaut
  und die Karte, die zu seiner Behebung im Backlog liegt.
- **`ausfall`** — keine auswertbare Antwort, die Zeitgrenze überschritten oder ein
  gescheiterter Aufruf. Der Skill fragt wörtlich: „Sicherheitsprüfung ausgefallen: <Grund>.
  Ohne sie veröffentlichen?“ Nur `ja` fährt fort mit Schritt 6, und Schritt 9 vermerkt
  „ohne Sicherheitsprüfung veröffentlicht“. Alles andere endet wie ein roter Lauf: kein
  Commit, kein Push, weiter mit Schritt 8.

Scheitert `security-result` selbst, ist das ein Ausfall mit seiner Meldung als Grund.
