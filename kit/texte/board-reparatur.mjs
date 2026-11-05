// SPDX-License-Identifier: MIT
/**
 * texte/board-reparatur.mjs — die Texttabelle von board/reparatur.mjs (Issue #2092, Plan #2087,
 * A7, E4). Eigener Teil, damit `sonar.cpd.exclusions` die gleich gebauten Haelften de und en
 * ausnehmen kann, ohne die Logik des Moduls aus der Duplikatsmessung zu nehmen.
 *
 * Vertragswerte bleiben ausserhalb: die Zeilen `Reparatur:` und `Plan:` (kit/board/namen.mjs),
 * die Ueberschriften der vier Abschnitte und die Felder der Rueckgabe.
 */

export const TEXTE = Object.freeze({
  de: Object.freeze({
    titel: "Reparatur: {was} (Plan #{plan})",
    titelOhnePlan: "Reparatur: {was}",
    kontextEinleitung: "Der Prüflauf ist rot: {was}. Die Pakete bleiben in ihrer Spalte; diese Karte behebt den Fund.",
    fundKopf: "Fund im Wortlaut:",
    verursacher: "Verursacht durch: {pakete}",
    verursacherKeine: "Verursacht durch: nicht bestimmbar",
    hinweis: "Hinweis: {hinweis}",
    protokoll: "Protokoll: {pfad}",
    aufgabe: "Die Prüfung `{cmd}` wieder grün machen, ohne die verursachenden Pakete zurückzunehmen.",
    akzeptanz: "`{cmd}` endet grün.",
    keine: "Keine.",
    kommentarKopf: "## Reparatur: Fund erneut gemeldet",
    kommentarEinleitung: "Der Prüflauf meldet `{cmd}` erneut rot.",
    kommentarZurueck: "Die Karte lag in In review und geht zurück nach Backlog: Sie braucht ein neues GO.",
    summaryFehlt: "issue repair braucht --summary <datei> oder --ci <sha>",
    summaryUndCi: "issue repair nimmt --summary oder --ci, nicht beides",
    ciLaeuft: "Der Build-Dienst läuft für {sha} noch; issue repair --ci erst nach seinem Urteil.",
    handgriffOhneZeile: "Der Job {job} ist rot, ohne dass eine Prüfung lief: Protokoll ansehen ({adresse}), die Umgebung richten und den Build-Dienst erneut starten.",
    keineAdresse: "keine Adresse",
    summaryUnlesbar: "Die Zusammenfassung {datei} ist nicht lesbar: {grund}",
    boardGescheitert: "board.mjs {befehl} scheiterte: {grund}",
  }),
  en: Object.freeze({
    titel: "Repair: {was} (plan #{plan})",
    titelOhnePlan: "Repair: {was}",
    kontextEinleitung: "The check run is red: {was}. The packages stay in their column; this card fixes the finding.",
    fundKopf: "Finding verbatim:",
    verursacher: "Caused by: {pakete}",
    verursacherKeine: "Caused by: not determinable",
    hinweis: "Note: {hinweis}",
    protokoll: "Log: {pfad}",
    aufgabe: "Make the check `{cmd}` green again without taking back the causing packages.",
    akzeptanz: "`{cmd}` ends green.",
    keine: "None.",
    kommentarKopf: "## Repair: finding reported again",
    kommentarEinleitung: "The check run reports `{cmd}` red again.",
    kommentarZurueck: "The card was in In review and goes back to Backlog: it needs a new GO.",
    summaryFehlt: "issue repair needs --summary <file> or --ci <sha>",
    summaryUndCi: "issue repair takes --summary or --ci, not both",
    ciLaeuft: "The build service is still running for {sha}; issue repair --ci only after its verdict.",
    handgriffOhneZeile: "The job {job} is red without any check having run: read the log ({adresse}), fix the environment and restart the build service.",
    keineAdresse: "no address",
    summaryUnlesbar: "The summary {datei} cannot be read: {grund}",
    boardGescheitert: "board.mjs {befehl} failed: {grund}",
  }),
});
