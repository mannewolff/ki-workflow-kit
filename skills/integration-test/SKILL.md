---
name: integration-test
description: Runs the integration run: the full scope of all checks of the project over the whole current state, and names the work packages finished since the last green integration run. Use this skill when the user invokes /integration-test or asks for the integration test; never as part of implementing a work package.
user-invocable: true
---
<!-- SPDX-License-Identifier: MIT -->

# Integration Test

Interaktiv löst der Mensch den Integrationslauf selbst aus. Der Abschluss eines Pakets fährt nur, was dieses Paket fertig macht; den vollen Umfang holt der Integrationslauf nach, wenn die Pakete eines Vorhabens durch sind (Plan #1969, E6, E11). `/implement-next`, `/implement-ready` und `/implement-done` rufen diesen Skill nie. Eine Ausnahme gibt es (Plan #2087, A11): Hat eine Sitzung von `/implement-next` oder `/implement-ready` die letzte offene Reparaturkarte nach In review gebracht, startet sie `checks.mjs run --integration` selbst als Nachprüfung der Reparaturen.

Der Skill ist **kein Prozessschritt** und trägt keine Nummer; er löst nur aus. Unbeaufsichtigt fährt der Runner den Integrationslauf selbst, am Ende eines Laufs über Ready oder einer Kette (Pro), außer in Pro mit Build-Dienst. Dort prüft die Prüfung je Karte jeden fertigen Stand im vollen Umfang im Build-Dienst, und der Integrationslauf ist keine Pflicht mehr; der Mensch kann ihn mit diesem Skill weiter auslösen (Plan #2145, E15). `push main` prüft den vollen Umfang ohnehin oder veröffentlicht nur einen grün geprüften Stand; ein grüner Integrationslauf ist dafür keine Voraussetzung.

Ans Board schreibt der Skill nur nach einem roten Lauf, und nur über `issue repair`: Der Befehl legt die Reparaturkarten im Backlog an oder kommentiert eine schon offene (Plan #2087, A4). Sonst bewegt der Skill keine Karte, und er committet nicht und pusht nicht. Nach dem Lauf startet er nichts weiter, auch keine Vorbereitung der Veröffentlichung: In Pro tritt an ihre Stelle die Prüfung je Karte, die jeder Commit selbst auslöst (Plan #2145, E14).

## Ablauf

### 1. Den Integrationslauf fahren

```bash
node .claude/kit/checks.mjs run --integration
```

Der Lauf fährt jede Prüfung der Stufe `paket` ohne Bereichsfilter über den ganzen Stand, auch die, die beim Abschluss eines Pakets warten. Er sammelt alle Funde: Eine rote Prüfung beendet den Lauf nicht, jede Prüfung bekommt ein Ergebnis, bis die Obergrenze erreicht ist (Plan #2087, A1). Die Stufen `push` und `merge`, die Gütemessung und der Mutationstest bleiben mit Grund aus; sie laufen beim Veröffentlichen. Den Anker bestimmt das Kommando selbst, den Nullpunkt seit dem letzten grünen Integrationslauf: Der Skill übergibt weder `--since` noch `--stage`, `--area` oder `--finish`, das Kommando wiese sie ab.

Der Lauf dauert so lange wie der volle Katalog und bricht nach seiner Obergrenze von selbst ab. Aufrufen mit einem großzügigen, ausdrücklich gesetzten Timeout von 25 Minuten, nicht mit dem Vorgabewert. Läuft er im Hintergrund, wartet der Skill sein Ende ab und prüft dabei, ob der Lauf noch existiert; eine Meldung, die nur ankündigt, ist kein Abschluss.

Die erste Zeile der Ausgabe lautet `Integrationslauf seit <commit> (<quelle>): <pakete>`. Sie nennt die Pakete, die dieser Lauf prüft. Der Exitcode sagt grün (0) oder nicht grün (1); welches Urteil, sagt der nächste Schritt.

### 2. Ergebnis und Pakete lesen

```bash
node .claude/kit/checks.mjs integration
```

Das Kommando ändert nichts. Es nennt:

- `letztesErgebnis` — `ergebnis` des eben gefahrenen Laufs: `gruen`, `rot` oder `offen`, dazu `commit` und `zeitpunkt`.
- `nullpunkt` — ab welchem Commit die Pakete zählen, mit `quelle`: `integration` für einen grünen Integrationslauf oder einen grünen `push main`, `origin` für den Rückfall auf `origin/<mainBranch>`.
- `pakete` — die Commits mit `Issue #N` seit dem Nullpunkt, je Karte eine Gruppe, aus welchem Plan sie auch stammen.
- `fetch` — das Alter des letzten `fetch`.

Nach einem grünen Lauf ist der eben geprüfte Stand der neue Nullpunkt, und `pakete` ist leer; die geprüften Pakete stehen dann in der ersten Zeile aus Schritt 1. Nach `rot` und `offen` bleibt der Nullpunkt stehen, und `pakete` nennt dieselben Pakete weiter.

### 3. Melden

Die Meldung beginnt mit dem Ergebnis und nennt die Pakete seit dem Nullpunkt, je Paket `Issue #N`. Ist `quelle` `origin` und der letzte `fetch` älter als einen Tag, nennt sie das Alter: Der Nullpunkt kann dann älter sein, als er ist.

- **`gruen`** — der volle Umfang ist grün. Die Meldung nennt die geprüften Pakete und den neuen Nullpunkt (`commit`).
- **`rot`** — die Meldung nennt alle Funde: jede rote Prüfung mit ihren Verursachern, die Zeilen `Verursacher (<cmd>): …` aus der Ausgabe von Schritt 1, die auch im Feld `verursacher` von `.claude/checks-summary.json` stehen. Findet sich zu einer roten Prüfung kein Paket, sagt die Meldung das ausdrücklich. Danach legt der Skill die Reparaturkarten an:

  ```bash
  node .claude/kit/board.mjs issue repair --summary .claude/checks-summary.json
  ```

  Der Befehl legt je Ursache und Plan eine Karte im Backlog an und kommentiert stattdessen eine schon offene Karte derselben Ursache; ein Fund an der Umgebung wird keine Karte, sondern ein Handgriff. Die Meldung nennt die angelegten und die kommentierten Karten mit Nummer und die Handgriffe, jeden mit seinem einen Schritt. Nach Ready zieht der Skill keine Karte: Das GO für die Reparatur gibt der Mensch.
- **`offen`** — der Lauf endete ohne vollständiges Urteil, etwa an seiner Obergrenze. Er gilt nicht als bestanden. Die Meldung nennt die Prüfungen, die nicht gestartet wurden, und dass ein neuer Aufruf von `/integration-test` den Lauf nachholt.

## Was dieser Skill nicht tut

- Er wird nie aus der Umsetzung eines Pakets heraus aufgerufen; nach der letzten offenen Reparaturkarte startet die Umsetzung `checks.mjs run --integration` selbst, nicht diesen Skill.
- Er legt Karten nur über `issue repair` an, und nur nach einem roten Lauf; er zieht keine Karte nach Ready.
- Er committet nicht und pusht nicht, und er startet nach dem Lauf weder eine Prüfung noch eine Vorbereitung.
- Er zählt nicht in die Auswertung später Fehler: Der interaktive Integrationslauf wird nicht gezählt (#737).
