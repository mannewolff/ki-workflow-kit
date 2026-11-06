#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * board.mjs — Provider-agnostischer Einstiegspunkt fuer alle Board-Operationen.
 * Liest .claude/workflow.config.json, waehlt anhand issueTracker/codeHost den Adapter
 * und fuehrt die angeforderte Operation aus.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`
 * (aktualisiert den eingebetteten Blob in install.mjs).
 *
 * Ausgabe: JSON auf stdout. Einzige Ausnahme: `issue brief` ohne --json schreibt
 * Markdown (Issue #1023). Fehler: Meldung auf stderr, Exit-Code 1.
 *
 * Nutzung:
 *   node board.mjs issue create --title "..." --body "..." [--author-model <modell>]
      Body braucht eine Zeile "Autor-Modell: <modell>"; --author-model oder
      KIT_AGENT_MODEL setzen sie, sonst Abbruch. [--author-model <modell>]
 *       Der Body braucht eine Zeile "Autor-Modell: <modell>" (Issue #266);
 *       --author-model oder KIT_AGENT_MODEL setzen sie, sonst bricht der Aufruf ab.
 *       [--derived-from <nummer>] schickt die Kartennummer des naechsten Vorfahren
 *       mit (Issue #356). Nur der kanbancompat-Tracker wertet sie aus.
 *   node board.mjs issue get <id>
 *   node board.mjs issue activity <id> | issue activity --ids <n,n,...>
 *   node board.mjs issue list [--status <status>]
 *   node board.mjs issue move <id> <status>
 *   node board.mjs issue update <id> --body "..." | --body-file <pfad> | --body -
 *   node board.mjs issue comment <id> --text "..." | --text-file <pfad> | --text -
 *       '-' liest von stdin, gut fuer kurze Texte. Fuer lange (Review-Befunde) ist
 *       '--text-file' der Weg: eine stueckweise per Shell erzeugte Datei ausserhalb
 *       des Projektverzeichnisses (Issue #584).
 *       '--idempotency-key <wert>' wiederholt 'issue create' und 'issue comment'
 *       gefahrlos, wenn der Ausgang unklar blieb (Issue #834).
 *   node board.mjs issue report <id> --text '<bericht>' | --text-file <pfad> [--without-commit '<begruendung>']
 *   node board.mjs issue report <id> --part <n> --text '<stueck>'
 *   node board.mjs issue report <id> [--without-commit '<begruendung>'] [--no-move]
 *       Legt den Abschlussbericht ab und zieht nach In review, je Lauf idempotent
 *       (Issue #1022): gleicher Bericht desselben Laufs -> nichts, geaenderter ->
 *       ersetzt. --part schreibt Stueck n nach .claude/berichte/, der Aufruf ohne
 *       --text setzt die Stuecke zusammen und schliesst ab. Gezogen wird nur, wenn ein
 *       Commit seit dem Zug nach In progress "Issue #<N>" nennt (Issue #1584); ausgenommen
 *       sind [Mensch]-Karten, und --without-commit '<begruendung>' meldet ohne Commit,
 *       die Begruendung steht als Zeile im Bericht. --no-move (Issue #1786) legt nur den
 *       Bericht ab und zieht nicht; Laufzeile und Commit-Suche beziehen sich dann auf den
 *       Commit in KIT_PACKAGE_BASE (Start der Paket-Arbeitskopie), ohne ihn bricht es ab.
 *   node board.mjs issue run-state <id> --state running|aborted|waiting|done --text-file <pfad>
 *       Label und Kommentar '## Laufstand' einer Karte in einem Zug, wiederholbar
 *       (Issue #1083). Labelnamen aus night.stand.labels.
 *   node board.mjs issue brief <id> [--column ready|in_progress] [--json]
 *       Aufgabe, Voraussetzungen und das Urteil "darf beginnen" in einem Zug, rein
 *       lesend (Issue #1023). Ausgabe Markdown, mit --json als JSON.
 *   node board.mjs issue origin <plan>
 *       Ist der Plan durch, und welche Ursprungsdokumente wandern nach In review
 *       (Issue #1285)? Rein lesend, Ausgabe JSON.
 *   node board.mjs issue origin <plan>
      Stand der Ursprungsdokumente eines Plans (Issue #1285, Plan #1283): durch heisst,
      mindestens ein Paket ('Plan: Issue #M') liegt in In review oder Done und keines in
      Backlog, Ready oder In progress. Je Dokument (Plan, fachliche Anforderung aus
      'Fachliche Quelle:') die Aktion wandert | lag bereits in In review | lag bereits
      in Done | bleibt, mit Grund. Rein lesend, bewegt nichts. Ausgabe: { plan, durch,
      grund, fehlend: [{ id, titel, spalte }], dokumente: [{ id, art, spalte, aktion, grund }] }.
  node board.mjs issue label add <id> <name>
 *   node board.mjs issue label remove <id> <name>
 *       Zeichnet ein Issue (z. B. kit:klaeren). Nicht fuer Status-Labels — die
 *       aendert `issue move` (Issue #249).
 *   node board.mjs issue hold <id> --reason "<grund>" | --lift
 *       Warten eines Fachplans auf ein Ereignis setzen oder heben, Zeile und Label in
 *       einem Zug (Issue #1662).
 *   node board.mjs issue repair --summary <datei> | --ci <sha> [--author-model <modell>]
 *       Reparaturkarten aus einem roten Prueflauf (Issue #2092, Plan #2087 A7, A8): je
 *       roter Pruefung und Plan eine [Task]-Karte im Backlog mit der Zeile
 *       'Reparatur: <cmd>' und jedem Fund im Wortlaut; eine vorhandene Karte derselben
 *       Pruefung und desselben Plans bekommt einen Kommentar, aus In review dazu den Zug
 *       nach Backlog. Ein Fund an der Umgebung wird keine Karte, sondern ein Handgriff.
 *       --ci <sha> liest die Funde statt aus der Zusammenfassung aus dem Protokoll der
 *       roten Jobs des Build-Diensts zu diesem Commit (Issue #2094, A5); ein roter Job
 *       ohne Pruefzeile wird ein Handgriff. --summary und --ci zusammen: Exit 1.
 *       Ausgabe: { angelegt, kommentiert, zurueck, handgriffe }.
 *   node board.mjs code repo-name
 *   node board.mjs code pr --from <branch> --to <branch>
 *   node board.mjs code merge-pr --number <n> --head <sha>
 *   node board.mjs code ci-status --commit <sha> [--branch <branch>] [--check-branches]
 *       Zustand der CI fuer genau diesen Commit (Issue #316), mit --branch nur die
 *       Laeufe dieses Zweigs, samt Adresse des Laufs (Issue #1972), mit --check-branches
 *       nur die Laeufe der Pruefzweige <pushPruefung.zweig> und <pushPruefung.zweig>-*
 *       (Issue #2247); ohne pushPruefung mit ort buildDienst ein Fehler. Dispatcht ueber
 *       resolveCodeHost — die Achse haengt am codeHost, nicht am issueTracker. Eine kurze
 *       Kennung wird im Repo zur vollen aufgeloest, eine unbekannte endet mit Exit 1 (Issue #2132).
 *   node board.mjs code ci-wait --commit <sha> --timeout-min <n> [--branch <branch>] [--check-branches]
 *       Wartet auf das Urteil des Build-Diensts und endet immer (Issue #2132): ergebnis
 *       gruen|rot, keine ohne Build-Dienst, "kein Lauf" nach 5 Minuten ohne sichtbaren
 *       Lauf, frist nach <n> Minuten mit dem erreichten Schritt. Kurze Kennungen loest es
 *       wie ci-status zur vollen auf; eine unbekannte endet mit Exit 1.
 *   node board.mjs code contract-repo <name>
 *       Gebauter Stand des Partnerrepos aus vertragsRepos (Issue #1615, Plan #1611 E7),
 *       flach geklont nach <tmpdir>/kit-contract-repos/<name>-<commit12>.
 *   node board.mjs code protection status | setup [--branch <z>] | suspend --in <pfad>
 *                              | restore | verify [--branch <z>]
 *       Schutz von Haupt- und Veroeffentlichungszweig (Issue #1408, Plan #1405). status
 *       meldet { geschuetzt, fehlt, ungeprueft }, einrichten schaltet nach der Probe auf
 *       dem Pruefzweig scharf, aussetzen ist der Notfallweg hinter dem Notfall-Gate.
 *       einrichten, aussetzen und nachpruefen sind mit KIT_AGENT_MODEL gesperrt.
 *   node board.mjs context paths [--project <name>] [--date JJJJ-MM-TT]
  node board.mjs context last-log [--project <name>] [--before JJJJ-MM-TT]
  node board.mjs issue-review reviewers --author <modell>
  node board.mjs issue-review check [--path-only]
  node board.mjs issue-review matrix
  node board.mjs issue-review roles --stage <requirement|plan|issue> --author <model>
  node board.mjs issue-review review-brief --role <rolle> --file <ziel> (--id <N> | --material-file <pfad> [--source-ref <commit>])
      Montiert den Pruefauftrag eines Pruefers aus kit/rollen/<rolle>.md (Issue #1380).
      --source-ref: Blob-Quellen aus dem Baum dieses Commits statt aus dem Arbeitsbaum;
      unbekannter Commit: Fehler commit-unbekannt, keine Datei (Issue #2181).
      --role mehrfach: je Rolle ein Teil hinter '--- ROLLE <name> ---' (Issue #1869).
      Nicht zu verwechseln mit 'issue brief <id>', dem Umsetzungsauftrag einer Karte.
  node board.mjs issue-review start --reviewer <name> | --code-review --brief <datei> --output <datei> [--timeout-min <n>]
      Startet einen fremden Pruefer ohne Shell mit angehaengter Lesegrenze (Issue #1381).
      --timeout-min: beendet ihn nach n Minuten, Antwort fehler zeitgrenze ohne Ausgabedatei (Issue #1991).
  node board.mjs issue-review security-result --file <antwort> --base <anker> [--cards]
      Wertet die Antwort der Sicherheitspruefung aus (Issue #1992): JSON { ergebnis gruen|kritisch|ausfall,
      befunde }; KRITISCH/WICHTIG ohne Angreifer, Grenze oder Folge wird HINWEIS. --cards legt je Befund
      KRITISCH/WICHTIG eine [Task]-Karte im Backlog an oder kommentiert die offene mit demselben Titel.
  node board.mjs issue-review review-result --file <antwort>
      Wertet die Antwort der Rolle code-review aus, das nachgeholte Review nach einem Hotfix (Issue #2055):
      JSON { ergebnis ok|kritisch|ausfall, befunde }; ein Fund KRITISCH haelt an.
  node board.mjs doctor [--report]   prueft die Einrichtung, aendert nichts; Klartext, Exit 0 nur bei "alles bereit" (Issue #1777).
      --report legt zusaetzlich einen Bericht fuer den Support als Datei ab, meist unter .claude/doctor/ (Issue #1893).
      doctor und update sind Pro-Teile: in Community die Pro-Meldung wie edition gate und Exit 3 (Issue #2014).
  node board.mjs update check   vergleicht die Kopie mit der veroeffentlichten Fassung; JSON { ok, installiert,
      veroeffentlicht, veraltet, hinweis? }, wartet hoechstens 5 s, Exit 0 auch ohne Netz (Issue #1845).
  node board.mjs update run [--edition community|pro]   bringt das Projekt auf die veroeffentlichte Fassung: startet
      deren Installer ohne Rueckfragen; endet ohne Aenderung im Kit-Repo, bei laufendem Runner und ohne Config
      (Issue #1850). Geholt wird die installierte Ausgabe, unter 6.0.0 Community; --edition waehlt sie
      ausdruecklich. Pro kommt mit KIT_PRO_TOKEN oder ueber ein angemeldetes gh (Issue #1926).
  node board.mjs update all   aktualisiert alle Projekte der Projektliste des Rechners wie update run; streicht
      fehlende Ordner, ueberspringt Projekte mit laufendem Runner, Exit 1, wenn eines fehlschlug (Issue #1851).
  node board.mjs release state | target | check-return-point [--version <v>]
  node board.mjs release checkout-return-point --commit <sha>
  node board.mjs release record-rollback --to <v> --success true|false [--from <v>] [--duration-ms <n>]
  node board.mjs release record-hotfix --version <v> --fix-commit <sha> [--issue <n>] [--deferred <pruefung>]... [--durations <json>] [--reason <satz>]
  node board.mjs release pending [--range <bereich>] | verified --version <v>
  node board.mjs release attach-card --version <v> --issue <n>
      Der Produktionsstand in refs/kit/produktion fuer Hotfix und Zurueckkehren (Issue #2053, Plan #2038 A5), je JSON.
      state: laufende Version, naechste Hotfix-Version, offene Hotfixes, Hotfixes ohne Karte, Zurueckkehren seit der
      Auslieferung. target: laufende Version und Vorversion. check-return-point: Rueckkehrpunkt der laufenden oder der
      genannten Version, Exit 0 auch ohne; halt: ob merge production anhaelt (nie bei runsInstance: false).
      checkout-return-point: legt einen unveraenderten Checkout des ausgelieferten Commits an (nur quelle.commit
      aus check-return-point), JSON { verzeichnis, commit, ref }; dort laufen die Befehle des Zurueckkehrens.
      pending: Hotfixes ohne Zeile Hotfix: im Bereich (Vorgabe origin/<mainBranch>..HEAD).
      verified: Hotfix nachgeprueft; attach-card: Karte eines Hotfix ohne Board (E10), --reason dessen Fehler in einem
      Satz. Pro-Teil: in Community die
      Pro-Meldung wie edition gate hotfix bzw. rollback und Exit 3.
  node board.mjs pro run <effort|effectiveness|findings> -- <argumente>   startet die Auswertung (Community,
      Issue #2012), stdout, stderr und Exit-Code unveraendert; fehlt ihre Datei, eine Zeile "<Auswertung>: nicht
      installiert" und Exit 0 (Issue #1855, Plan #1853 E2).
  node board.mjs pro list   JSON: welche Pro-Teile neben board.mjs liegen; settings und deployment gesondert.
      Die Auswertungen sind keine Pro-Teile und stehen nicht darin.
  node board.mjs config strictness   JSON { strenge, vorgaben, abweichungen, zeile }: die Strenge des Projekts (leicht |
      normal | streng), die wirksamen Schalter aus strengeVorgaben, wo das Projekt abweicht, und die Anzeigezeile
      in der Projektsprache (Issue #2110, Plan #2102 A12, A16). Nur lesend.
  node board.mjs edition show   JSON { ausgabe, version, uebergangen, zeile }: die Ausgabe der Installation (community | pro),
      die Version des Kits (Issue #2014) und in Community die uebergangenen Pro-Einstellungen mit englischem Namen
      (Issue #1867, Plan #1866 E4).
  node board.mjs edition gate <app|doctor|update|hotfix|rollback>   in Community die Pro-Meldung auf stdout und Exit 3, in Pro still mit
      Exit 0. Runner, Kette, Prueflauf und die Vorbereitung von push main haben kein Tor (Issue #2012).
  node board.mjs app projects [--root <pfad>] [--settings <pfad>]   JSON: die Projekte fuer die Projektauswahl der
      Desktop-App, mit --root die Suche der Einstellungs-Oberflaeche, sonst die Projektliste des Rechners (Issue #1898,
      Plan #1895 E3). --settings nennt die settings.mjs fuer die Suche, wenn neben dem Kit keine liegt (Issue #1994).
  node board.mjs app session-args   JSON: die Rechte der Gespraechssitzungen der App, permissionArgs(false) (E2).
  node board.mjs app inbox   JSON: der Eingang der App — wartet (Karten mit Label klaeren, Fachplaene mit offener
      Frage, Pakete im Backlog mit geprueftem Plan, Commits vor push main und merge production), fachplaene und
      ideen mit ihrem Stand; Labelnamen in der Projektsprache (Issue #1899, Plan #1895 E4), dazu das Pruef-Label
      und die Trigger fuer push main und merge production (Issue #1911); kartenAdresse ist die Adresse einer Karte
      am Board mit dem Platzhalter {nummer}, sonst null (Issue #2031); prioritaeten ordnet jeder Kartennummer,
      auch in Done, ihre Prioritaet { name, stufe } nach app.priorities zu (Issue #2073).
  node board.mjs app run-status   JSON: der Laufstand der App — laeuft (ein Runner lebt), laeufe (die letzten fuenf
      Laeufe aus Journal und Puls je { lauf, art, lebt, karten: [{ id, titel, stufe, ausgang }], beginn, ende,
      protokoll, kostenUsd, angehalten }, der juengste zuerst; kostenUsd aus dem Ergebnisstand, angehalten am
      Kostenbudget oder mit abgebrochener Karte, Issue #1957) und board (Karten mit Label run:*) (Issue #1900,
      Plan #1895 E11).
  node board.mjs app outgoing --to <main|production>   JSON: was mit push main (origin/<main>..<main>) oder merge
      production (<production>..<main>) hinausgeht — commits je { sha, titel, pakete }, pakete aus den Zeilen
      Issue #N und ci, der Pruefstand aus code ci-status (Issue #1902, Plan #1895 A8); jeder rote Schritt
      in ci.jobs traegt aufgaben (Pakete im geprueften Stand) und naechsterSchritt ki|mensch (Issue #1944).
  node board.mjs app settings-commit   JSON: committet genau .claude/workflow.config.json mit der Nachricht
      "Einstellungen übernommen (App)" auf den aktuellen Zweig, ohne Push; ohne Aenderung kein Commit (E9).
  node board.mjs app version   JSON: die veroeffentlichte App-Fassung aus dem Asset app.json des juengsten
      Releases von PRO_REPO, { ok: true, version, url } mit dem Paket der laufenden Plattform oder
      { ok: false, grund }; ohne Zugang oder ohne Asset app.json grund "nicht-pruefbar" mit meldung
      (Issue #1903, #1928, Plan #1918 E16).
  node board.mjs app brand   JSON: die Marke der App aus app.brand — name, logo (data-URL, hoechstens 512 KB, sonst
      null mit Hinweis), akzent, akzentDunkel —, veroeffentlichen { team, betrieb } aus app.publish, leitstand aus
      app.controlCenterUrl und hinweise (Issue #1941, Plan #1939 E3).
  node board.mjs app team   JSON: rahmen je Start (durchlauf, umsetzung, gleichErledigen) mit zeitMin und kostenUsd,
      pruefer aus issueReview.reviewers und pruefungen aus buildChecks (Issue #1941); prioritaeten ist die wirksame
      Liste aus app.priorities, sonst die Vorgabe (Issue #2073).
      Die Achse ist der Pro-Teil app; fehlt er, die Pro-Meldung wie edition gate app und Exit 3.
 */

import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "6.1.0";

// Die Hilfe gibt es je Kommando genau einmal, englisch, in jedem Projekt (Issue #1557, Plan
// #1548 E7). Sie antwortet, bevor ein Teil geladen ist (Plan #1199, E2).
const HELP = `board.mjs — board adapter for the claude-workflow-kit

Usage:
  node board.mjs issue create --title "..." --body "..." | --body-file <path> | --body -
                             [--author-model <model>] [--derived-from <number>]
                             [--idempotency-key <value>] [--art requirement|plan|idea|human|task]
      --art puts the English title prefix of the kind in front, such
      as '[Requirement]' (Issue #1427). A title with a prefix stays
      valid; --art next to it is an error. Without --art the title stays as it is.
      --derived-from carries the card number of the nearest ancestor to the board
      (Issue #356). Only kanbancompat evaluates it; the other trackers accept it
      without effect. It cannot be added later — it only works on creation.
      --idempotency-key repeats a call whose outcome stayed unclear without running
      it a second time (Issue #834). Without the switch the key is made per call; the
      error message names it together with the command.
      If the body has a section '## Dependencies', the output carries its 'hinweise'
      as with 'check-form' (Issue #1060); they do not affect the creation.
      A requirement (--art requirement or its title prefix) without a complete
      scenario fails gate F12 as with 'check-form --body-file': nothing is created,
      the message names what is missing, exit 1 (Issue #1590).
  node board.mjs issue get <id>
  node board.mjs issue activity <id>      activity history (local, toolbox)
  node board.mjs issue activity --ids <n,n,...>
      History of several cards as an object {"<number>": [...]}. Resolves the card
      list exactly once; an unknown number appears with its error reason (Issue #786).
  node board.mjs issue list [--status <status>]
  node board.mjs issue move <id> <status>
  node board.mjs issue update <id> --body "..." | --body-file <path> | --body -
      Output { ok, id }, plus 'hinweise' on the section '## Dependencies' as with
      'issue create' (Issue #1060).
  node board.mjs issue comment <id> --text "..." | --text-file <path> | --text -
                             [--idempotency-key <value>]
      '-' reads from stdin, good for short texts; for long ones '--text-file' (Issue #584).
      --idempotency-key as with 'issue create' (Issue #834).
  node board.mjs issue report <id> --text '<report>' | --text-file <path> [--without-commit '<reason>']
  node board.mjs issue report <id> --part <n> --text '<piece>'
  node board.mjs issue report <id> [--without-commit '<reason>'] [--no-move]
      Files the completion report and then moves the card to In review (Issue #1022).
      The report gets a run stamp line as its last line (the card's latest move to
      in_progress from .claude/bewegungen.tsv). Idempotent per run: same content ->
      nothing written, changed -> replaced, reports of other runs stay. A ' in the
      report is written in the shell as '\\''.
      --part <n> only writes piece n to .claude/berichte/<id>.<n>.md (no board); the
      call without --text joins the pieces in numeric order, completes and only then
      clears them. If it fails, the retry is the same call.
      It only moves the card if a commit since the move to in_progress names
      "Issue #<N>" (Issue #1584); [Human] cards are exempt. --without-commit '<reason>'
      reports without a commit, the reason stands as a line in the report.
      --no-move (Issue #1786) files the report without moving the card; run stamp
      and commit search then refer to the commit in KIT_PACKAGE_BASE (start of the
      package worktree), the commit is the latest in <base>..HEAD naming "Issue #<N>".
      Without KIT_PACKAGE_BASE it aborts. Output then carries bewegt: false
      instead of status.
      Output: { ok, id, bericht: angelegt|ersetzt|unveraendert, status: in_review,
               commit: <short hash>|ohne|mensch }.
  node board.mjs issue run-state <id> --state running|aborted|waiting|done --text-file <path>
      Run status of a card in one go (Issue #1083): sets the label of the state and
      removes the other two (done: all three), plus exactly one run status
      comment, replaced on every call. The label names come from
      night.stand.labels in the config. Comments are read strictly; unreadable ->
      exit 1, nothing written. Output: { ok, id, zustand, kommentar: angelegt|ersetzt|unveraendert }.
  node board.mjs issue brief <id> [--column ready|in_progress] [--json]
      Everything an implementation needs before it starts, in one call (Issue #1023):
      verdict (may start | may not start) with consequence (beginnen | bleibt |
      backlog with the literal comment text | geschuetzt: the package names a
      protected file and is not released — backlog, label add kit:protected, then
      the halt comment from issue check-protected plus label line; the label
      kit:protected itself results in backlog, Issue #1052), task (title, body,
      labels, column, comments), plan decisions verbatim (selection from the line
      'Plan-Decisions:', without it all of them), business reason (goal and business
      acceptance criteria of the 'Requirement:'), siblings of the plan with column
      (Issue #1024) and prerequisites from '## Dependencies' (met from In review on).
      What cannot be determined is listed under gaps. Read-only. --column in_progress
      expects the card in In progress instead of Ready.
      Output: Markdown with seven '##' parts -- the only exception to JSON on stdout;
      --json returns the same parts as fields. Exit 0 also on 'may not start', exit 1
      only if the package is not readable.
  node board.mjs issue origin <plan>
      State of the origin documents of a plan (Issue #1285, Plan #1283): done means at
      least one package ('Plan: Issue #M') is in In review or Done and none in Backlog,
      Ready or In progress. Per document (plan, requirement from 'Requirement:') the
      action wandert | lag bereits in In review | lag bereits in Done | bleibt, with a
      reason. Read-only, moves nothing. Output: { plan, durch, grund, fehlend: [{ id,
      titel, spalte }], dokumente: [{ id, art, spalte, aktion, grund }] }.
  node board.mjs issue history [--terms <term>]... [--files <path>]... [--without <number>]... [--bodies]
      Earlier requirements of the own board, archived ones included (Issue #1539, Plan
      #1534): per term via the search (only titles with [Requirement]), per file via the
      card numbers of the last 30 commits and their lineage. Merged by number, ordered by
      the number of matched terms, then number descending, at most 20. Output: { ok,
      suchbegriffe, dateien, treffer: [{ nummer, titel, archiviert, weg, auszug }],
      weitere }; --bodies adds the body of each hit. Without archive { ok: false, grund:
      archiv-nicht-erreichbar | tracker-ohne-suche | abgeschaltet }, exit 0 even then; the
      first failure at the board ends the search.
  node board.mjs issue questions <id> [--body-file <path>] [--compare <path>]
      Grooming state of a requirement for /groom (Issue #1513, Plan #1510): einstieg
      ({ start, grund, meldung }), fragen ({ vermerk, fragen, ungegliedert, offen }),
      stoppKommentar (only with kit:clarify: { kommentar, grund }, otherwise null) and
      vermerkVorschlag (the note 'Keine' with today's date, only without an open
      question). --body-file checks a new body against the card's (pruefung: { ok,
      verstoesse }), exit 1 on violations. --compare lists the changed criteria and
      non-goals between the file and the card's body (aenderungen).
      Read-only: changes neither body nor labels.
  node board.mjs issue triage <id> [--body-file <path>]
      State of an idea for /triage (Issue #1628, Plan #1623): einstieg ({ start, grund,
      meldung }; grund keine-idee or unbeaufsichtigt), ablage ({ pfad, vorhanden, dateien:
      [{ name, gelesen, vorlageZiel, herkunft }] } for .claude/ideas/<id>/) and stand
      ({ punkte, offen, bahn, vorlage, ergebnis } from '## Clarified state', ergebnis from
      the 'Result:' line or a comment 'Fortsetzung: ...'). --body-file checks a new body
      against the card's (pruefung: { ok, verstoesse }), exit 1 if the text of the idea
      changed or a confirmed point lost its answer line. Never changes the card. On a
      kanban-kit card without --body-file and --finish, and only with start: true, it first
      loads the card's attachments into .claude/ideas/<id>/ (Issue #1681): a file already
      there stays unchanged; ablage.anhaenge ({ geladen, vorhanden, fehlgeschlagen: [{ name,
      grund, meldung }], fehler }) reports it, herkunft is karte or ablage. Other trackers
      never create the folder, and ablage.anhaenge is missing.
  node board.mjs issue triage <id> --finish [--template <file>]
      Closes the attachments folder of an idea once the chosen path has begun (Issue #1629,
      Plan #1623 A13, E2): --template first moves that file from .claude/ideas/<id>/ to
      design/ideas/<id>/<file>, then the folder is deleted. abschluss: { ok, pfad,
      geloescht, vorlage, meldung }. Exit 1 if einstieg says start: false or the template
      is not a file in the folder; then nothing is moved or deleted. Never touches the card.
  node board.mjs issue label add <id> <name>
  node board.mjs issue label remove <id> <name>
      Marks an issue (e.g. kit:clarify). Status labels are changed by \`issue move\`.
  node board.mjs issue repair --summary <file> | --ci <sha> [--author-model <model>]
      Repair cards from a red check run (Issue #2092, Plan #2087 A7, A8): per red check
      and plan one [Task] card in Backlog with the line 'Repair: <cmd>' and every finding
      verbatim; an existing card of the same check and plan gets a comment, and from In
      review also the move back to Backlog. A finding in the environment becomes no card
      but a manual step. --ci <sha> reads the findings from the log of the red jobs of
      the build service for this commit instead of a summary (Issue #2094, A5); a red job
      without a check line becomes a manual step. --summary and --ci together: exit 1.
      Output: { angelegt, kommentiert, zurueck, handgriffe }.
  node board.mjs issue hold <id> --reason "<reason>"
  node board.mjs issue hold <id> --lift
      Wait of a requirement for an external event (Issue #1662, Plan #1624 E2 to E4):
      --reason writes or replaces the line 'Waiting for event: <reason>' in '## Goal' and
      sets kit:on-hold, --lift removes every such line there and takes the label off. Only
      for requirements; a plan or a work package is rejected with exit 1. Never touches
      kit:clarify or the open questions to the PO. If the label is missing on the board,
      the line is written anyway: label null, labelFehler with the adapter's message,
      exit 0. Output { ok, id, wartet: <reason> | null, label: "gesetzt" | "abgenommen" |
      null, labelFehler }. The kit never calls --lift itself.
  node board.mjs issue check-form <id> [--art requirement|plan|idea|human|task]
  node board.mjs issue check-form --body-file <path> --title "<titel>" [--art ...]
      Form check against the machine gates of the stage (Issue #628): requirement
      F1 F2 F6 F7 F9 F11 F12, plan P1 P2 P3 P6 P12, work package I1 to I9. The stage comes
      from the title prefix, with --art from the kind as with 'issue create'
      (Issue #1427); --art next to a title with a prefix rejects the call. I7 to I9
      (Issue #1044): '## Task' names a file as a backtick path, no named file is
      protected (locks from the settings of the project root), '## Task' does not name
      the installed copy; a [Human] package passes all three. Always JSON ({ ok, stufe,
      verstoesse }), exit 1 on violations; a rejected call carries 'fehler'. Never
      writes to the board.
      F12 (Issue #1590): the section '## Scenarios' stands between the acceptance
      criteria and the non-goals and holds at least one complete scenario. It applies
      to --body-file always, to <id> only from 'scenariosFrom' on; without that field
      a hint { art: "szenarien-stichtag", meldung } instead.
      For [Plan] additionally 'hinweise' ([{ baustein, test, meldung }], Issue #1031):
      own tests of listed building blocks that the plan does not name, by the
      locations from 'testAblagen' against 'git ls-files'; they affect neither ok nor
      the exit code.
      For a work package 'hinweise' on the section '## Dependencies' ([{ art, nummer,
      stelle, meldung }], Issue #1060): 'schreibweise' per #N outside a reference line
      ('Issue #N' at the start of the line), 'dokument' per #N to a [Plan], [Requirement]
      or [Idea] card. The runner reads both as a dependency; they too affect neither
      ok nor the exit code. A card that cannot be looked up stays silent.
  node board.mjs issue check-protected <id> [--path <path>]
      Protected files of a package (Issue #1045, Plan #987): hits from task and
      acceptance criteria against the locks of the project root; --path (also
      repeated, Issue #1053) adds a path rejected on writing, if it is protected, with
      the line 'beim Schreiben abgewiesen' — for the fallback halt when the task does
      not name it. Plus the label kit:protected and the release — a halt comment
      '## Geschuetzte Datei' with the line 'Label kit:protected gesetzt', the label
      removed and every hit named there. Output: { ok, treffer, label, freigegeben,
      handlung, kommentar }; 'kommentar' is the halt text without the label line.
      Exit 1 on ok false, also for a label without hits. Read-only.
  node board.mjs code repo-name
  node board.mjs code pr --from <branch> --to <branch>
  node board.mjs code merge-pr --number <n> --head <sha>
      Merges pull request <n> (GitLab: merge request) at once, without auto-merge
      (Issue #2054), and only while its head is the checked commit <sha> (full SHA,
      Issue #2084). Output: { ok: true, number, commit } with the merge commit; a
      failed merge or a PR not merged afterwards gives { ok: false, number, grund } and
      exit 1. A codeHost without pull requests aborts like code pr.
  node board.mjs code ci-status --commit <sha> [--branch <branch>] [--check-branches]
      State of the CI for exactly this commit (Issue #316):
      { status: gruen|rot|laeuft|keine, adresse, jobs: [{ name, ergebnis, gestartet, id }] }.
      'ergebnis' is gruen|rot|laeuft|uebersprungen; uebersprungen counts like gruen
      for the verdict (Issue #2230).
      Precedence rot over laeuft over gruen; 'keine' only with codeHost local, a run
      not yet visible at the host is 'laeuft'. 'gestartet' is the start time of the
      job (ISO) or null as long as it has not started (Issue #1151). --branch counts
      only the runs of that branch; 'adresse' is the page of the run at the code host
      (of the red one among several), null without a run; 'id' identifies the job's
      log at the host (Issue #1972). A short id is resolved to the full one in the
      repository; an unknown id ends with exit 1 instead of 'laeuft' (Issue #2132).
      --check-branches counts only the runs of the check branches
      <pushCheck.branch> and <pushCheck.branch>-* (default kit-pruefung), so a
      measurement on main does not count (Issue #2247); without pushCheck as an
      object with location buildService it is an error.
  node board.mjs code ci-wait --commit <sha> --timeout-min <n> [--branch <branch>] [--check-branches]
      Waits for the verdict of the build service and always ends (Issue #2132):
      { commit, ergebnis, schritt, status, adresse, jobs, wartezeitMs }. ergebnis is
      gruen|rot, keine without a build service, 'kein Lauf' when no run is visible
      after 5 minutes, frist after <n> minutes with the step reached in schritt
      (suche|laeuft|urteil). Short ids are resolved to the full one like ci-status;
      an unknown id ends with exit 1. --branch and --check-branches filter like
      in ci-status. KIT_CI_WAIT_FRIST_LAUF_MS and
      KIT_CI_WAIT_TAKT_MS shorten the deadline and the poll interval for tests.
  node board.mjs code contract-repo <name>
      Built state of the partner repo <name> from vertragsRepos (Issue #1615):
      git ls-remote on its branch (default main), then a shallow clone to
      <tmpdir>/kit-contract-repos/<name>-<commit12>, cached per commit; older states
      of the same name are removed. Output: { ok: true, name, url, branch, commit,
      date, path }, on failure { ok: false, name, reason }, exit 0 in both cases.
      An unknown name aborts with the known names.
  node board.mjs code protection status
  node board.mjs code protection setup --branch <b>
  node board.mjs code protection suspend --in <path>
  node board.mjs code protection restore
  node board.mjs code protection verify [--branch <b>]
      Protection of main and publishing branch by ruleset (Issue #1408).
      status: { geschuetzt, fehlt, ungeprueft }, exit 0 also on geschuetzt false.
      setup: probe — the head of origin/<mainBranch> goes to the check branch
      (default pushPruefung.zweig, otherwise kit-pruefung; an existing one aborts),
      waits in 30 s steps up to 5 min for the run and 60 min for its completion,
      branch deleted afterwards. Result scharf | offen | anleitung | nicht moeglich.
      suspend: emergency path, only after a green run of stage push in the worktree
      <path>; sets the ruleset of the main branch to disabled. restore: active again,
      if it fails exit 1 with the command to repeat. verify: head again to the check
      branch, result of the build service. setup, suspend, verify are locked with
      KIT_AGENT_MODEL.
  node board.mjs context paths [--project <name>] [--date YYYY-MM-DD]
  node board.mjs context last-log [--project <name>] [--before YYYY-MM-DD]
  node board.mjs issue-review reviewers --author <model>
  node board.mjs issue-review check [--path-only]
      The read boundary per reviewer; kind command without it is not available
      ('keine Lesegrenze'). 'rollen' names the missing role files of all stages.
  node board.mjs issue-review matrix
  node board.mjs issue-review roles --stage <requirement|plan|issue> --author <model>
      'rollenDateien' names pfad and rolleVorhanden per role.
      Cast and roles of the stage from reviewStufen; the author drops out.
      With --stage plan, KIT_PLAN_REVIEWER (1 or 2) sets the reviewer count ahead of reviewStufen.
  node board.mjs issue-review review-brief --role <role> --file <target> (--id <N> | --material-file <path> [--source-ref <commit>])
      Review brief for a reviewer, not the implementation brief of 'issue brief <id>'.
      Puts kit/rollen/<role>.md with the list of kinds and the document (--id: from
      the board, with 'Requirement:' and 'Template:') or material (--material-file;
      for code-review with .claude/checks-summary.json) into the file --file. Output
      { ok, rolle, datei, zeichen }; errors (exit 1) rolle-fehlt with pfad,
      platzhalter-offen, material-fehlt, dokument-nicht-lesbar. --role more than once:
      one part per role after '--- ROLLE <name> ---', output with rollen (Issue #1869).
      --source-ref: blob sources from the tree of this commit instead of the working
      tree; an unknown commit is an error, no file is written (Issue #2181).
  node board.mjs issue-review start --reviewer <name> | --code-review --brief <file> --output <file> [--timeout-min <n>]
      --timeout-min: stops it after n minutes, answer fehler zeitgrenze without output file (Issue #1991).
  node board.mjs issue-review security-result --file <answer> --base <anchor> [--cards]
      Evaluates the answer of the security check (Issue #1992): JSON { ergebnis gruen|kritisch|ausfall,
      befunde }; KRITISCH/WICHTIG without attacker, boundary or consequence becomes HINWEIS. --cards creates
      one [Task] card in the backlog per KRITISCH/WICHTIG finding or comments on the open one with that title.
  node board.mjs issue-review review-result --file <answer>
      Evaluates the answer of the code-review role, the review made up after a hotfix (Issue #2055):
      JSON { ergebnis ok|kritisch|ausfall, befunde }; a KRITISCH finding stops.
      Starts an outside reviewer (kind command; --code-review: reviewCommand) without
      a shell: brief via stdin, stdout into --output. The read boundary is the last
      argument — from lesegrenze or reviewLesegrenze, otherwise from the table (codex:
      --sandbox read-only). Needs 'node .claude/kit/board.mjs*' in
      sandbox.excludedCommands. Output { ok, reviewer, lesegrenze, ausgabe, zeichen };
      errors (exit 1) keine-lesegrenze, lesegrenze-aufgehoben with schalter
      (--full-auto, --dangerously-bypass-approvals-and-sandbox, --sandbox/-s except
      read-only, -c sandbox_mode, --profile/-p), auftrag-fehlt, nicht-im-path, ausfall
      with exit and an excerpt of stderr.
  node board.mjs nightrun report --file <result.json>
      Delivers a result state of the runner to POST /api/kanban/night-runs
      (issueTracker toolbox only); the same run is replaced on every report. If the
      state carries a preparation of the release, the report carries
      releasePreparation; if the board rejects it with HTTP 400, the command reports
      exactly once more without the field and notes the fallback in the answer
      ('rueckfall').
  node board.mjs session report [--transcript <path>] [--complete]
      Reports the usage of the running interactive session to the same route
      (kind/mode INTERACTIVE, Issue #734), split by the waypoints from
      .claude/wegmarken.tsv. Without --transcript the path comes as 'transcript_path'
      from the hook body on stdin. --complete reports the end of the session and
      clears the waypoints; without the flag it reports at most every five minutes.
      Stays silent without error when KIT_AGENT_MODEL is set (the runner
      reports itself) and without a toolbox token.
  node board.mjs hook bash-check
      PreToolUse hook for Bash (Issue #995): reads the hook body of Claude Code on
      stdin and rejects with exit 2 when a pipe, redirection or a further command
      takes the exception away from a command in sandbox.excludedCommands. Patterns
      from .claude/settings.json and .claude/settings.local.json.
  node board.mjs hook write-check
      PreToolUse hook for Edit, Write and NotebookEdit (Issue #1740): rejects with
      exit 2 when file_path (or notebook_path) matches an Edit(...)/Write(...) rule
      under permissions.deny in .claude/settings.json or .claude/settings.local.json,
      absolute or relative to the project root, regardless of the permission mode.

  node board.mjs scenarios baseline
      The cut-off for the scenario duty (Issue #1591, Plan #1588 E3): lists every
      card without a status once and prints { ab: <highest number + 1> }, numeric
      also for the padded numbers of the local tracker. Writes nothing; the
      installer enters the value as 'scenariosFrom' when the field is missing.

  node board.mjs names
      The fixed lines of the skills in the project language (Issue #1558, Plan #1548):
      headings, markers, review and incorporation heads. Output: { language, lines:
      { "<German line>": "<line in the project language>" }, contract: { "<key>":
      "<word>" } } from the registers MARKER and UEBERSCHRIFTEN; a heading is listed
      with '## ' in front. 'contract' holds the fixed words of a contract entry in a
      plan from the table VERTRAG (Issue #1612). Read-only.

  node board.mjs doctor [--report]   checks the setup, changes nothing; plain text, exit 0 only when all set (Issue #1777).
      --report also saves a report for support as a file, usually under .claude/doctor/ (Issue #1893).
      doctor and update are pro parts: in Community the pro message like edition gate and exit 3 (Issue #2014).

  node board.mjs update check   compares the copy with the published version; JSON { ok, installiert,
      veroeffentlicht, veraltet, hinweis? }, waits at most 5 s, exit 0 even without network (Issue #1845).

  node board.mjs update run [--edition community|pro]   brings the project to the published version: starts
      its installer without questions; ends without change in the kit repo, with a running runner and without
      config (Issue #1850). It fetches the installed edition, Community below 6.0.0; --edition chooses it
      explicitly. Pro comes with KIT_PRO_TOKEN or through a signed-in gh (Issue #1926).

  node board.mjs update all   updates every project in this computer's project list like update run; removes
      missing folders, skips projects with a running runner, exit 1 if one failed (Issue #1851).

  node board.mjs release state | target | check-return-point [--version <v>]
  node board.mjs release checkout-return-point --commit <sha>
  node board.mjs release record-rollback --to <v> --success true|false [--from <v>] [--duration-ms <n>]
  node board.mjs release record-hotfix --version <v> --fix-commit <sha> [--issue <n>] [--deferred <check>]... [--durations <json>] [--reason <sentence>]
  node board.mjs release pending [--range <range>] | verified --version <v>
  node board.mjs release attach-card --version <v> --issue <n>
      The production state in refs/kit/produktion for hotfix and rollback (Issue #2053, Plan #2038 A5), JSON each.
      state: running version, next hotfix version, open hotfixes, hotfixes without a card, rollbacks since the last
      delivery. target: running version and previous version. check-return-point: return point of the running or the
      named version, exit 0 also without one; halt: whether merge production stops (never with runsInstance: false).
      checkout-return-point: creates an unchanged checkout of the delivered commit (only quelle.commit from
      check-return-point), JSON { verzeichnis, commit, ref }; the rollback commands run there.
      pending: hotfixes without a line Hotfix: in the range (default
      origin/<mainBranch>..HEAD). verified: hotfix rechecked; attach-card: card of a hotfix made without the board
      (E10), --reason its error in one sentence. Pro part: in Community the pro message like edition gate hotfix or rollback and exit 3.

  node board.mjs pro run <effort|effectiveness|findings> -- <arguments>
      Starts the evaluation (Community, Issue #2012) with inherited stdout and stderr and passes its
      exit code on unchanged. If its file is missing, exactly one line "<evaluation>: not installed"
      and exit 0 (Issue #1855, Plan #1853 E2). Any other name ends with exit 1 and names the allowed ones.

  node board.mjs pro list   JSON: which pro parts lie next to board.mjs; settings and deployment
      appear separately as not installable (installiert: false). The evaluations are not pro parts
      and do not appear in it.

  node board.mjs config strictness   JSON { strenge, vorgaben, abweichungen, zeile }: the strictness of the
      project (leicht | normal | streng), the effective switches from strengeVorgaben (pushUmfang, mutation,
      guete, sicherheit, pruefer, auslieferungNachholen), where the project deviates from them, and the
      display line in the project language, such as 'Strictness: Light' (Issue #2110, Plan #2102 A12, A16).
      Read-only; skills and the session start read it instead of interpreting the strictness themselves.

  node board.mjs edition show   JSON { ausgabe, version, uebergangen, zeile }: the edition of the installation
      (community | pro), the version of the kit (Issue #2014) and, in Community only, the pro
      settings passed over, with their English names; 'zeile' is the line naming them, null
      without any (Issue #1867, Plan #1866 E4).

  node board.mjs edition gate <app|doctor|update|hotfix|rollback>
      The gate of the scripts in front of a pro function: in Community the pro message on stdout
      and exit 3, in Pro silent with exit 0. Any other function ends with exit 1. The runner, the
      chain, the check run and preparing push main have no gate (Issue #2012).

  node board.mjs app projects [--root <path>] [--settings <path>]
      JSON for the project picker of the desktop app: with --root the folder and its direct
      subfolders that carry a config, as in the settings UI; without it this computer's project
      list with the parent folders of its projects (Issue #1898, Plan #1895 E3). --settings names
      the settings.mjs for the search when none lies next to the kit (Issue #1994).

  node board.mjs app session-args
      JSON array: the permission arguments of the app's conversation sessions, the same as the
      runner's sessions without yolo (Plan #1895 E2).

  node board.mjs app inbox
      JSON for the app's inbox (Plan #1895 E4): 'wartet' lists cards with the clarify label,
      requirements with an open question, packages in Backlog whose plan carries Plan-Review:,
      and the commits ahead of push main (origin/<main>..<main>) and merge production
      (<production>..<main>); 'fachplaene' and 'ideen' list the open requirements and ideas
      with their state. Label names follow the project language (Issue #1899); 'labels.pruefen'
      and 'triggers' give the check label and the push and merge phrases (Issue #1911);
      'kartenAdresse' is the address of a card on the board with the placeholder {nummer},
      otherwise null (Issue #2031); 'prioritaeten' maps every card number, also in Done, to its
      priority { name, stufe } after app.priorities (Issue #2073).

  node board.mjs app run-status
      JSON for the app's run view (Plan #1895 E11): 'laeuft' says whether a runner is alive,
      'laeufe' lists the last five runs from journal and pulse under .claude/lauf/, newest first,
      each as { lauf, art, lebt, karten: [{ id, titel, stufe, ausgang }], beginn, ende,
      protokoll, kostenUsd, angehalten }; a run without a live pulse is not alive. 'kostenUsd' is the
      usage from the run's result file, 'angehalten' marks a run that is no longer alive and stopped at
      its cost budget or with an aborted card (Issue #1957). 'board' lists the cards carrying a
      run state label (run:*) with their state (Issue #1900).

  node board.mjs app outgoing --to <main|production>
      JSON for the step before push main and merge production (Plan #1895 A8): the commits that go
      out (origin/<main>..<main> or <production>..<main>), newest first, each with the packages
      from its lines Issue #N, the packages with their commits, and 'ci', the check state of the
      build service from code ci-status (before the push of origin/<main>, before the merge of
      the head of <main>). Every red step in ci.jobs carries 'aufgaben' (the packages with a commit
      in the checked state) and 'naechsterSchritt': ki while a live run works on one of them, else
      mensch (Issue #1944). Any other target ends with exit 1 (Issue #1902).

  node board.mjs app settings-commit
      Commits exactly .claude/workflow.config.json with the message "Einstellungen übernommen
      (App)" on the current branch, without pushing; other changes and the personal layer
      .claude/workflow.config.local.json stay untouched. Without a change no commit, and the
      JSON says there is nothing to commit (Plan #1895 E9).

  node board.mjs app version
      JSON with the published app version from the asset app.json of the latest release of
      PRO_REPO (Plan #1918 E16): { ok: true, version, url } with the package of the running
      platform, otherwise { ok: false, grund }; without access or without the asset app.json
      grund "nicht-pruefbar" with a meldung (Issue #1903, #1928).

  node board.mjs app brand
      JSON with the customer brand from app.brand: name, logo as a data URL (at most 512 KB;
      otherwise null with a hint), akzent and akzentDunkel, the sentences veroeffentlichen
      { team, betrieb } from app.publish, leitstand from app.controlCenterUrl and hinweise
      (Issue #1941).

  node board.mjs app team
      JSON with the frame per start, rahmen: durchlauf (night.chain.implementationMin, costs
      per chain target), umsetzung (night.implementationNightMin, night.implementationCostUsd)
      and gleichErledigen (app.quickFix), each with zeitMin and kostenUsd; pruefer from
      issueReview.reviewers and pruefungen from buildChecks (Issue #1941); prioritaeten is the
      effective list from app.priorities, otherwise the default (Issue #2073).
      The app axis is the pro part app. Without it every app command prints the pro message
      like edition gate app and ends with exit 3.

  node board.mjs --version

Valid status values: backlog | ready | in_progress | in_review | done

Configuration: .claude/workflow.config.json (issueTracker, codeHost)
For the context axis additionally: ~/.claude/kontext.config.json and
.claude/kontext.config.json (merged, local fields win).
For GitHub board integration: set github.projectNumber in the config. If it is
missing and the owner has exactly one GitHub Project, its number is used.
`;

// Die Texttabelle liegt im Teil texte/ (Issue #1524) und laedt mit den uebrigen Teilen weiter
// unten. Die Hilfe steht nicht darin: Sie antwortet, bevor ein Teil geladen ist.

// Auskunft vor den Teilen (Plan #1199, E2): --version und --help antworten, bevor ein Teil
// geladen ist. Nur so beantwortet board.mjs sie auch als einzeln kopierte Datei, ohne
// kit/board/ daneben (Issue #170) — und genau dort fragt man danach.
const runAsCli = alsCliGestartet();
if (runAsCli) auskunftOhneTeile(process.argv.slice(2));

// Die Teile, mit literalem dynamischem Import und nie als `export { … } from`: Das liesse den
// Teil vor der ersten Codezeile laden. Was bisher exportiert war, bleibt unter demselben
// Namen exportiert.
export const { VALID_STATUSES, COLUMN_DEFAULTS, columnLabels, isStateColumn, exec, execJSON,
  gitRemoteUrl, normalizeRepoName, RUECKMELDUNG, BoardError, fail, out, sleep,
  mergeWorkflowConfig, configWurzel, readWorkflowConfig, loadConfig, labelNamesFrom,
  labelMapFrom, withLabels, normalizeComments, createdFrom, labelToStatus, findeImPath,
  umgebungsWert } = await import("./board/grundlagen.mjs");
export const { TOOLBOX_UEBERLAST_TYPE, TOOLBOX_BUDGET_NACHT_MS, toolboxBudgetMs, toolboxVersuchMs,
  proxyNeustartNoetig, proxyGesetzt, PROXY_HINWEIS, netzfehlerArt, darfWiederholen, rueckmeldungFuer,
  wartezeitMs, VERLAUF_GLEICHZEITIG, hoechstensGleichzeitig, wiederholKommando } = await import("./board/wiederholung.mjs");
export const { nurAutorZeileTrifft, resolveToolboxToken, interpretToolboxCreateResponse, agentModelHeader,
  nightRunHeader, ToolboxIssueTracker, resolveTracker } = await import("./board/adapter.mjs");
// Dispatch braucht dazu die Auswahl des Code-Hosts; der Einstieg exportierte sie nie und tut es
// weiter nicht.
const { resolveCodeHost } = await import("./board/adapter.mjs");
export const { mergeKontextConfig, resolveKontextPaths, pickNoteFile, pickLatestLog, AUTOR_MODELL_ZEILE,
  autorModellSicherstellen, FACHLICH_PRAEFIX, PLAN_PRAEFIX, IDEE_PRAEFIX, MENSCH_PRAEFIX, istFachlich, istPlan,
  istIdee, istMensch, FENCE_ZEILE, fenceLauf, kontextGrenzen, leseTextQuelle, kitStandZeileFuer,
  STAND_LABEL_VORGABEN, AUFTRAG_BACKLOG_TEXTE, abhaengigkeitenLesen, abhaengigkeitenMitHerkunft,
  abhaengigkeitsHinweise, ABSCHNITT_ZEILE } = await import("./board/dokumente.mjs");
// Die Handler der issue-Befehle, die Kontext-Achse und die Abschnittszerlegung braucht der
// Einstieg fuer Dispatch und Formpruefung; exportiert waren sie nie und bleiben es nicht.
const { KONTEXT_DEFAULTS, loadKontextConfig, kontextRepoName, heute, issueCreate,
  issueGet, issueList, issueEpics, issueActivity, issueMove, issueLabel,
  issueComment, issueMelden, issueStand, issueAuftrag, issueUrsprung, issueUpdate, checkFormWege,
  titelMitArt } = await import("./board/dokumente.mjs");
export const { GESCHUETZTE_PFADE, KOPIE_PFADE, geschuetztePfade, schreibSperrenPfade, trifftGeschuetzt, pfadTokens, tokenFormen,
  geschuetzteTreffer, GESCHUETZT_ANKER, GESCHUETZT_LABEL, GESCHUETZT_LABEL_GESETZT, GESCHUETZT_LABEL_NICHT_GESETZT,
  GESCHUETZT_ABGEWIESEN, abgewieseneTreffer, geschuetztKommentar, geschuetztFreigabe } = await import("./board/geschuetzt.mjs");
// Erkennt ein Label unter jedem seiner Namen (Issue #1424); exportiert war es nie.
const { traegtLabel } = await import("./board/geschuetzt.mjs");
export const { TEST_ABLAGEN_VORGABE, testAblagen, ablageAlsAusdruck, nennungsVerzeichnis, genannteDateien,
  pruefeTestNennung, pruefeForm } = await import("./board/testhinweise.mjs");
// Den Bestand fuer `issue check-form` braucht nur der Einstieg; exportiert war er nie.
const { versionierteDateien } = await import("./board/testhinweise.mjs");
// Ob eine Karte die Szenarien-Pflicht traegt, braucht nur `issue check-form` (Issue #1590).
const { szenarienLesen, szenarienPflicht, stichtagHinweis } = await import("./board/szenarien.mjs");
export const { pickReviewers, kommandoVerfuegbar, stufeAusTitel } = await import("./board/issue-review.mjs");
// Den Befehlsverteiler der Achse braucht nur Dispatch; exportiert war er nie.
const { dispatchIssueReview } = await import("./board/issue-review.mjs");
export const { nachtlaufAbbruchGrund, nachtlaufMeldung, sitzungProtokoll, wegmarkenAbschnitte,
  sitzungMeldung } = await import("./board/melder.mjs");
// Die Befehlsverteiler der beiden Melder braucht nur Dispatch; exportiert waren sie nie.
const { dispatchNightrun, dispatchSitzung } = await import("./board/melder.mjs");
export const { pruefeBashZeile, pruefeHintergrund, hookSchreibenPruefen } = await import("./board/hook.mjs");
// Den Befehlsverteiler des Hooks braucht nur Dispatch; exportiert war er nie.
const { dispatchHook } = await import("./board/hook.mjs");
export const { SCHUTZ_AUSGESETZT, NACHPRUEFEN_KOMMANDO, NACHT_GESPERRT, rulesetSoll, schutzZustand, anleitung,
  notfallGate, nachtSperre, probe, einrichten, nachpruefen } = await import("./board/schutz.mjs");
// Das Warten auf den Build-Dienst braucht nur `code ci-wait` (Issue #2132); exportiert war es nie.
const { warteAufLauf } = await import("./board/schutz.mjs");
// Den Namen eines Rulesets braucht nur `code schutz aussetzen|wiederherstellen`; exportiert war er nie.
const { rulesetName } = await import("./board/adapter.mjs");
// `issue hold` und das Feld `wartet` von `issue check-form` (Issue #1662); exportiert war es nie.
const { issueHold, ereignisGrund } = await import("./board/ereignis.mjs");
// `issue vorgeschichte` (Issue #1539); exportiert war es nie.
const { issueVorgeschichte } = await import("./board/vorgeschichte.mjs");
// `code contract-repo` (Issue #1615); exportiert war es nie.
const { vertragsRepoHolen } = await import("./board/vertraege.mjs");
// Englisch benannte Config auf die deutschen Namen (Issue #1436, Plan #1420 E10).
const { normalisiereConfig } = await import("./board/config-namen.mjs");
// Die Meldung zu einem frueheren deutschen Namen (Issue #1557, Plan #1548).
const { altnameHinweis, EINGABEWERTE, text, projektSprache, festeZeilen, vertragWoerter } = await import("./board/namen.mjs");
// Die Texte des Einstiegs an den Menschen (Issue #1524: im Teil texte/).
export const { TEXTE } = await import("./texte/board.mjs");

/** Ein Text des Einstiegs in der Projektsprache (Issue #1477, E13). */
const t = (schluessel, werte) => text(TEXTE, schluessel, werte);
/** Die Achsen von board.mjs, englisch wie jeder Name, den das Kommando annimmt (Issue #1557). */
const ACHSEN = ["issue", "code", "context", "issue-review", "nightrun", "session", "hook", "scenarios", "names", "doctor", "update", "release", "pro", "edition", "app", "config"];
/**
 * Bricht mit einer Meldung ab wie `fail` aus den Grundlagen, das Praefix in der Projektsprache.
 * `fail` selbst stellen die Grundlagen um (Issue #1483).
 */
function abbruch(meldung) {
  process.stderr.write(`${t("fehler")}: ${meldung}\n`);
  process.exit(1);
}
/** Weist einen unbekannten Befehl einer Achse ab, nach der Hilfe. */
function unbekannterBefehl(achse, befehl) {
  process.stdout.write(HELP);
  abbruch(t("unbekannterBefehl", { achse, befehl }));
}

// --- Argument-Parser ---

function parseArgs(argv) {
  const result = { _: [] };
  // Alle Werte einer mehrfach genannten Option (`--path a --path b`); `result[key]` traegt
  // weiter den letzten. Nicht aufzaehlbar, damit es kein Optionsname werden kann.
  const werte = {};
  Object.defineProperty(result, "werte", { value: werte, enumerable: false });
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        result[key] = next;
        werte[key] = [...(werte[key] ?? []), next];
        i += 1;  // der Wert gehoert zur Option
      } else {
        result[key] = true;
      }
    } else {
      result._.push(a);
    }
    i += 1;
  }
  return result;
}

// ============================================================
// Dispatch
// ============================================================

// Ein Handler je issue-Subbefehl: haelt die Argument-Validierung flach (auf Funktionsebene
// statt tief in verschachtelten switch-cases) und damit die kognitive Komplexitaet niedrig.

/** Weist einen Aufruf ab — mit JSON auf stdout, damit ein Aufrufer die Abweisung lesen kann. */
function checkFormAbweisen(meldung) {
  out({ ok: false, stufe: null, verstoesse: [], fehler: meldung });
  process.stderr.write(`${t("fehler")}: ${meldung}\n`);
  process.exit(1);
}

/** Der Datei-Weg: Body aus --body-file, Titel aus --title. */
function checkFormAusDatei(datei, titel) {
  if (datei === true || datei === "") checkFormAbweisen(t("checkFormOhnePfad", { wege: checkFormWege() }));
  if (typeof titel !== "string" || titel.trim() === "") {
    checkFormAbweisen(t("checkFormOhneTitel", { wege: checkFormWege() }));
  }
  try {
    return { body: readFileSync(datei, "utf-8"), title: titel };
  } catch (e) {
    return checkFormAbweisen(t("checkFormUnlesbar", { datei, grund: e.code || e.message, wege: checkFormWege() }));
  }
}

/** Der Board-Weg: Body und Titel der Karte; eine unbekannte Nummer weist den Aufruf ab. */
async function checkFormVomBoard(tracker, id) {
  try {
    const issue = await tracker.getIssue(String(id));
    return { body: issue.body || "", title: issue.title || "" };
  } catch (e) {
    if (e instanceof BoardError && /HTTP 404|nicht gefunden|not found/i.test(e.message)) return checkFormAbweisen(e.message);
    throw e;
  }
}

async function issueCheckForm(tracker, config, args) {
  const id = args._[0];
  const hatDatei = args["body-file"] !== undefined;
  if (id !== undefined && hatDatei) checkFormAbweisen(t("checkFormBeides", { wege: checkFormWege() }));
  if (id === undefined && !hatDatei) checkFormAbweisen(t("checkFormNichts", { wege: checkFormWege() }));

  const eingabe = hatDatei ? checkFormAusDatei(args["body-file"], args.title) : await checkFormVomBoard(tracker, id);
  const body = eingabe.body;
  // --art waehlt die Stufe ueber den Titel, wie `issue create` ihn anlegt (Issue #1427, E6).
  const { titel: title, fehler } = titelMitArt(eingabe.title, args.art);
  if (fehler) checkFormAbweisen(t("checkFormArt", { fehler, wege: checkFormWege() }));
  const dateien = stufeAusTitel(title) === "plan" ? versionierteDateien() : [];
  // F12: eine Datei ist ein neuer Fachplan, eine Karte erst ab dem Stichtag (Issue #1590, A4, A6).
  // Die Pflicht hat drei Werte; an pruefeForm gehen zwei Booleans (Issue #1606).
  const pflicht = hatDatei ? true : szenarienPflicht(id, config);
  const ergebnis = pruefeForm(body, title, config, dateien, configWurzel(),
    { szenarien: pflicht === true, stichtagHinweis: pflicht === "ohne-stichtag" });
  // E9 (Issue #1662): das Warten als Feld neben ok, ohne Verstoss und ohne Einfluss auf den Exit.
  if (ergebnis.stufe === "fachlich") {
    const wartet = ereignisGrund(body);
    if (wartet !== null) ergebnis.wartet = wartet;
  }
  if (ergebnis.stufe === "issue") {
    const hinweise = await abhaengigkeitsHinweise(body, tracker);
    if (hinweise.length > 0) ergebnis.hinweise = hinweise;
  }
  out(ergebnis);
  if (!ergebnis.ok) process.exit(1);
}

/**
 * `issue check-geschuetzt <id> [--pfad <pfad>]...` (Issue #1045, Plan #987, E6): Treffer, Label,
 * Freigabe und Halt-Kommentar eines Pakets — die eine Quelle fuer Runner, Auftrag und Skills.
 * `--pfad` nimmt einen beim Schreiben abgewiesenen Pfad mit auf (Issue #1053, E13). Rein lesend.
 * Ein Label ohne Treffer ist ein Befund (Karte aus dem Rueckfall-Halt): Der Runner
 * ueberspringt sie, das Kommando gibt dieselbe Auskunft.
 */
async function issueCheckGeschuetzt(tracker, args) {
  const id = args._[0];
  if (id === undefined) abbruch(t("checkGeschuetztOhneId", { befehl: "issue check-protected" }));
  const issue = await tracker.getIssue(String(id));
  const kommentare = await tracker.kommentareStreng(String(id));
  const labels = issue.labels || [];
  const treffer = [
    ...geschuetzteTreffer(issue.body || "", issue.title || "", configWurzel()),
    ...abgewieseneTreffer(args.werte?.path ?? [], configWurzel()),
  ];
  const label = traegtLabel(labels, "geschuetzt");
  const freigegeben = geschuetztFreigabe(treffer, kommentare, labels);
  const ok = freigegeben || (treffer.length === 0 && !label);
  out({ ok, treffer, label, freigegeben, handlung: geschuetztHandlung(treffer, label, freigegeben), kommentar: treffer.length > 0 ? geschuetztKommentar(treffer) : null });
  if (!ok) process.exit(1);
}

/** Der Satz fuer den Menschen zum Ergebnis von `issue check-geschuetzt`. */
function geschuetztHandlung(treffer, label, freigegeben) {
  if (freigegeben) return t("handlungFreigegeben");
  if (treffer.length === 0 && !label) return t("handlungKeineDatei");
  if (treffer.length === 0) return t("handlungNurLabel", { label: GESCHUETZT_LABEL });
  const pfade = [...new Set(treffer.map((e) => e.pfad))].join(", ");
  if (label) return t("handlungMitLabel", { pfade, label: GESCHUETZT_LABEL });
  return t("handlungAnhalten", { pfade });
}

/**
 * `issue questions <id> [--body-file <pfad>] [--compare <pfad>]` (Issue #1513, Plan #1510 A2,
 * A3, A4, E9), englisch `issue questions` mit `--compare` (Issue #1555, Plan #1548 E8): der
 * Grooming-Stand eines Fachplans fuer `/groom`, dazu der Stand der Szenarien (Issue #1592,
 * Plan #1588 A6, A8), auch eines Umsetzungsplans mit `## Offene Fragen` (Issue #1946, Plan #1939
 * A8a). Rein lesend — geschrieben
 * wird ueber `issue update --body-file` (A3), Labels bleiben unberuehrt (A4). Die Kommentare
 * liest der Aufruf nur bei `kit:klaeren`: Nur dort gibt es eine Stopp-Frage. Exit 1 allein,
 * wenn `--body-file` gegen den Body der Karte verstoesst.
 */
async function issueFragen(tracker, config, args) {
  const id = args._[0];
  if (id === undefined) abbruch(t("fragenOhneId"));
  const { groomEinstieg, groomArt, fragenSache, fragenLesen, stoppKommentar, vermerkZeile, koerperPruefen, kriterienVergleich,
    szenarienVollstaendig } = await import("./board/grooming.mjs");
  const neu = optionDatei(args, "body-file");
  const start = optionDatei(args, "compare");
  const issue = await tracker.getIssue(String(id));
  const body = issue.body || "";
  const art = groomArt(issue.title);
  const fragen = fragenLesen(body, fragenSache(issue.title));
  const klaeren = traegtLabel(issue.labels, "klaeren");
  const ausgabe = {
    einstieg: groomEinstieg({ ...issue, id: String(id) }, process.env, config),
    fragen,
    stoppKommentar: klaeren ? stoppKommentar(await kartenKommentare(tracker, String(id), issue)) : null,
    vermerkVorschlag: fragen.offen === 0 && fragen.fragen.length > 0 ? vermerkZeile(fragen.fragen.length, heute()) : null,
    szenarien: szenarienStand(id, body, config, szenarienVollstaendig, art),
  };
  if (neu !== null) ausgabe.pruefung = koerperPruefen(body, neu, art);
  if (start !== null) ausgabe.aenderungen = kriterienVergleich(start, body, String(id));
  out(ausgabe);
  if (ausgabe.pruefung && !ausgabe.pruefung.ok) process.exit(1);
}

/**
 * `issue triage <id> [--body-file <pfad>] [--finish [--template <datei>]]` (Issue #1628, #1629,
 * Plan #1623 A2, A3, A11, A13, E2, E5): Einstieg, Ablage und geklaerter Stand einer Idee fuer
 * `/triage`. Die Karte aendert der Aufruf nie — geschrieben wird ueber `issue update --body-file`.
 * Die Ablage legt er nur an, wenn er beim Einstieg die Anhaenge einer kanban-kit-Karte laedt
 * (Issue #1681, `anhaengeLaden`); dann steht `ablage.anhaenge` in der Ausgabe, sonst fehlt das
 * Feld. `--finish` schliesst die Ablage ab, nur wenn der Einstieg
 * `start: true` meldet (A3); die Karte beruehrt es nie. Exit 1, wenn `--body-file` gegen den Body
 * der Karte verstoesst oder der Abschluss nicht stattfand.
 */
async function issueTriage(tracker, args) {
  const id = args._[0];
  if (id === undefined) abbruch(t("triageOhneId"));
  if (args.template !== undefined && args.finish === undefined) abbruch(t("triageVorlageOhneFinish"));
  if (args.template === true) abbruch(t("optionOhneWert", { option: "template" }));
  const { triageEinstieg, ablageLesen, ablageAbschliessen, standLesen, triageKoerperPruefen, anhaengeLaden, anhaengeHolen } =
    await import("./board/triage.mjs");
  const neu = optionDatei(args, "body-file");
  const issue = await tracker.getIssue(String(id));
  const body = issue.body || "";
  const einstieg = triageEinstieg({ ...issue, id: String(id) }, process.env);
  const anhaenge = anhaengeLaden({ einstieg, bodyFile: neu, finish: args.finish, tracker })
    ? await anhaengeHolen(configWurzel(), String(id), tracker)
    : null;
  const ablage = ablageLesen(configWurzel(), String(id), new Set(anhaenge?.geladen ?? []));
  if (anhaenge !== null) ablage.anhaenge = anhaenge;
  const ausgabe = {
    einstieg,
    ablage,
    stand: standLesen(body, await kartenKommentare(tracker, String(id), issue)),
  };
  if (neu !== null) ausgabe.pruefung = triageKoerperPruefen(body, neu);
  if (args.finish !== undefined) {
    ausgabe.abschluss = einstieg.start
      ? ablageAbschliessen(configWurzel(), String(id), args.template ?? null)
      : { ok: false, pfad: ausgabe.ablage.pfad, geloescht: false, vorlage: null, meldung: einstieg.meldung };
  }
  out(ausgabe);
  if ((ausgabe.pruefung && !ausgabe.pruefung.ok) || (ausgabe.abschluss && !ausgabe.abschluss.ok)) process.exit(1);
}

/**
 * Der Stand der Szenarien fuer `issue questions`: `{ pflicht, vorhanden, vollstaendig }`,
 * `pflicht` wie `szenarienPflicht`; fehlt der Stichtag, dazu `hinweis` (A6). Ein Umsetzungsplan
 * (`art` `plan`) braucht keine Szenarien: `pflicht` false, ohne Hinweis (Issue #1946).
 */
function szenarienStand(id, body, config, vollstaendig, art = "fachlich") {
  const pflicht = art === "plan" ? false : szenarienPflicht(id, config);
  const stand = { pflicht, vorhanden: szenarienLesen(body).vorhanden, vollstaendig: vollstaendig(body) };
  if (pflicht === "ohne-stichtag") stand.hinweis = stichtagHinweis();
  return stand;
}

/** Die Kommentare einer Karte: mit der Karte geliefert, sonst streng vom Tracker gelesen. */
async function kartenKommentare(tracker, id, issue) {
  if (Array.isArray(issue.comments)) return issue.comments;
  return tracker.kommentareStreng(id);
}

/** Der Inhalt der Datei hinter `--<name> <pfad>`, null ohne die Option. */
function optionDatei(args, name) {
  if (args[name] === undefined) return null;
  if (args[name] === true) abbruch(t("optionOhneWert", { option: name }));
  try {
    return readFileSync(args[name], "utf-8");
  } catch (e) {
    return abbruch(t("optionDateiUnlesbar", { option: name, datei: args[name], grund: e.code || e.message }));
  }
}

// Was das Urteil von `issue auftrag` aus dem Abschnitt "Geschuetzte Pfade" braucht. Der Teil
// dokumente importiert nie aus dem Einstieg; der Einstieg reicht es ihm herein (Issue #1218).
const AUFTRAG_GESCHUETZT = Object.freeze({ geschuetzteTreffer, geschuetztFreigabe, geschuetztKommentar,
  GESCHUETZT_LABEL, GESCHUETZT_LABEL_GESETZT, GESCHUETZT_LABEL_NICHT_GESETZT });

/**
 * `issue repair --summary <datei> | --ci <sha>` (Issue #2092, #2094): Reparaturkarten aus einem
 * roten Prueflauf. `--ci` liest das Protokoll des Build-Diensts ueber den Code-Host, unter der
 * vollen Kennung des Commits wie `code ci-status`. Beides zusammen weist issueRepair ab.
 */
async function issueReparatur(args) {
  const { issueRepair } = await import("./board/reparatur.mjs");
  const abhaengigkeiten = {};
  let eingabe = args;
  if (args.ci !== undefined && args.summary === undefined) {
    if (args.ci === true) abbruch(t("optionOhneWert", { option: "ci" }));
    const { volleKennung } = await import("./board/arbeitskopie.mjs");
    try {
      eingabe = { ...args, ci: volleKennung(configWurzel(), String(args.ci)) };
    } catch (e) {
      abbruch(e.message);
    }
    abhaengigkeiten.host = resolveCodeHost(loadConfig());
  }
  try {
    out(await issueRepair(eingabe, abhaengigkeiten));
  } catch (e) {
    if (e instanceof BoardError) return abbruch(e.message);
    throw e;
  }
}

async function dispatchIssue(command, args) {
  const config = loadConfig();
  const tracker = resolveTracker(config);
  switch (command) {
    case "create":  return issueCreate(tracker, args);
    case "get":     return issueGet(tracker, args);
    case "list":    return issueList(tracker, args);
    case "epics":   return issueEpics(tracker);
    case "activity": return issueActivity(tracker, config, args);
    case "move":    return issueMove(tracker, args);
    case "update":  return issueUpdate(tracker, args);
    case "comment": return issueComment(tracker, args);
    case "report":  return issueMelden(tracker, args);
    case "run-state": return issueStand(tracker, config, args);
    case "brief":   return issueAuftrag(tracker, args, AUFTRAG_GESCHUETZT);
    case "origin":  return issueUrsprung(tracker, args);
    case "questions": return issueFragen(tracker, config, args);
    case "triage":  return issueTriage(tracker, args);
    case "label":   return issueLabel(tracker, config, args, HELP);
    case "check-form": return issueCheckForm(tracker, config, args);
    case "check-protected": return issueCheckGeschuetzt(tracker, args);
    case "hold":    return out(await issueHold(tracker, config, args));
    case "history": return issueVorgeschichte(tracker, config, args, HELP);
    case "repair":  return issueReparatur(args);
    default:
      unbekannterBefehl("issue", command);
  }
}

async function codeRepoName(host) {
  out({ repoName: await host.getRepoName() });
}

async function codePr(host, args) {
  if (!args.from) abbruch(t("optionErforderlich", { option: "from" }));
  if (!args.to) abbruch(t("optionErforderlich", { option: "to" }));
  if (!host.supportsPullRequests()) {
    abbruch(t("keinePullRequests"));
  }
  out(await host.createPullRequest({ from: args.from, to: args.to, title: args.title }));
}

/**
 * `code merge-pr --number <n> --head <sha>` (Issue #2054, Plan #2038, A6): Der Hotfix merged
 * seinen PR selbst. Ohne Pull Requests derselbe Abbruch wie `code pr`; ein gescheiterter
 * Merge ist `{ ok: false, number, grund }` mit Exit 1, damit der Aufrufer den Grund lesen kann.
 *
 * `--head` ist Pflicht (Issue #2084): Die Freigabe gilt dem geprueften Kopf, nicht dem, den
 * jemand mit Schreibrecht auf den Quellzweig danach nachschiebt.
 */
async function codeMergePr(host, args) {
  if (args.number === undefined) abbruch(t("optionErforderlich", { option: "number" }));
  if (args.number === true) abbruch(t("optionOhneWert", { option: "number" }));
  if (!/^\d+$/.test(String(args.number))) abbruch(t("nummerKeineZahl", { wert: args.number }));
  if (args.head === undefined) abbruch(t("optionErforderlich", { option: "head" }));
  if (args.head === true) abbruch(t("optionOhneWert", { option: "head" }));
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(String(args.head))) abbruch(t("kopfKeinSha", { wert: args.head }));
  if (!host.supportsPullRequests()) abbruch(t("keinePullRequests"));
  const number = Number(args.number);
  try {
    const { commit } = await host.mergePullRequest({ number, head: String(args.head).toLowerCase() });
    out({ ok: true, number, commit });
  } catch (e) {
    out({ ok: false, number, grund: e.message });
    process.exitCode = 1;
  }
}

/**
 * `--commit` als volle Kennung des Repos (Issue #2132): Der Build-Dienst kennt Laeufe nur unter
 * ihr, eine verkuerzte fand keinen und blieb ohne Ende bei `laeuft`. Eine unbekannte bricht ab.
 */
async function commitOption(args) {
  if (args.commit === undefined) abbruch(t("optionErforderlich", { option: "commit" }));
  if (args.commit === true) abbruch(t("optionOhneWert", { option: "commit" }));
  if (args.branch === true) abbruch(t("optionOhneWert", { option: "branch" }));
  const { volleKennung } = await import("./board/arbeitskopie.mjs");
  try {
    return volleKennung(configWurzel(), String(args.commit));
  } catch (e) {
    abbruch(e.message);
  }
}

/**
 * `--check-branches` (Issue #2247, Plan #2242 A7): der Name der Pruefzweige, deren Laeufe allein
 * zaehlen, ohne die Option `undefined`. Pruefzweige gibt es nur mit dem Build-Dienst.
 */
function pruefzweigeOption(config, args) {
  if (args["check-branches"] === undefined) return undefined;
  const pruefung = config.pushPruefung;
  if (pruefung === null || typeof pruefung !== "object" || pruefung.ort !== "buildDienst") {
    abbruch(t("pruefzweigeOhneBuildDienst"));
  }
  return pruefung.zweig || "kit-pruefung";
}

/** Der Code-Host, bei `pruefzweige` mit dem Filter auf die Pruefzweige in jedem `getCiStatus`. */
function ciQuelle(host, pruefzweige) {
  return pruefzweige ? { getCiStatus: (commit, zweig) => host.getCiStatus(commit, zweig, { pruefzweige }) } : host;
}

async function codeCiStatus(host, config, args) {
  const pruefzweige = pruefzweigeOption(config, args);
  const commit = await commitOption(args);
  out(await ciQuelle(host, pruefzweige).getCiStatus(commit, args.branch === undefined ? undefined : String(args.branch)));
}

// `code ci-wait` (Issue #2132, Kriterium 5 von #2130): 5 Minuten bis zum sichtbaren Lauf, im
// Takt der Probe. Beide sind fuer Tests ueber die Umgebung verkuerzbar.
const CI_WAIT_FRIST_LAUF_MS = 5 * 60_000;
const CI_WAIT_TAKT_MS = 30_000;

/** Eine positive Zahl aus der Umgebungsvariable `name`, sonst `vorgabe`. */
function msAusUmgebung(name, vorgabe) {
  const wert = Number(process.env[name]);
  return Number.isFinite(wert) && wert > 0 ? wert : vorgabe;
}

/**
 * Wartet ueber `warteAufLauf` auf das Urteil des Build-Diensts zu `--commit` und endet immer:
 * `ergebnis` ist das Urteil (`gruen`, `rot`), `keine` ohne Build-Dienst, `kein Lauf`, wenn nach
 * 5 Minuten kein Lauf sichtbar ist, und `frist` nach `--timeout-min` — dann nennt `schritt`
 * den erreichten Schritt und `jobs` den Stand je Job.
 */
async function codeCiWait(host, config, args) {
  const pruefzweige = pruefzweigeOption(config, args);
  const commit = await commitOption(args);
  if (args["timeout-min"] === undefined) abbruch(t("optionErforderlich", { option: "timeout-min" }));
  const minuten = Number(args["timeout-min"]);
  if (args["timeout-min"] === true || Number.isNaN(minuten) || minuten <= 0) abbruch(t("optionOhneWert", { option: "timeout-min" }));
  const zweig = args.branch === undefined ? undefined : String(args.branch);
  const start = Date.now();
  const ci = await warteAufLauf(ciQuelle(host, pruefzweige), commit, zweig, {
    takt: msAusUmgebung("KIT_CI_WAIT_TAKT_MS", CI_WAIT_TAKT_MS),
    fristLauf: Math.min(msAusUmgebung("KIT_CI_WAIT_FRIST_LAUF_MS", CI_WAIT_FRIST_LAUF_MS), minuten * 60_000),
    fristAbschluss: minuten * 60_000,
    name: zweig ?? commit.slice(0, 12),
  });
  const jobs = ci?.jobs ?? [];
  const fertig = jobs.length > 0 && jobs.every((j) => j.ergebnis !== "laeuft");
  let ergebnis;
  let schritt;
  if (ci?.status === "keine") [ergebnis, schritt] = ["keine", "urteil"];
  else if (fertig) [ergebnis, schritt] = [ci.status, "urteil"];
  else if (jobs.length === 0) [ergebnis, schritt] = ["kein Lauf", "suche"];
  else [ergebnis, schritt] = ["frist", "laeuft"];
  out({ commit, ergebnis, schritt, status: ci?.status ?? null, adresse: ci?.adresse ?? null, jobs, wartezeitMs: Date.now() - start });
}

const SCHUTZ_AKTIONEN = ["status", "setup", "suspend", "restore", "verify"];
const WIEDERHERSTELLEN_KOMMANDO = "node .claude/kit/board.mjs code protection restore";

/** Der Pruefzweig der Probe (E5): `--branch`, sonst `pushPruefung.zweig`, sonst `kit-pruefung`. */
function schutzZweig(config, args) {
  if (args.branch === true) abbruch(t("optionOhneWert", { option: "branch" }));
  return args.branch || config.pushPruefung?.zweig || "kit-pruefung";
}

/** Aussetzen und Wiederherstellen brauchen einen Code-Host mit Schutz. */
function schutzVerlangen(host) {
  const unterstuetzt = typeof host.schutzUnterstuetzt === "function"
    ? host.schutzUnterstuetzt()
    : { ja: false, grund: t("keinSchutz") };
  if (!unterstuetzt.ja) abbruch(unterstuetzt.grund);
}

/**
 * `code protection <aktion>` (Issue #1408, Plan #1405, A10). `setup`, `suspend` und `verify`
 * pushen oder aendern den Code-Host und laufen darum durch die Sperre ohne Aufsicht (E8); `status`
 * und `restore` nicht.
 */
async function codeSchutz(host, config, args) {
  const aktion = args._[0];
  if (!SCHUTZ_AKTIONEN.includes(aktion)) {
    process.stdout.write(HELP);
    abbruch(t("unbekannteSchutzAktion", {
      schutz: "protection",
      aktion: aktion ?? "",
      erwartet: SCHUTZ_AKTIONEN.join(" | "),
    }));
  }
  nachtSperre(aktion);
  const mainBranch = config.mainBranch || "main";
  switch (aktion) {
    case "status": return out(await schutzZustand(host, config));
    case "setup":  return out(await einrichten(host, config, schutzZweig(config, args)));
    case "verify": return out(await nachpruefen(host, config, schutzZweig(config, args)));
    case "suspend": {
      if (typeof args.in !== "string") abbruch(t("aussetzenOhneIn"));
      schutzVerlangen(host);
      const gate = await notfallGate(args.in);
      if (!gate.ok) abbruch(t("notfallVerweigert", { grund: gate.grund }));
      return out(await host.setRulesetEnforcement(rulesetName(mainBranch), "disabled"));
    }
    default: {
      schutzVerlangen(host);
      try {
        return out(await host.setRulesetEnforcement(rulesetName(mainBranch), "active"));
      } catch (e) {
        // E10: Der Schutz bleibt ausgesetzt, bis dieser Aufruf gelingt — `status` nennt es.
        abbruch(t("wiederherstellenGescheitert", { grund: e.message, kommando: WIEDERHERSTELLEN_KOMMANDO }));
      }
    }
  }
}

/**
 * `code contract-repo <name>` (Issue #1615, Plan #1611 E7): der gebaute Stand des Partnerrepos
 * im Zwischenspeicher. Exit 0 auch bei `ok: false` wie `issue history`; ein unbekannter oder
 * ungueltiger Name bricht mit den bekannten Namen ab.
 */
function codeVertragsRepo(config, args) {
  try {
    return out(vertragsRepoHolen(config, args._[0]));
  } catch (e) {
    abbruch(e.message);
  }
}

async function dispatchCode(command, args) {
  const config = loadConfig();
  // Braucht keinen Code-Host: Der Abruf geht ueber git an die URL aus der Config.
  if (command === "contract-repo") return codeVertragsRepo(config, args);
  const host = resolveCodeHost(config);
  switch (command) {
    case "repo-name": return codeRepoName(host);
    case "pr":        return codePr(host, args);
    case "merge-pr":  return codeMergePr(host, args);
    case "ci-status": return codeCiStatus(host, config, args);
    case "ci-wait":   return codeCiWait(host, config, args);
    case "protection": return codeSchutz(host, config, args);
    default:
      unbekannterBefehl("code", command);
  }
}

// Ein Flag ohne Wert wird von parseArgs zu true. Fuer --project/--date waere das ein
// stiller Fehlgriff (falscher Projektname, heutiges statt gemeintem Datum) — deshalb
// Abbruch mit Meldung statt Rueckfall auf den Default.
function kontextOption(args, name) {
  if (args[name] === true) abbruch(t("optionOhneWert", { option: name }));
  return args[name];
}

/**
 * Liest die Dateinamen eines Notizordners (Issue #286).
 *
 * Ein fehlender Ordner ist der Normalfall der Erstanlage und liefert []. Jeder
 * ANDERE Fehler — der Pfad ist eine Datei, das Verzeichnis ist nicht lesbar —
 * bricht ab: Ihn wie einen leeren Ordner zu behandeln hiesse, still auf den
 * konstruierten Namen zurueckzufallen und genau die zweite Notiz anzulegen, die
 * dieses Issue verhindert.
 */
function leseNotizOrdner(ordner) {
  try {
    return readdirSync(ordner);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    abbruch(t("notizordnerUnlesbar", { ordner, grund: e.code || e.message }));
  }
}

// Macht aus einer Mehrdeutigkeit einen Abbruch. Ein stiller Griff ins Ungewisse
// waere genau der Fehler, den Issue #286 behebt — deshalb Exit 1 mit beiden Namen,
// statt eine der beiden Dateien zu raten.
export function waehleNotiz(dateien, notizName, ordner, alleinstehend) {
  const { name, kollision } = pickNoteFile(dateien, notizName, { alleinstehend });
  if (kollision) {
    abbruch(t("notizMehrdeutig", { ordner, dateien: kollision.join(", ") }));
  }
  return name;
}

// Praezedenz des Projektnamens: --project > cfg.project > Repo-Name > basename(cwd).
//
// Der Dateisystem-Zugriff liegt hier und nicht in resolveKontextPaths: Die Funktion
// traegt den Vertrag "rein, ohne Dateisystem" und bleibt damit ohne vorhandenen
// Vault aufrufbar — dieselbe Naht wie bei pickLatestLog/kontextLastLog (Issue #286).
async function kontextPaths(args) {
  const cfg = loadKontextConfig();
  const project = kontextOption(args, "project") || cfg.project || await kontextRepoName();
  const date = kontextOption(args, "date") || heute();
  const basis = resolveKontextPaths({ cfg, project, date });
  if (basis.mode === "degraded") return out(basis);

  // Mit parentProject liegen Dach- und Service-Notiz im selben Ordner; er wird
  // einmal gelesen und beide Namen daraus aufgeloest.
  const parent = basis.parentProject;
  const ordner = join(basis.vault, "Projekte", parent || basis.project);
  const dateien = leseNotizOrdner(ordner);
  out(resolveKontextPaths({
    cfg, project, date,
    projectNoteFile: waehleNotiz(dateien, `${basis.project}.md`, ordner, !parent),
    parentNoteFile: parent ? waehleNotiz(dateien, `${parent}.md`, ordner, false) : null,
  }));
}

// Der juengste vorhandene Log-Eintrag desselben Projekts, als Anknuepfung fuer /document.
// Kein Vault, kein Log-Verzeichnis oder kein Treffer sind alle derselbe Normalfall
// (erster Eintrag eines Projekts) und liefern path: null — kein Fehler.
async function kontextLastLog(args) {
  const cfg = loadKontextConfig();
  if (!cfg.vault) return out({ path: null });

  const project = kontextOption(args, "project") || cfg.project || await kontextRepoName();
  const template = cfg.logPath || KONTEXT_DEFAULTS.logPath;
  const ordner = join(cfg.vault, ...template.split("/").slice(0, -1));

  let dateien;
  try {
    dateien = readdirSync(ordner);
  } catch {
    return out({ path: null });
  }

  const treffer = pickLatestLog(dateien, {
    template,
    project,
    before: kontextOption(args, "before") || heute(),
  });
  out(treffer ? { path: join(ordner, treffer.name), date: treffer.date } : { path: null });
}

async function dispatchKontext(command, args) {
  switch (command) {
    case "paths": return kontextPaths(args);
    case "last-log": return kontextLastLog(args);
    default:
      unbekannterBefehl("context", command);
  }
}

/**
 * `scenarios baseline` (Issue #1591, Plan #1588 E3): die hoechste Nummer aller Karten plus eins.
 * Ein Aufruf ohne Status, damit auch Karten ohne Spalte zaehlen; `Number(id)` macht aus den
 * gepolsterten lokalen Nummern Zahlen. Schreibt nichts — das Feld setzt der Installer.
 */
async function dispatchSzenarien(command) {
  if (command !== "baseline") unbekannterBefehl("scenarios", command);
  const karten = await resolveTracker(loadConfig()).listIssues();
  const nummern = karten.map((k) => Number(k.id)).filter(Number.isFinite);
  out({ ab: Math.max(0, ...nummern) + 1 });
}

/**
 * Weist einen frueheren deutschen Namen ab (Issue #1557, Plan #1548, Entscheidung „Abweisung
 * statt Uebergang“): Achse, Befehl, Aktion von `code protection`, Option oder Auswahlwert von
 * `--art`, `--state` und `--stage`. Exit 1 mit der Meldung, die den englischen Namen nennt —
 * vor jedem Zugriff aufs Board, so bleibt alles unberuehrt.
 */
function altnamenAbweisen(axis, command, rest) {
  const abweisen = (hinweis) => {
    if (hinweis !== null) abbruch(hinweis);
  };
  abweisen(altnameHinweis("achse", axis));
  abweisen(altnameHinweis("befehl", command, axis));
  if (axis === "code" && command === "protection") abweisen(altnameHinweis("schutz", rest[0]));
  rest.forEach((wort, i) => {
    if (!wort.startsWith("--")) return;
    const option = wort.slice(2);
    abweisen(altnameHinweis("option", option));
    if (Object.hasOwn(EINGABEWERTE, option)) abweisen(altnameHinweis("wert", rest[i + 1], option));
  });
}

// Hilfe und --version, beendet den Prozess. Laeuft vor dem Laden der Teile (Plan #1199, E2)
// und vor jedem Config-Zugriff: --version muss auch in einem Projekt ohne
// .claude/workflow.config.json antworten — genau dort fragt man danach.
function auskunftOhneTeile(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (argv[0] === "--version") {
    process.stdout.write(`board.mjs (claude-workflow-kit v${KIT_VERSION})\n`);
    process.exit(0);
  }
}

/**
 * Spricht der Tracker dieses Projekts selbst ueber fetch (Issue #1259)? Nur der
 * Toolbox-Adapter tut das; GitHub und GitLab gehen ueber ihre CLIs, der lokale Tracker
 * liest Dateien. Gelesen wird allein das Feld aus der geteilten Config, ohne Overrides und
 * Hinweise: Der volle Weg schriebe seine Hinweise sonst vor und nach dem Neustart.
 *
 * Fehlt die Config oder laesst sie sich nicht lesen, bleibt es beim Neustart wie vor
 * #1259 — die sichere Richtung, denn ein unnoetiger Neustart kostet nur Zeit. Der
 * Gewinn: In der Sandbox zahlte jeder Board-Aufruf zwei Prozessstarts, im Lastbeleg mehr
 * als die Haelfte der Zeit einer Ablauf-Pruefung des Runners.
 */
function trackerSprichtFetch() {
  try {
    const { config: roh } = normalisiereConfig(JSON.parse(readFileSync(join(configWurzel(), ".claude", "workflow.config.json"), "utf-8")));
    return (roh.issueTracker ?? roh.provider) === "toolbox";
  } catch {
    return true;
  }
}

/** Die Achsen, die vor Proxy-Neustart und Config-Zwang antworten, mit ihrem Verteiler in board/pro.mjs. */
const FRUEHE_ACHSEN = Object.freeze({ pro: "dispatchPro", edition: "dispatchEdition" });

/**
 * Die Achsen, die ein Pro-Teil gleichen Namens tragen: `app` (Issue #1898, Plan #1895 A11),
 * `doctor` und `update` (Issue #2014, Plan #2008 A2).
 */
const PRO_ACHSEN = Object.freeze(["app", "doctor", "update"]);

/**
 * Die Achse `release` und ihr Pro-Teil `production` (Issue #2053, Plan #2038 A5): je Befehl die
 * Pro-Funktion, deren Meldung er in Community gibt, wie `edition gate hotfix` bzw. `rollback`.
 */
const RELEASE_FUNKTION = Object.freeze({
  state: "hotfix", target: "rollback", "check-return-point": "rollback", "checkout-return-point": "rollback",
  "record-rollback": "rollback",
  "record-hotfix": "hotfix", pending: "hotfix", verified: "hotfix", "attach-card": "hotfix",
});

/** Die Pro-Meldung zum Teil auf stdout und Exit 3, wie `edition gate <teil>`. */
function proMeldungAusgeben(teil, proMeldungText) {
  process.stdout.write(`${proMeldungText(teil)}\n`);
  process.exitCode = 3;
}

/**
 * Laedt den Pro-Teil einer Achse ueber `proLaden`. Fehlt er oder ist die Installation
 * Community, die Pro-Meldung und Exit 3, Rueckgabe `null`; das Projekt bleibt unveraendert.
 */
async function proTeilLaden(teil) {
  const { proLaden, proMeldungText } = await import("./board/pro.mjs");
  const modul = await proLaden(teil);
  if (modul === null) proMeldungAusgeben(teil, proMeldungText);
  return modul;
}

/**
 * Antwortet fuer die Achsen vor Proxy-Neustart und Config-Zwang; `true`, wenn eine geantwortet hat.
 *
 * `pro run` reicht seine Argumente roh an die Auswertung weiter, die selbst entscheidet, was
 * sie braucht — so bleibt der Aufruf byte-gleich zum direkten (Issue #1855, Plan #1853 E2).
 * Ebenso `edition` (Issue #1867, Plan #1866 E4): ohne Netz und ohne Config-Zwang, damit
 * Skripte das Tor fragen koennen, bevor sie eine Pro-Funktion starten. Ebenso `app`, ohne Netz.
 * `doctor` und `update` brauchen das Netz; ist ihr Teil nicht verfuegbar, antworten sie hier
 * mit der Pro-Meldung, ohne Neustart fuer den Proxy (Issue #2014). Ebenso `release` ohne den
 * Pro-Teil `production` (Issue #2053).
 */
async function fruehAntworten(argv) {
  if (argv[0] === "app") {
    const app = await proTeilLaden("app");
    if (app !== null) await app.dispatchApp(argv[1], argv.slice(2), HELP);
    return true;
  }
  if (argv[0] === "release") {
    const { proVerfuegbar, proMeldungText } = await import("./board/pro.mjs");
    if (proVerfuegbar("production")) return false;
    proMeldungAusgeben(RELEASE_FUNKTION[argv[1]] ?? "hotfix", proMeldungText);
    return true;
  }
  if (PRO_ACHSEN.includes(argv[0])) {
    const { proVerfuegbar, proMeldungText } = await import("./board/pro.mjs");
    if (proVerfuegbar(argv[0])) return false;
    proMeldungAusgeben(argv[0], proMeldungText);
    return true;
  }
  if (!Object.hasOwn(FRUEHE_ACHSEN, argv[0])) return false;
  const teil = await import("./board/pro.mjs");
  if (argv[0] === "edition") teil.dispatchEdition(argv[1], argv.slice(2), HELP, { version: KIT_VERSION });
  else await teil[FRUEHE_ACHSEN[argv[0]]](argv[1], argv.slice(2), HELP);
  return true;
}

/**
 * Die Achsen `doctor` und `update`, Pro-Teile seit Issue #2014: geladen ueber `proLaden`, in
 * Community die Pro-Meldung. Beide antworten vor jedem Config-Zwang.
 */
async function doctorOderUpdate(argv, command, args) {
  const teil = await proTeilLaden(argv[0]);
  if (teil === null) return;
  if (argv[0] === "doctor") {
    // Fehlt die Config, prueft doctor die Gruppen, die keine brauchen, statt ueber loadConfig()
    // abzubrechen (Issue #1777, Plan #1767 E21). Nur `--report` wirkt; jedes andere Argument
    // bleibt wirkungslos (Plan #1889 E15).
    process.exit(await teil.doctorAusfuehren({ config: teil.configLesen(), kitVersion: KIT_VERSION, bericht: argv.slice(1).includes("--report") }));
  }
  // Die Kopie fragt nur das Netz (Issue #1845, Plan #1830 E3).
  await teil.dispatchUpdate(command, { ...args, kitVersion: KIT_VERSION });
}

/**
 * Die Achse `release` (Issue #2053, Plan #2038 A5), Pro-Teil `production`: in Community hat schon
 * `fruehAntworten` mit der Pro-Meldung geantwortet. Daneben `doctor` und `update`.
 */
async function proAchse(argv, command, args) {
  if (argv[0] !== "release") return doctorOderUpdate(argv, command, args);
  const teil = await proTeilLaden("production");
  if (teil !== null) out(teil.dispatchRelease(command, args, { config: readWorkflowConfig() ?? {}, hilfe: HELP, cwd: configWurzel() }));
}

/**
 * Die Achse `config` (Issue #2110, Plan #2102 A12, A16): `strictness` liefert die Strenge, wie
 * Skills und Sitzungsstart sie lesen — aus `strengeVorgaben` und `strengeZeile`, nach dem Muster
 * von `edition show`. Die Datei traegt englische Namen; die Ableitung erwartet die deutschen.
 */
async function configAntwort(command) {
  if (command !== "strictness") unbekannterBefehl("config", command);
  const { strengeVorgaben, strengeZeile } = await import("./board/strenge.mjs");
  const roh = readWorkflowConfig() ?? {};
  const { strenge, abweichungen, pushUmfang, mutation, guete, sicherheit, pruefer, auslieferungNachholen } =
    strengeVorgaben(normalisiereConfig(roh).config);
  const vorgaben = { pushUmfang, mutation, guete, sicherheit, pruefer, auslieferungNachholen };
  return { strenge, vorgaben, abweichungen, zeile: strengeZeile({ strenge }, projektSprache(roh)) };
}

async function main() {
  const argv = process.argv.slice(2);

  if (await fruehAntworten(argv)) return;

  // Hinter einem Proxy (Sandbox von Claude Code) erreicht Nodes fetch das Board nur mit
  // NODE_USE_ENV_PROXY=1 beim Start (Issue #998). Hilfe und --version brauchen kein
  // Netz und sind darum schon beantwortet (auskunftOhneTeile). Ein Tracker ohne fetch
  // braucht den Neustart ebenso wenig (Issue #1259) — ausser `doctor`: Er holt die
  // veroeffentlichte Fassung des Kits per fetch, gleich welcher Tracker (Plan #1767 E9),
  // ebenso `update` (Plan #1830 E3).
  if (proxyNeustartNoetig(process.env) && (argv[0] === "doctor" || argv[0] === "update" || trackerSprichtFetch())) {
    const kind = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
      stdio: "inherit",
      env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
    });
    process.exit(kind.status ?? 1);
  }

  const [axis, command, ...rest] = argv;
  altnamenAbweisen(axis, command, rest);
  const args = parseArgs(rest);

  if (axis === "doctor" || axis === "update" || axis === "release") {
    await proAchse(argv, command, args);
  } else if (axis === "issue") {
    await dispatchIssue(command, args);
  } else if (axis === "code") {
    await dispatchCode(command, args);
  } else if (axis === "issue-review") {
    await dispatchIssueReview(command, args, HELP);
  } else if (axis === "context") {
    await dispatchKontext(command, args);
  } else if (axis === "nightrun") {
    await dispatchNightrun(command, args, HELP);
  } else if (axis === "session") {
    await dispatchSitzung(command, args, HELP);
  } else if (axis === "hook") {
    await dispatchHook(command, HELP);
  } else if (axis === "scenarios") {
    await dispatchSzenarien(command);
  } else if (axis === "config") {
    out(await configAntwort(command));
  } else if (axis === "names") {
    // Achse ohne Unterbefehl (Issue #1558): die festen Zeilen in der Projektsprache.
    const language = projektSprache(readWorkflowConfig());
    out({ language, lines: festeZeilen(language), contract: vertragWoerter(language) });
  } else {
    process.stdout.write(HELP);
    abbruch(t("unbekannteAchse", { achse: axis, erwartet: ACHSEN.join(" | ") }));
  }
}

// Nur als CLI ausfuehren, nicht beim Import (z. B. durch die node:test-Suite, #135).
// realpathSync statt resolve: Node loest fuer import.meta.url Symlinks auf (macOS:
// /var -> /private/var), ein nur normalisierter argv[1] wuerde dann nie matchen (#146).
// Eine Funktion, weil die Antwort schon am Dateianfang gebraucht wird (auskunftOhneTeile).
function alsCliGestartet() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false; // argv[1] nicht aufloesbar -> kein CLI-Start
  }
}

if (runAsCli) {
  try {
    await main();
  } catch (err) {
    const prefix = t(err instanceof BoardError ? "fehler" : "unerwarteterFehler");
    process.stderr.write(`${prefix}: ${err.message}\n`);
    process.exit(1);
  }
}

