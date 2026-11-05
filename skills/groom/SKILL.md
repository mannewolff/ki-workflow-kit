---
name: groom
description: Grooms a reviewed requirement or implementation plan with the PO: all open questions in one template, each with a recommendation, its reason and the finished incorporation; a question can be clarified in conversation before the yes without writing, the yes writes the decided numbers, including the note "None" once nothing is open, deferred numbers stay open and objected ones are renegotiated afterwards. Use this skill when the user invokes /groom or wants to decide the open questions of a requirement.
user-invocable: true
---
<!-- SPDX-License-Identifier: MIT -->

# Groom

Ein Fachplan, den Modelle geprüft haben, trägt oft noch offene Fragen an den PO, ein geprüfter Umsetzungsplan ebenso. Dieser Skill führt durch sie: Er legt alle offenen Fragen unter `## Offene Fragen an den PO` — beim Umsetzungsplan unter `## Offene Fragen` — in einer Vorlage vor, jede mit Empfehlung, Begründung und fertiger Einarbeitung. Der Mensch liest im Stück, klärt einzelne Nummern vorab im Gespräch, stellt welche zurück oder widerspricht; sein Ja übernimmt alle übrigen wie empfohlen. Danach schreibt die Session in einem Zug den Body, den Vermerk „Keine“ und `kit:clarified`, und der Fachplan ist bereit für `/techplan`.

Das Mechanische trägt das Kommando `issue questions`: welche Fragen offen sind, ob der Ablauf beginnen darf, welcher Kommentar die Stopp-Frage trägt, ob ein neuer Body Kennzeichnungszeilen und Antworten behält, wie der Vermerk lautet, ob die Karte Szenarien braucht und was sich an Kriterien, Szenarien und Nicht-Zielen geändert hat. Es liest nur. Empfehlung, Einarbeitung und Folgefragen sind Urteil der Session und stehen hier.

**Feste Zeilen.** Überschriften, Marker, Review- und Einarbeitungs-Köpfe und Fundblock-Zeilen, die dieser Skill in Dokumente, Kommentare oder Markerzeilen schreibt, stehen hier deutsch. Vor dem ersten Schreiben `node .claude/kit/board.mjs names` aufrufen: Das Feld `lines` nennt je deutscher Zeile die Fassung der Projektsprache, und der Skill schreibt die ausgegebene Fassung. Eine Zeile mit veränderlichem Rest (`## Einarbeitung, Runde 2`) steht dort mit ihrem festen Anfang, eine Überschrift mit `## ` davor gilt auf jeder Ebene, und was `names` nicht nennt, bleibt, wie es hier steht.

## Ablauf

### 1. Einstieg

`/groom #N` nimmt genau einen Fachplan oder Umsetzungsplan. Erster Schritt, vor allem anderen: **Unbeaufsichtigt** (gesetztes, nicht leeres `KIT_AGENT_MODEL`) beginnt der Skill nicht und meldet das — niemand kann antworten. Dieselbe Bedingung prüft das Kommando und weist mit dem Grund `unbeaufsichtigt` ab.

```bash
node .claude/kit/board.mjs issue questions <N>
```

Die Ausgabe trägt `einstieg` (`start`, `grund`, `meldung`), `fragen` (`vermerk`, `fragen`, `ungegliedert`, `offen`), `stoppKommentar`, `vermerkVorschlag` und `szenarien` (`pflicht`, `vorhanden`, `vollstaendig`, ohne Stichtag dazu `hinweis`). Bei `start: false` meldet der Skill die `meldung` und endet ohne Änderung — eine Karte, die weder `[Requirement]` noch `[Plan]` ist (`kein-fachplan`), unbeaufsichtigt (`unbeaufsichtigt`), ein Fachplan ohne `review:done` und ohne `kit:clarify` (`ungeprueft`, der Weg ist zuerst `/issue-review #<N>`), ein Fachplan mit Vermerk „Keine“ und ohne `kit:clarify` (`nichts-offen`). Nennt das Kommando dazu einen `hinweis` — etwa eine Frage ohne Antwortzeile unter einem gesetzten Vermerk —, steht er in der Meldung; der Skill entfernt den Vermerk nicht. Bei `start: true` mit dem Grund `szenarien-fehlen` steht der Vermerk schon, aber der Karte fehlen die Szenarien: Der Skill meldet die `meldung` und beginnt mit Schritt 3. Nennt `szenarien` einen `hinweis` — der Stichtag fehlt —, gibt der Skill ihn wörtlich weiter.

Ein Fachplan trägt den Titel `[Requirement]`, ein Umsetzungsplan `[Plan]`. Beim `[Plan]` liest das Kommando die Fragen aus dem Abschnitt `## Offene Fragen`, Szenarien braucht er nicht (`szenarien.pflicht` ist `false`); alles Weitere gilt wie beim Fachplan, mit „Fachplan“ als Name für die Karte.

Meldet `fragen` Absätze unter `ungegliedert`, steht ihre Gliederung in nummerierte Fragen als erste Änderung in der Vorlage (Schritt 6) — eine stille Umdeutung von Fließtext wäre eine Änderung ohne Zustimmung.

### 2. Start-Body ablegen

Den Body, wie er jetzt am Board steht, legt der Skill als `<tmpdir>/<N>-groom-start.md` ab — gegen ihn misst Schritt 9, was sich an Kriterien, Szenarien und Nicht-Zielen geändert hat. Die Datei entsteht nach der Transportregel aus `CLAUDE-workflow.md`, Abschnitt „Lange Texte ans Board“: erst `printenv TMPDIR` (bleibt die Ausgabe leer, gilt `/tmp`), dann stückweise `cat >` und `cat >>` mit je höchstens 6.000 Zeichen, jedes Stück ein **eigener** Werkzeugaufruf mit wörtlichem Pfad, nie als Variable. Dasselbe gilt für jeden neuen Body in Schritt 6 und 8. Scheitert ein Dateischritt, gilt: Eine unvollständige Datei wird nicht übertragen; scheitert ein Board-Aufruf, meldet der Skill den Fehler mit dem Pfad und endet ohne weitere Änderung.

### 3. Szenarien ergänzen

Meldet `szenarien` die Karte als pflichtig (`pflicht: true`) und `vollstaendig: false` — der Abschnitt `## Szenarien` fehlt oder trägt kein vollständiges Szenario —, steht ein Szenarien-Vorschlag als erster Teil der Vorlage, vor allen Fragen. Der Skill schlägt Szenarien aus den fachlichen Akzeptanzkriterien vor: je Szenario `### Szenario: <Titel>` mit Listenzeilen `Angenommen`, `Wenn`, `Dann` und bei Bedarf `Und`, technikfrei wie der übrige Fachplan, mit den Schlüsselwörtern der Projektsprache — im englischen Projekt `## Scenarios`, `### Scenario: <title>`, `Given`, `When`, `Then`, `And`. Der Abschnitt steht zwischen `## Fachliche Akzeptanzkriterien` und `## Nicht-Ziele`. Nicht jedes Kriterium braucht ein Szenario, eines genügt.

Geschrieben wird der Abschnitt **erst nach Zustimmung**, mit dem Ja zur ganzen Vorlage (Schritt 6). Ändert der Mensch den Vorschlag, gilt seine Fassung. Fehlt der Vermerk noch, entsteht der Vermerk „Keine“ erst danach, im selben Zug; steht er schon (`szenarien-fehlen`), bleibt er unverändert. Bei `pflicht: false` oder `"ohne-stichtag"` entfällt der Teil.

### 4. Stopp-Frage zuerst

Trägt der Fachplan `kit:clarify` und liefert das Kommando einen `stoppKommentar` mit Kommentar, formuliert der Skill aus dessen Text die Stopp-Frage der angehaltenen Prüfung. Sie steht in der Vorlage **zuerst** unter den Fragen, nach einem Szenarien-Vorschlag. In den Body kommt sie als nächste freie Nummer ans Ende der Liste, mit dem Zusatz `(Stopp-Frage der Prüfung vom <Datum>)` (Datum des Kommentars) — die vorhandenen Fragen werden nicht umnummeriert, weil Antworten und Kommentare auf ihre Nummern verweisen. Frage und Antwort gehen zusammen in den Body, wie in Schritt 6.

Ist `kit:clarify` gesetzt, aber `stoppKommentar` ohne Kommentar, sagt der Skill mit dem Grund aus der Ausgabe, dass der Halt keiner Prüfung des Fachplans entstammt und sein Weg im Halt-Kommentar steht, und groomt die übrigen offenen Fragen.

### 5. Je offene Frage: Empfehlung und fertige Einarbeitung

Für jede offene Frage, in ihrer Reihenfolge, bereitet der Skill vor:

- seine Empfehlung und deren Begründung;
- die fertige Einarbeitung: die Antwortzeile unter der Frage — beim `[Plan]` kommt sie ebenso unter die Frage in `## Offene Fragen` —, eingerückt, in der Form `**Antwort (<Urheber>, <JJJJ-MM-TT>):**` gefolgt vom Inhalt — Urheber und Datum sind Pflicht, sonst gilt die Frage weiter als offen. Übernimmt der Mensch die Empfehlung, steht ihr Inhalt dort ausgeschrieben, nie „wie empfohlen“: Der Body ist der verhandelte Stand, auf den sich der Plan stützt, und muss ohne die Vorlage lesbar sein;
- die Änderung an Ziel, fachlichen Akzeptanzkriterien oder Nicht-Zielen, die aus der Empfehlung folgt;
- erzwingt die Empfehlung eine Folgefrage, steht sie mit Begründung, warum sie nötig ist, und mit eigener Empfehlung in derselben Vorlage — als neue Frage am Ende der Liste. Steht der Vermerk „Keine“ schon im Abschnitt, nimmt dieselbe Änderung ihn heraus.

Beim Umsetzungsplan liest den Block `kit-vorlage` (Schritt 6) jemand aus dem Fachbereich: Frage, Empfehlung und Grund formuliert der Skill dort in Alltagssprache, ohne Begriffe aus der Softwareentwicklung — Maßstab ist die Liste `test/fixtures/entwicklerbegriffe.json`. Die Antwortzeile im Body darf beim Plan die Begriffe des Plans tragen; sie gibt dieselbe Entscheidung wieder.

Lässt sich ein Punkt nicht als Frage mit Empfehlung fassen, steht er in der Vorlage als „im Gespräch zu klären“, ohne Empfehlung; der Skill klärt ihn nach dem Ja im freien Gespräch und legt das Ergebnis als Antwort zur Zustimmung vor.

Eigene Prüffunde bringt der Skill nicht ein: Jede Änderung am Body stammt aus einer Antwort des Menschen oder, bei den Szenarien aus Schritt 3, aus seiner Zustimmung.

### 6. Vorlage zeigen, nach dem Ja in einem Zug schreiben

Der Skill legt alle offenen Fragen in einer Vorlage vor — auch die schon geklärten (Schritt 7) und die zurückgestellten, solange nichts geschrieben ist —, nummeriert wie im Body, in dieser Reihenfolge: ein fälliger Szenarien-Vorschlag (Schritt 3), die Stopp-Frage (Schritt 4), dann jede offene Frage mit Empfehlung, Begründung und fertiger Einarbeitung (Schritt 5). Als letzte Zeile steht der Vermerk „Keine“, falls nach den Empfehlungen nichts offen bliebe, in der Form, die `vermerkVorschlag` liefert. Danach endet die Vorlage mit einem maschinenlesbaren Codeblock der Sprache `json` mit der Kennung `kit-vorlage`, damit die App dieselben Einträge darstellen kann. Er trägt je Eintrag ein Objekt mit Nummer, Frage, Empfehlung, Begründung und fertiger Einarbeitung, in derselben Nummerierung wie die Vorlage, einschließlich Szenarien-Vorschlag und Stopp-Frage:

````markdown
```json kit-vorlage
[{ "nr": 3, "frage": "…", "empfehlung": "…", "grund": "…", "einarbeitung": "…",
   "optionen": [{ "text": "…", "empfohlen": true }, { "text": "…", "hinweis": "…" }] }]
```
````

Ein Eintrag darf zusätzlich `optionen: [{ text, hinweis?, empfohlen? }]` tragen, in derselben Form wie bei `/triage`: Wo sich die Antwort als Wahl fassen lässt, stehen Optionen, die empfohlene mit `"empfohlen": true`, und `hinweis` sagt in einem Satz, was aus der Wahl folgt; eine eigene Antwort bleibt immer möglich. Ein Punkt „im Gespräch zu klären“ steht ohne Optionen und ohne Empfehlung.

Der Block ist nur Darstellung: Schreiben in den Body, Vermerk „Keine“ und Label bleiben beim Skill. Der Mensch antwortet mit einem Ja, einem `Klären <n>: <text>` (Schritt 7), einem Widerspruch zu einzelnen Nummern (Schritt 8) oder `<n> zurückstellen` je Nummer — auch mehreres davon in einer Antwort, etwa „Ja, 3 zurückstellen“.

Geschrieben wird **erst nach dem Ja zur ganzen Vorlage**, dann in einem Zug und ohne weitere Rückfrage zu Schreiben, Vermerk oder Label. Das Ja schreibt nur die entschiedenen Nummern: die übernommenen Empfehlungen und die Fassungen, die ein `Klären` geliefert hat. Eine zurückgestellte Nummer (`<n> zurückstellen`) bleibt offen und bekommt keine Antwortzeile.

1. Der neue, vollständige Body mit Szenarien, Stopp-Frage, allen Antwortzeilen und den Änderungen daraus entsteht als `<tmpdir>/<N>-groom-body.md` nach der Transportregel; die Kennzeichnungszeilen (`Autor-Modell:`, `Fachplan-Review:`, `Vorlage:`, `Wartet auf Ereignis:`) bleiben unverändert. Das Warten setzt und hebt allein der Mensch: `/groom` ruft `issue hold` nie auf. Vor dem Schreiben prüft das Kommando ihn gegen den Body am Board:

```bash
node .claude/kit/board.mjs issue questions <N> --body-file <tmpdir>/<N>-groom-body.md
```

2. Bei `pruefung.ok` (Exit 0) geht er ans Board:

```bash
node .claude/kit/board.mjs issue update <N> --body-file <tmpdir>/<N>-groom-body.md
```

3. Ist danach keine Frage mehr offen, folgen im selben Zug der Vermerk „Keine“ und `kit:clarified` (Schritt 8).

Meldet die Prüfung Verstöße (Exit 1), schreibt der Skill nicht. Er korrigiert die Datei, zeigt die Änderung erneut und prüft noch einmal.

### 7. Klären vor dem Ja

Antwortet der Mensch mit `Klären <n>: <text>`, will er Frage n anders entscheiden oder erst verstehen, bevor er zustimmt — so sendet die App „Anders entscheiden“. Der Skill verhandelt Frage n im Gespräch mit dem Text als erster Antwort, bis sie entschieden ist, und liefert danach ihren Eintrag neu im Block `kit-vorlage`: mit der vereinbarten Antwort als `empfehlung` und `einarbeitung` und, wo es passt, neuen `optionen`. Er schreibt dabei nichts in die Karte, weder Body noch Vermerk noch Label; die geklärte Fassung bleibt vorgemerkt, bis das Ja zur ganzen Vorlage kommt (Schritt 6), und gilt dann für Frage n statt der ersten Empfehlung. Erzwingt die Klärung eine Folgefrage, steht sie als neuer Eintrag am Ende des Blocks, mit Empfehlung.

Ein `Klären` zu einer anderen Nummer beginnt dieselbe Runde für diese Frage; vorgemerkte Fassungen bleiben dabei stehen. Erst das Ja — in der App „Antworten übernehmen“ — schreibt, und dann nur die entschiedenen Nummern.

### 8. Widerspruch, Zurückstellen und Vermerk „Keine“

Widerspricht der Mensch einzelnen Nummern, schreibt der Skill mit dem Ja die übrigen wie in Schritt 6 und verhandelt die widersprochenen danach einzeln nach: Frage, Antwort des Menschen, Einarbeitung zur Zustimmung, nach Zustimmung schreiben wie in Schritt 6. Erzwingt erst ein Widerspruch eine Folgefrage, kommt sie in dieser Nachverhandlung, mit Empfehlung. Der Vermerk „Keine“ kommt erst, wenn alle Fragen entschieden sind.

Eine zurückgestellte Nummer (`<n> zurückstellen`) bleibt ohne Antwortzeile und damit offen, am Board wird nichts vermerkt; der Skill nennt sie am Ende. Ein späterer Aufruf legt nur noch die offenen Fragen vor. Ist eine Frage zurückgestellt, entfällt der Vermerk.

Sind alle Fragen entschieden und keine zurückgestellt, liefert ein erneuter Aufruf `issue questions <N>` den Vermerk unter `vermerkVorschlag` — mit der Zahl aller Fragen des Abschnitts, Folgefragen eingeschlossen, und dem heutigen Datum. Der Skill übernimmt ihn wörtlich als erste Zeile unter `## Offene Fragen an den PO` (beim Umsetzungsplan unter `## Offene Fragen`); Fragen und Antworten bleiben darunter stehen. Er schreibt ihn ohne weitere Rückfrage wie in Schritt 6 — die Zustimmung dazu gab das Ja zur Vorlage oder die letzte Zustimmung der Nachverhandlung.

Nach dem Schreiben des Vermerks setzt der Skill `node .claude/kit/board.mjs issue label add <N> kit:clarified`: Das Label zeigt am Board, dass keine Frage an den PO offen ist — eine Hilfe für den Menschen, kein Kriterium; die Kette prüft weiter den Vermerk. Ist es am Board nicht definiert, nennt der Skill die Fehlermeldung des Adapters und läuft weiter. Entfällt der Vermerk, entfällt auch das Label.

### 9. Abschluss

Die Abschlussmeldung nennt:

- ob `kit:clarified` gesetzt ist, oder die Fehlermeldung des Adapters, wenn das Label am Board fehlt;
- die zurückgestellten Fragen mit Nummer, oder dass keine zurückgestellt ist;
- bei `kit:clarify` mit `stoppKommentar`: dass der Mensch `kit:clarify` abnimmt und den Fachplan erneut prüfen lässt (`/issue-review #<N>`);
- bei `kit:clarify` ohne `stoppKommentar`: dass der Halt keiner Prüfung des Fachplans entstammt und sein Weg im Halt-Kommentar steht;
- den Prüfvorschlag aus dem Vergleich mit dem Start-Body:

```bash
node .claude/kit/board.mjs issue questions <N> --compare <tmpdir>/<N>-groom-start.md
```

Ist unter `aenderungen` ein Kriterium, ein Nicht-Ziel oder ein Szenario ergänzt, gestrichen oder umformuliert, trägt `vorschlag` die erneute Prüfung (`/issue-review #<N>`): Der Skill schlägt sie vor und nennt die geänderten Kriterien, Nicht-Ziele und Szenarien (diese mit Titel). Der Vorschlag ist eine Nennung im Abschluss, keine Frage. Ist `vorschlag` null, schlägt er nichts vor — auch ein in Schritt 3 ergänzter Abschnitt führt so zur erneuten Prüfung. Steht der Vermerk, ist der Weg danach `/techplan #<N>`, beim Umsetzungsplan `/issues #<N>`.

## Stop-Punkte

- Kein Label setzen oder abnehmen — `review:done` und `kit:clarify` bleiben, wie sie sind; `kit:clarify` nimmt allein der Mensch ab. Einzige Ausnahme: `kit:clarified` nach dem Vermerk „Keine“ (Schritt 8); abgenommen wird auch dieses nie.
- Keine Prüfung starten — der Skill schlägt `/issue-review` nur vor.
- Keine eigenen Prüffunde einbringen — jede Änderung stammt aus einer Antwort.
- Kein `[Plan]` anlegen — das ist `/techplan`.
- Keine Bewegung der Karte auf dem Board.
- Nichts schreiben ohne Zustimmung — sie gilt der ganzen Vorlage; ein `Klären` ist keine —, und nie einen Body, den `issue questions --body-file` abgewiesen hat.
- Unbeaufsichtigt (`KIT_AGENT_MODEL` gesetzt): nicht beginnen.
