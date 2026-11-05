// SPDX-License-Identifier: MIT
/**
 * texte/board-pro.mjs — die Texttabelle von board/pro.mjs (Issue #1855) und der Grenze aus
 * board/ausgabe.mjs (Issue #1867). Eigener Teil, damit
 * `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne die
 * Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

// ============================================================
// Texte an den Menschen (Issue #1855, Plan #1853 E1, E2)
// ============================================================

/**
 * Die Meldungen des Laders je Sprache. Vertragswerte bleiben ausserhalb: die Befehle `run` und
 * `list`, die Namen der Auswertungen (`effort`, `effectiveness`, `findings`) und der Teile und
 * die Feldnamen der Liste.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    nichtInstalliert: "{auswertung}: nicht installiert",
    auswertung_effort: "Aufwand",
    auswertung_effectiveness: "Wirksamkeit",
    auswertung_findings: "Befunde",
    auswertung_app: "Desktop-App",
    teilUnbekannt: "pro run kennt die Auswertung '{teil}' nicht. Zulaessig: {zulaessig}",
    teilFehlt: "pro run braucht eine Auswertung. Zulaessig: {zulaessig}",
    proUnbekannt: "Unbekannter pro-Befehl: '{befehl}'. Erwartet: run | list",
    teilNichtInListe: "Kein Pro-Teil '{teil}'. Bekannt: {bekannt}",
    // Die Grenze zu Pro (Issue #1867, Plan #1866 E4, E9, E14)
    proMeldung: "{funktion} gehört zu Pro, dem Teil des Kits für unbeaufsichtigte Läufe und den Betrieb im Unternehmen. Mehr dazu und Kontakt: {url}",
    funktion_app: "Die Desktop-App",
    funktion_doctor: "Die Prüfung der Einrichtung mit doctor",
    funktion_update: "Das eigene Aktualisieren mit update",
    funktion_parallel: "Das gleichzeitige Umsetzen mehrerer Pakete",
    "funktion_check-slots": "Die Plätze für volle Prüfläufe je Rechner",
    "funktion_build-verdict": "Die Übernahme des Urteils des Build-Diensts in push main",
    funktion_hotfix: "Der Hotfix mit hotfix production",
    funktion_rollback: "Das Zurückkehren zur Vorversion mit rollback production",
    uebergangen: "Übergangene Pro-Einstellungen (wirken nur mit Pro): {namen}",
    funktionUnbekannt: "edition gate kennt die Funktion '{funktion}' nicht. Zulässig: {zulaessig}",
    funktionFehlt: "edition gate braucht eine Funktion. Zulässig: {zulaessig}",
    editionUnbekannt: "Unbekannter edition-Befehl: '{befehl}'. Erwartet: show | gate",
  }),
  en: Object.freeze({
    nichtInstalliert: "{auswertung}: not installed",
    auswertung_effort: "Effort",
    auswertung_effectiveness: "Effectiveness",
    auswertung_findings: "Findings",
    auswertung_app: "Desktop app",
    teilUnbekannt: "pro run does not know the evaluation '{teil}'. Allowed: {zulaessig}",
    teilFehlt: "pro run needs an evaluation. Allowed: {zulaessig}",
    proUnbekannt: "Unknown pro command: '{befehl}'. Expected: run | list",
    teilNichtInListe: "No pro part '{teil}'. Known: {bekannt}",
    // The boundary to Pro (Issue #1867, Plan #1866 E4, E9, E14)
    proMeldung: "{funktion} is part of Pro, the part of the kit for unattended runs and operation in a company. More and contact: {url}",
    funktion_app: "The desktop app",
    funktion_doctor: "Checking the setup with doctor",
    funktion_update: "Updating with update",
    funktion_parallel: "Implementing several packages at the same time",
    "funktion_check-slots": "The slots for full check runs per machine",
    "funktion_build-verdict": "Taking over the verdict of the build service in push main",
    funktion_hotfix: "The hotfix with hotfix production",
    funktion_rollback: "Returning to the previous version with rollback production",
    uebergangen: "Pro settings passed over (only effective with Pro): {namen}",
    funktionUnbekannt: "edition gate does not know the function '{funktion}'. Allowed: {zulaessig}",
    funktionFehlt: "edition gate needs a function. Allowed: {zulaessig}",
    editionUnbekannt: "Unknown edition command: '{befehl}'. Expected: show | gate",
  }),
});
