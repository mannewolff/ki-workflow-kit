// SPDX-License-Identifier: MIT
/**
 * texte/board-arbeitskopie.mjs — die Texttabelle von board/arbeitskopie.mjs (Issue #1858). Eigener
 * Teil, damit `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne
 * die Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

// --- Texte an den Menschen (Issue #1858, Plan #1853 E3) ---
//
// Verschoben aus kit/texte/night-kitstand.mjs und kit/texte/night-grundlagen.mjs, mit den
// Funktionen, die sie ausgeben. Vertrag bleibt: die Feldnamen der Rueckgaben, die Laufzeitpfade
// unter `.claude/` und der Name des Test-Hakens `kitstandAbhaengigkeiten`.
export const TEXTE = Object.freeze({
  de: Object.freeze({
    abhaengigkeitUnbekannt: "kitstandAbhaengigkeiten kennt keine Abhaengigkeit '{name}'",
    sperreGehalten: "{sperre} wird gehalten (Prozess {pid}) — in der Hauptkopie arbeitet ein Lauf des Runners",
    hauptkopieReste: "die Hauptkopie traegt unkommittierte Aenderungen: {reste}",
    keineVorbereitung: "keine vorbereitete Veroeffentlichung ({datei} fehlt oder ist unlesbar)",
    pruefzweigOffenUnlesbar: "{datei} ist unlesbar: {grund}",
    pruefzweigOffenUnvollstaendig: "{datei} nennt nicht zweig und commit",
    worktreeAddFehlgeschlagen: "git worktree add schlug fehl: {meldung}",
    kennungUnbekannt: "unbekannte Commit-Kennung: {commit}",
    befundeNichtZurueck: "Hinweis: Befunde aus dem Worktree nicht zurueckgeholt ({ziel}): {fehler} — der Abbau geht weiter.",
    gitStatusFehler: "git status schlug fehl — bin ich im Projekt-Root eines git-Repos?",
  }),
  en: Object.freeze({
    abhaengigkeitUnbekannt: "kitstandAbhaengigkeiten knows no dependency '{name}'",
    sperreGehalten: "{sperre} is held (process {pid}) — a run of the runner is working in the main copy",
    hauptkopieReste: "the main copy has uncommitted changes: {reste}",
    keineVorbereitung: "no prepared release ({datei} is missing or unreadable)",
    pruefzweigOffenUnlesbar: "{datei} is unreadable: {grund}",
    pruefzweigOffenUnvollstaendig: "{datei} does not name zweig and commit",
    worktreeAddFehlgeschlagen: "git worktree add failed: {meldung}",
    kennungUnbekannt: "unknown commit id: {commit}",
    befundeNichtZurueck: "Note: findings not brought back from the worktree ({ziel}): {fehler} — the teardown continues.",
    gitStatusFehler: "git status failed — am I in the project root of a git repository?",
  }),
});
