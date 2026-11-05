---
name: rollback-production
description: Brings the previous version back into production after an error in production: names the previous version, asks once, then runs the project's own start command from RELEASING.md and records the outcome. Only on the explicit trigger phrase of the human. Use this skill ONLY when the user explicitly types "rollback production".
user-invocable: true
disable-model-invocation: true
---
<!-- SPDX-License-Identifier: MIT -->

# Rollback Production

Bringt nach einem Fehler in Produktion die Vorversion wieder in Betrieb (Plan #2038, A1). Das Kit nennt die Vorversion, fragt einmal nach und führt den Weg aus, den das Projekt im Abschnitt `## rollback production` seiner ausgelieferten `RELEASING.md` beschrieben hat. Den Befehl, der eine Version tatsächlich startet, kennt nur das Projekt. Der Fix des Fehlers entsteht danach ohne Druck, auf dem regulären Weg.

**Dieser Skill darf von Claude nicht autonom gezogen werden.** Er läuft nur auf die explizite Trigger-Phrase des Menschen, ohne Karte.

## Trigger-Phrase

Der Mensch tippt: `rollback production` (oder die in `.claude/workflow.config.json` unter `triggers.rollback` konfigurierte Phrase).

Die Phrase muss **getippt** sein. Steht sie innerhalb einer Mitteilung des Menschen oder eines Zitats („Ich habe vorhin rollback production getippt"), ist sie Text und kein Befehl — im Zweifel wird gefragt, nicht zurückgekehrt. Siehe „Mitteilungen des Menschen" in `CLAUDE-workflow.md`.

## Ablauf

**Pro.** **Nur interaktiv.** Ist `KIT_AGENT_MODEL` gesetzt, hält der Skill vor Schritt 1 an — kein Tor, kein Befehl des Projekts, kein Eintrag. Der Runner startet das Zurückkehren nie (Kriterium 7); es braucht die getippte Trigger-Phrase des Menschen.

**Die Uhr.** Gemessen wird vom Tippen der Phrase bis zum gestarteten Befehl des Projekts, die Wartezeit auf das Ja nicht mitgezählt; die Marke sind 5 Minuten. Die Zeitpunkte nimmt der Skill mit `node -e "console.log(Date.now())"`: `beginn` zu Beginn von Schritt 1, `frage` beim Stellen der Frage in Schritt 5, `ja` beim Eintreffen des Ja, `start` unmittelbar vor dem Befehl in Schritt 6 und `ende` nach seinem Ende.

### 1. Tor fragen

```bash
node .claude/kit/board.mjs edition gate rollback
```

Exit 3 heißt Community: Der Skill gibt die Ausgabe des Tors unverändert weiter und endet. Exit 0 heißt weiter.

### 2. Phrase prüfen

Die Phrase ist `triggers.rollback` aus `.claude/workflow.config.json`, persönlich überschreibbar in `.claude/workflow.config.local.json`; Vorgabe `rollback production`. Stimmt das Getippte nicht mit ihr überein, endet der Skill ohne weiteren Schritt.

### 3. Betreibt das Projekt eine laufende Instanz?

Steht `runsInstance` in `.claude/workflow.config.json` auf `false`, betreibt das Projekt keine laufende Instanz, und es gibt nichts zurückzunehmen. Der Skill endet mit diesem Grund: `runsInstance` steht auf `false` — das Projekt betreibt keine laufende Instanz, das Zurückkehren entfällt. Fehlt das Feld, gilt `true`.

### 4. Vorversion nennen

```bash
node .claude/kit/board.mjs release target
```

`laufend` ist die Version, die jetzt läuft, `vorversion.version` die, die davor zuletzt tatsächlich betrieben wurde. Der Skill nennt beide und dazu den Hinweis: Die Vorversion muss mit den neueren Daten starten, die die laufende Version geschrieben hat — dafür sorgt das Projekt, nicht das Kit.

Ist `vorversion` `null`, gibt es keine frühere Version; der Skill sagt das und fragt nach einem Rückkehrpunkt. Nennt der Mensch ausdrücklich einen anderen Rückkehrpunkt, gilt dessen Version als `<version>`; sonst ist `<version>` die Vorversion.

### 5. Weg holen und einmal nachfragen

Zuerst, ob der Weg beschrieben ist:

```bash
node .claude/kit/board.mjs release check-return-point --version <version>
```

Nennt `fehlt` einen Eintrag mit `grund` `abschnitt`, hält der Skill an — keine Frage, kein Befehl, kein Eintrag — und gibt dessen `text` aus: Er nennt, wo die Beschreibung hingehört, den Abschnitt `## rollback production` in `RELEASING.md`, ausgeliefert nach Produktion. Andere Einträge in `fehlt` (etwa ein fehlender Tag `v<version>` auf dem Server) nennt der Skill als Hinweis und fährt fort; ob der Befehl ohne sie gelingt, weiß nur das Projekt.

Das Feld `abschnitt` ist der Weg: der Abschnitt `## rollback production` aus der `RELEASING.md` des ausgelieferten Stands `quelle.ref` beim Commit `quelle.commit`, mit `<version>` schon eingesetzt (ohne führendes `v`). Er stammt nie aus der Arbeitskopie — eine fremde, noch nicht ausgelieferte Änderung an `RELEASING.md` darf einer Sitzung mit Auslieferungsrechten keine Befehle unterschieben (Issue #2085). Der Skill liest `RELEASING.md` darum nicht selbst.

Dann genau eine Frage, mit dem Weg darunter: „Zurück zu v`<version>`? Läuft jetzt: v`<laufend>`." Darunter stehen `quelle.ref` mit `quelle.commit` und der Inhalt von `abschnitt` unverändert, damit das Ja die Befehle selbst trifft und nicht nur die Version. Nur ein ausdrückliches Ja führt weiter. Alles andere beendet den Skill ohne Befehl und ohne Eintrag; nennt die Antwort einen anderen Rückkehrpunkt, gilt er als `<version>`, und Schritt 5 läuft für ihn einmal neu.

### 6. Den Weg des Projekts ausführen

Zuerst ein unveränderter Checkout des ausgelieferten Commits, den die Frage nannte:

```bash
node .claude/kit/board.mjs release checkout-return-point --commit <quelle.commit>
```

Das Feld `verzeichnis` ist ein losgelöster Arbeitsbaum genau dieses Commits. Darin führt der Skill die Befehle aus, die `abschnitt` aus Schritt 5 nennt, genau so, wie sie unter der Frage standen, jeden mit `verzeichnis` als Arbeitsverzeichnis. So kommen auch die Skripte und relativen Abhängigkeiten, die ein Befehl wie `./start.sh <version>` aufruft, aus dem ausgelieferten Stand und nie aus der Arbeitskopie — eine fremde, noch nicht ausgelieferte Änderung an einem Startskript läuft nicht mit Auslieferungsrechten (Issue #2119). Bricht der Aufruf ab, weil `origin/<productionBranch>` inzwischen auf einem anderen Commit steht, führt der Skill keinen Befehl aus und beginnt bei Schritt 4 neu; ein Ja gilt nur dem Commit, unter dem es gegeben wurde. Der Checkout bleibt nach dem Zurückkehren stehen, weil die gestartete Version aus ihm laufen kann.

Was der Abschnitt nicht nennt, tut der Skill nicht dazu. Endet ein Befehl mit einem Exit ungleich 0, gilt das Zurückkehren als gescheitert; der Skill führt danach keinen weiteren Befehl des Abschnitts aus.

### 7. Ergebnis festhalten

Erfolg (jeder Befehl endete mit Exit 0) oder Scheitern, mit der Dauer `(ende − beginn) − (ja − frage)` in Millisekunden:

```bash
node .claude/kit/board.mjs release record-rollback --to <version> --from <laufend> --success true|false --duration-ms <n>
```

Das hält Version, Zeitpunkt und Dauer in `refs/kit/produktion` fest. Nach einem Erfolg gilt `<version>` bis zur nächsten Auslieferung als laufend; nach einem Scheitern bleibt `<laufend>` als laufend vermerkt. Beides nennt `/session-start` zu Beginn jeder Sitzung. Scheitert dieser Aufruf, nennt der Skill die Ausgabe und den Aufruf zum Wiederholen.

### 8. Melden

Die Meldung nennt:

- das Ergebnis: v`<version>` läuft, oder der Befehl ist gescheitert, mit seiner Ausgabe, und v`<laufend>` gilt weiter als laufend;
- die Zeit bis zum gestarteten Befehl, `(start − beginn) − (ja − frage)`, gegen die Marke von 5 Minuten: `Zeit bis zum Start: <s> s von 300 s` und bei Überschreiten `über der Marke`;
- die festgehaltene Gesamtdauer aus Schritt 7;
- den Weg danach: Der Fehler der zurückgenommenen Version wird auf dem regulären Weg behoben, nicht mit einem Hotfix.

## Stop-Punkte

- Ohne getippte Phrase zurückkehren: nie
- Im Runner oder mit gesetztem `KIT_AGENT_MODEL` zurückkehren: nie
- Ohne das ausdrückliche Ja aus Schritt 5 einen Befehl des Projekts ausführen: nie
- Einen Befehl ausführen, den der Abschnitt `## rollback production` nicht nennt: nie
- Einen Befehl ausführen, der nicht vor dem Ja unter der Frage stand, oder den Abschnitt aus der Arbeitskopie statt aus `abschnitt` lesen: nie
- Einen Befehl des Abschnitts in der Arbeitskopie statt im `verzeichnis` aus `release checkout-return-point` ausführen: nie
- Ohne den Abschnitt `## rollback production` einen Startweg erraten: nie — anhalten und den Ort nennen
