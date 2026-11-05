// SPDX-License-Identifier: MIT
/**
 * texte/night-grundlagen.mjs — die Texttabelle von night/grundlagen.mjs (Issue #1525). Eigener Teil, damit
 * `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne die
 * Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

// --- Texte an den Menschen (Issue #1485, Plan #1420 E13/E14) ---

// Die Abbruchzeile `Fehler:` und der Satz zu einem leeren Ready nehmen englisch genau die
// Form der kanban-kit-Vorlage am Plan #1420 (`Error:`, `Ready is empty — nothing to do.`).
// Vertrag bleibt (E14): die Fehlerklassen von fail(), die Feldnamen und Werte des
// Ergebnisstands, die Ausnahmen des Rest-Guards.
export const TEXTE = Object.freeze({
  de: Object.freeze({
    verboseWert: "--verbose kennt nur die Werte no und yes (gelesen: {wert}) — ohne Wert bleibt es beim Vorgabewert yes.",
    entfallenesFlag: "{flag} gibt es seit Stufe 2 nicht mehr; die Kette ist --chain{zusatz}.",
    entfallenesFlagStufe: ", und die Kette hat keine Stufen",
    unbekanntesArgument: "Unbekanntes Argument: {argument} — siehe --help",
    altname: "unbekannt: '{name}' — englischer Name: '{englisch}'",
    kettePruefen: "--chain und --check sind zwei Laeufe mit eigenen Budgets — bitte einzeln starten.",
    pruefenDryRun: "Der Prueflauf hat keine Vorschau — `/issue-review --dry-run` zeigt Dokumente und Reviewer.",
    ketteLabel: "--chain kennt kein --label — das Kettenlabel steht in night.kette.label der workflow.config.json.",
    pruefenLabel: "--check kennt kein --label — das Kennzeichen steht in pruefLauf.label der workflow.config.json.",
    maxZahl: "--max braucht eine Zahl >= 1",
    timeoutZahl: "--timeout-min braucht eine Zahl >= 1",
    ganzeZahl: "{flag} braucht eine ganze Zahl >= 1",
    karteOhneKette: "--card gilt nur mit --chain — es startet den automatischen Durchlauf fuer genau diese Karte.",
    karteNummer: "--card braucht eine Kartennummer (etwa --card 42)",
    vorbereitenAllein: "--prepare faehrt nur die Vorbereitung — ohne --chain, --check und --dry-run.",
    losloesenDryRun: "--detach startet einen Lauf losgeloest — der Dry-Run startet nichts.",
    kartenpruefungAllein: "--card-check faehrt nur die Pruefung je Karte — ohne --chain, --check, --prepare und --dry-run.",
    reparaturAllein: "--repair setzt genau eine Reparaturkarte um — ohne --chain, --check, --prepare, --card-check und --dry-run.",
    reparaturNummer: "--repair braucht eine Kartennummer (etwa --repair 42)",
    nochmalOhneKartenpruefung: "--again gilt nur mit --card-check.",
    schrittprotokollFehler: "Schrittprotokoll konnte nicht geschrieben werden: {fehler} — die Zeilen stehen weiter im Tagesprotokoll.",
    fehlerZeile: "Fehler: {meldung}",
    resteKeine: "keine unkommittierten Reste",
    resteViele: "{anzahl} unkommittierte Reste, die ersten zehn: {liste}",
    resteWenige: "unkommittierte Reste: {liste}",
    ersatzGrund: "Kein Grund ermittelbar — der Lauf ist hart gestoppt, ohne dass ein Abbruchweg "
      + "seinen Grund hinterlegt hat. Der Weg steht im Textprotokoll daneben; bitte melden.",
    ankerFehlt: "(Der Uebergabe-Anker fehlte: Dieser Text stammt aus dem zuletzt gemerkten harten "
      + "Stopp, nicht von der betroffenen Einheit und nicht vom Lauf. Bitte melden.)",
    ohneArbeitUnbekannt: "Kein Grund ermittelbar — der Lauf endete ohne eine Session, ohne dass ein "
      + "benannter Fall zutraf. Der Weg steht im Textprotokoll daneben; bitte melden.",
    readyLeer: "Ready ist leer — nichts zu tun.",
    keinLabel: "Keine der {anzahl} Karten in Ready traegt das Label '{label}' — nichts zu tun.",
    alleZurueckgestellt: "Alle {anzahl} Karten in Ready wurden am Gate zurueckgestellt — der Lauf hat Ready selbst "
      + "geleert, es blieb nichts zu tun.",
    umsetzungBelegt: "Die Umsetzung ist belegt: {grund} — der Lauf endet ohne Paket.",
    nachtgrenze: "Laufgrenze erreicht: Die Restzeit von {rest} min reicht nicht fuer ein Paket samt Pruefung ({bedarf} min) — kein Paket begonnen.",
    ketteKeinLabel: "Keine Kette zu fahren: keine Karte traegt das Label '{label}'.",
    ketteAlleUebersprungen: "Keine Kette zu fahren: alle {anzahl} gekennzeichneten Karten mit dem Label '{label}' "
      + "wurden uebersprungen, weil eine Voraussetzung fehlt.",
    pruefLaufKeinLabel: "Nichts zu pruefen: keine Karte traegt das Label '{label}'.",
    pruefLaufAlleUebersprungen: "Nichts zu pruefen: alle {anzahl} gekennzeichneten Karten mit dem Label '{label}' "
      + "wurden uebersprungen, weil sie keine fachliche Anforderung sind oder eine Entscheidung wartet.",
    einlieferungPruefung: "Einlieferung entfaellt: die Lauf-Art 'pruefung' hat keine Schnittstelle fuer den automatischen Lauf — der Ergebnisstand bleibt als Datei.",
    einlieferungTracker: "Einlieferung entfaellt: issueTracker '{tracker}' kennt keine Schnittstelle fuer den automatischen Lauf — der Ergebnisstand bleibt als Datei.",
    einlieferungFehlgeschlagen: "Einlieferung fehlgeschlagen: {fehler} — der Ergebnisstand bleibt als Datei.",
    eingeliefert: "Lauf eingeliefert ({outcome}).",
    ohneRueckmeldung: "ohne Rueckmeldung",
    stempelFehler: "Lauf-Stempel {stempel}: {fehler}",
    stempelVergeben: "Lauf-Stempel {stempel} auch nach {anzahl} Neubildungen schon vergeben",
    ergebnisstandFehler: "Ergebnisstand konnte nicht geschrieben werden: {fehler}",
    zitatGekuerzt: "{text}… ({anzahl} Zeichen gekürzt)",
    signal: "Signal {signal}",
    boardFehlgeschlagen: "board.mjs {aufruf} schlug fehl{zusatz}: {zitat}",
    zweiterVersuch: "{text} (auch im 2. Versuch)",
    boardKeinJson: "board.mjs {aufruf} lieferte kein JSON: {ausgabe}",
    hinweis: "Hinweis: {hinweis}",
    lokalUngueltig: "{pfad} ist kein gueltiges JSON und wird ignoriert.",
    feldTeamweit: "'{feld}' aus workflow.config.local.json wird ignoriert — das Feld gilt teamweit.",
  }),
  en: Object.freeze({
    verboseWert: "--verbose only knows the values no and yes (read: {wert}) — without a value it stays at the default yes.",
    entfallenesFlag: "{flag} no longer exists since stage 2; the chain is --chain{zusatz}.",
    entfallenesFlagStufe: ", and the chain has no stages",
    unbekanntesArgument: "Unknown argument: {argument} — see --help",
    altname: "unknown: '{name}' — English name: '{englisch}'",
    kettePruefen: "--chain and --check are two runs with their own budgets — please start them separately.",
    pruefenDryRun: "The check run has no preview — `/issue-review --dry-run` shows documents and reviewers.",
    ketteLabel: "--chain does not know --label — the chain label is in night.kette.label of workflow.config.json.",
    pruefenLabel: "--check does not know --label — the marker label is in pruefLauf.label of workflow.config.json.",
    maxZahl: "--max needs a number >= 1",
    timeoutZahl: "--timeout-min needs a number >= 1",
    ganzeZahl: "{flag} needs a whole number >= 1",
    karteOhneKette: "--card only applies with --chain — it starts the automatic run for exactly this card.",
    karteNummer: "--card needs a card number (e.g. --card 42)",
    vorbereitenAllein: "--prepare runs only the preparation — without --chain, --check and --dry-run.",
    losloesenDryRun: "--detach starts a run detached — the dry run starts nothing.",
    kartenpruefungAllein: "--card-check runs only the card check — without --chain, --check, --prepare and --dry-run.",
    reparaturAllein: "--repair implements exactly one repair card — without --chain, --check, --prepare, --card-check and --dry-run.",
    reparaturNummer: "--repair needs a card number (e.g. --repair 42)",
    nochmalOhneKartenpruefung: "--again applies only with --card-check.",
    schrittprotokollFehler: "Step log could not be written: {fehler} — the lines remain in the daily log.",
    fehlerZeile: "Error: {meldung}",
    resteKeine: "no uncommitted leftovers",
    resteViele: "{anzahl} uncommitted leftovers, the first ten: {liste}",
    resteWenige: "uncommitted leftovers: {liste}",
    ersatzGrund: "No reason could be determined — the run stopped hard without any abort path "
      + "leaving its reason. The path is in the text log next to it; please report.",
    ankerFehlt: "(The handover anchor was missing: this text comes from the most recently noted hard "
      + "stop, not from the affected unit and not from the run. Please report.)",
    ohneArbeitUnbekannt: "No reason could be determined — the run ended without a session, without any "
      + "named case applying. The path is in the text log next to it; please report.",
    readyLeer: "Ready is empty — nothing to do.",
    keinLabel: "None of the {anzahl} cards in Ready carries the label '{label}' — nothing to do.",
    alleZurueckgestellt: "All {anzahl} cards in Ready were deferred at the gate — the run emptied Ready "
      + "itself, nothing was left to do.",
    umsetzungBelegt: "The implementation is occupied: {grund} — the run ends without a package.",
    nachtgrenze: "Run limit reached: the remaining {rest} min do not suffice for a package with its check ({bedarf} min) — no package started.",
    ketteKeinLabel: "No chain to run: no card carries the label '{label}'.",
    ketteAlleUebersprungen: "No chain to run: all {anzahl} marked cards with the label '{label}' "
      + "were skipped because a prerequisite is missing.",
    pruefLaufKeinLabel: "Nothing to check: no card carries the label '{label}'.",
    pruefLaufAlleUebersprungen: "Nothing to check: all {anzahl} marked cards with the label '{label}' "
      + "were skipped because they are not requirements or a decision is pending.",
    einlieferungPruefung: "Delivery skipped: the run type 'pruefung' has no interface for the automatic run — the result file remains as a file.",
    einlieferungTracker: "Delivery skipped: issueTracker '{tracker}' has no interface for the automatic run — the result file remains as a file.",
    einlieferungFehlgeschlagen: "Delivery failed: {fehler} — the result file remains as a file.",
    eingeliefert: "Run delivered ({outcome}).",
    ohneRueckmeldung: "no response",
    stempelFehler: "Run stamp {stempel}: {fehler}",
    stempelVergeben: "Run stamp {stempel} still taken after {anzahl} rebuilds",
    ergebnisstandFehler: "Result file could not be written: {fehler}",
    zitatGekuerzt: "{text}… ({anzahl} characters truncated)",
    signal: "signal {signal}",
    boardFehlgeschlagen: "board.mjs {aufruf} failed{zusatz}: {zitat}",
    zweiterVersuch: "{text} (also in the 2nd attempt)",
    boardKeinJson: "board.mjs {aufruf} returned no JSON: {ausgabe}",
    hinweis: "Note: {hinweis}",
    lokalUngueltig: "{pfad} is not valid JSON and is ignored.",
    feldTeamweit: "'{feld}' from workflow.config.local.json is ignored — the field applies team-wide.",
  }),
});
