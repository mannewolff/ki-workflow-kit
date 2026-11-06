// SPDX-License-Identifier: MIT
/**
 * board/config-anzeige.mjs — die Anzeigenamen der Einstellungen in der App (Issue #1950, Plan #1939
 * A15, A16, E6, Kriterium 18 aus #1937).
 *
 * Die Einstellungs-Oberflaeche aus kit/settings.mjs zeigt mit `--app` Abschnitte, Teile und
 * Einstellungen unter Namen in Alltagssprache statt unter ihren englischen Namen; die Namen in
 * den Dateien bleiben, wie sie sind. Beide Sprachen stehen in dieser einen Datei (E6), damit keine
 * zweite gleich gebaute Tabelle entsteht.
 *
 * Schluessel einer Einstellung ist ihr englischer Pfad, wie die Datei ihn schreibt
 * (`night.chain`, `app.brand.accent`). Abschnitte sind die Teile nach Zweck aus
 * config-teile.mjs, Teile die Kennungen aus `TEILE` in kit/settings.mjs.
 * test/app-texte.test.mjs haelt die Namen frei von Entwicklerbegriffen und verlangt fuer jede
 * Einstellung, die die Oberflaeche zeigt, einen Namen in beiden Sprachen.
 *
 * Dieses Modul importiert nichts, damit tools/sync-blobs.mjs es in kit/settings.mjs einbetten
 * kann.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

const paar = (de, en) => Object.freeze({ de, en });

/**
 * Je Teil nach Zweck sein Name, wie die Doku-Seite zu den Einstellungen ihn als Ueberschrift
 * fuehrt (Issue #2193, Plan #2022 E2): Die ersten drei sind die Teile der Oberflaeche,
 * „Vom Kit verwaltet“ steht als Kennzeichen am Ende von „Feinabstimmung“ (E1).
 */
export const ABSCHNITTE = Object.freeze({
  einrichten: paar("Beim Einrichten nötig", "Needed at setup"),
  lohnt: paar("Lohnt sich", "Worth setting"),
  fein: paar("Feinabstimmung", "Fine-tuning"),
  verwaltet: paar("Vom Kit verwaltet", "Managed by the kit"),
});

/** Die Ueberschriften der zusammengefassten Teile je Kennung. */
export const TEILE = Object.freeze({
  m1: paar("Prüfende KI-Modelle", "Reviewing AI models"),
  m2: paar("Wer wen prüft", "Who reviews whom"),
  m3: paar("Prüfstufen", "Review stages"),
  m10: paar("Wiederkehrende Funde", "Recurring findings"),
  m4: paar("Prüfungen und Bereiche", "Checks and areas"),
  m6: paar("Automatischer Durchlauf", "Automatic run"),
  m8: paar("Aufwand", "Workload"),
  m9: paar("Wirksamkeit der Prüfungen", "Effectiveness of checks"),
  m11: paar("KI je Schwierigkeit", "AI per difficulty"),
});

/** Je englischem Pfad einer Einstellung ihr Anzeigename. */
export const EINSTELLUNGEN = Object.freeze({
  language: paar("Sprache des Projekts", "Project language"),
  codeHost: paar("Ablage der Arbeit", "Where the work is stored"),
  issueTracker: paar("Ort der Aufgabenliste", "Where tasks are tracked"),
  provider: paar("Früherer Ablageort", "Former storage place"),
  buildChecks: paar("Prüfungen vor dem Abschluss", "Checks before completion"),
  checkAreas: paar("Bereiche des Projekts", "Project areas"),
  noCheck: paar("Dateien ohne Prüfung", "Files without checks"),
  coupledAreas: paar("Eng verbundene Bereiche", "Closely linked areas"),
  testLocations: paar("Ablage der Tests", "Where tests are kept"),
  scaffoldOnly: paar("Nur vorbereitete Dateien", "Prepared-only files"),
  mutationCommand: paar("Gründliche Testprüfung", "Thorough test check"),
  mutationQuality: paar("Marke des Mutationstests", "Mutation test threshold"),
  strictness: paar("Strenge", "Strictness"),
  strictnessOverrides: paar("Abweichungen von der Strenge", "Deviations from the strictness"),
  "strictnessOverrides.pushScope": paar("Umfang der Prüfung vor dem Teilen", "Scope of checks before sharing"),
  "strictnessOverrides.mutation": paar("Mutationstest vor dem Teilen", "Mutation test before sharing"),
  "strictnessOverrides.quality": paar("Gütemessung als Pflicht", "Quality measurement required"),
  "strictnessOverrides.security": paar("Zeitpunkt der Sicherheitsprüfung", "When the security check runs"),
  "strictnessOverrides.reviewers": paar("Zahl der Prüfer", "Number of reviewers"),
  "strictnessOverrides.deliveryCatchUp": paar("Vor dem Betrieb nachholen", "Catch up before going live"),
  qualityCommands: paar("Qualitätsmessungen", "Quality measurements"),
  formatFixCommand: paar("Automatische Formatierung", "Automatic formatting"),
  installCommand: paar("Einrichten der Abhängigkeiten", "Setting up dependencies"),
  mainBranch: paar("Gemeinsamer Arbeitsstand", "Shared working state"),
  productionBranch: paar("Stand für den Betrieb", "Live state"),
  commitGate: paar("Prüfung beim Festhalten der Arbeit", "Check when work is saved"),
  hotfixMinutes: paar("Zieldauer einer schnellen Behebung", "Target time for a quick fix"),
  runsInstance: paar("Laufender Betrieb vorhanden", "Live system in operation"),
  pushCheck: paar("Ort der Prüfung vor dem Teilen", "Where checks run before sharing"),
  "pushCheck.machine": paar("Name dieses Rechners beim Prüfen", "Name of this computer when checking"),
  release: paar("Neue Version beim Prüfen", "New version when checking"),
  "release.commands": paar("Schritte für Version und Änderungsliste", "Steps for version and change list"),
  "release.publishCommands": paar("Schritte für Version und Änderungsliste beim Veröffentlichen", "Steps for version and change list when publishing"),
  reviewScope: paar("Umfang der Durchsicht", "Scope of the review"),
  reviewModel: paar("KI für die Durchsicht", "AI for the review"),
  reviewCommand: paar("Anderes Werkzeug für die Durchsicht", "Other tool for the review"),
  reviewReadLimit: paar("Nur-Lesen-Schutz der Durchsicht", "Read-only protection for the review"),
  triggers: paar("Sätze für die Freigaben", "Approval phrases"),
  "triggers.go": paar("Satz für „Umsetzung starten“", "Phrase for “Start implementation”"),
  "triggers.push": paar("Satz für „An das Team geben“", "Phrase for “Share with team”"),
  "triggers.merge": paar("Satz für „In den Betrieb übernehmen“", "Phrase for “Go live”"),
  "triggers.hotfix": paar("Satz für „Schnell beheben“", "Phrase for “Quick fix”"),
  "triggers.rollback": paar("Satz für „Zur Vorversion zurück“", "Phrase for “Back to previous version”"),
  local: paar("Aufgabenliste auf diesem Rechner", "Task list on this computer"),
  "local.issuesDir": paar("Ordner der Aufgaben", "Task folder"),
  columns: paar("Spalten der Aufgabentafel", "Columns of the task board"),
  "columns.backlog": paar("Spalte für Wartendes", "Column for waiting work"),
  "columns.ready": paar("Spalte für Freigegebenes", "Column for approved work"),
  "columns.in_progress": paar("Spalte für Laufendes", "Column for work in progress"),
  "columns.in_review": paar("Spalte zum Prüfen", "Column for work to check"),
  "columns.done": paar("Spalte für Erledigtes", "Column for finished work"),
  github: paar("Aufgabentafel im Netz", "Online task board"),
  "github.projectNumber": paar("Nummer der Aufgabentafel", "Task board number"),
  toolbox: paar("Eigene Aufgabentafel", "Own task board"),
  "toolbox.host": paar("Adresse der Aufgabentafel", "Task board address"),
  "toolbox.tokenFile": paar("Datei mit dem Zugangsschlüssel", "File with the access key"),
  "issueReview.requiredBeforeReady": paar("Prüfung vor der Freigabe verlangen", "Require a review before approval"),
  "issueReview.reviewers": paar("Prüfende KI-Modelle", "Reviewing AI models"),
  "issueReview.pairs": paar("Wer wen prüft", "Who reviews whom"),
  reviewStages: paar("Prüfstufen", "Review stages"),
  "reviewStages.requirement": paar("Anforderung", "Requirement"),
  "reviewStages.plan": paar("Umsetzungsplan", "Implementation plan"),
  "reviewStages.issue": paar("Aufgabe", "Task"),
  "night.chain": paar("Automatischer Durchlauf", "Automatic run"),
  "night.status": paar("Anzeige des Stands", "Status display"),
  "night.model": paar("KI für unbeaufsichtigte Arbeit", "AI for unattended work"),
  "night.models": paar("Verfügbare KI-Modelle", "Available AI models"),
  "night.tiers": paar("KI je Schwierigkeit", "AI per difficulty"),
  "night.tiers.hard": paar("Schwere Aufgaben", "Hard tasks"),
  "night.tiers.medium": paar("Mittlere Aufgaben", "Medium tasks"),
  "night.tiers.easy": paar("Leichte Aufgaben", "Easy tasks"),
  "night.tierRule": paar("Regel für die Schwierigkeit", "Difficulty rule"),
  "night.stuckAfter": paar("Anhalten nach wiederholtem Scheitern", "Stop after repeated failures"),
  "night.goalImplementationMin": paar("Zieldauer einer Umsetzung", "Target time per implementation"),
  "night.concurrentPackages": paar("Gleichzeitige Aufgaben", "Tasks at the same time"),
  "night.implementationNightMin": paar("Zeitrahmen eines Umsetzungslaufs", "Implementation run time limit"),
  "night.implementationCostUsd": paar("Kostenrahmen je Umsetzung", "Cost limit per implementation"),
  "night.logRetentionDays": paar("Aufbewahrung der Protokolle", "How long records are kept"),
  checkRun: paar("Täglicher Prüfdurchlauf", "Daily review run"),
  "checkRun.label": paar("Kennzeichen für den Prüfdurchlauf", "Marker for the review run"),
  "checkRun.checkMin": paar("Zeitrahmen je Prüfung", "Time limit per review"),
  "checkRun.costUsd": paar("Kostenrahmen je Durchlauf", "Cost limit per run"),
  workload: paar("Aufwand", "Workload"),
  effectiveness: paar("Wirksamkeit der Prüfungen", "Effectiveness of checks"),
  findings: paar("Wiederkehrende Funde", "Recurring findings"),
  history: paar("Frühere Anforderungen suchen", "Look up earlier requirements"),
  scenariosFrom: paar("Szenarien verlangt ab", "Scenarios required from"),
  contractRepos: paar("Partnerprojekte", "Partner projects"),
  "app.brand": paar("Marke des Kunden", "Customer brand"),
  "app.brand.name": paar("Name der App", "App name"),
  "app.brand.logo": paar("Logo", "Logo"),
  "app.brand.accent": paar("Akzentfarbe", "Accent colour"),
  "app.brand.accentDark": paar("Akzentfarbe im Dunkelmodus", "Accent colour in dark mode"),
  "app.publish": paar("Sätze zum Veröffentlichen", "Publishing sentences"),
  "app.publish.team": paar("Satz zu „An das Team geben“", "Sentence for “Share with team”"),
  "app.publish.production": paar("Satz zu „In den Betrieb übernehmen“", "Sentence for “Go live”"),
  "app.controlCenterUrl": paar("Adresse des Leitstands", "Control center address"),
  "app.quickFix": paar("Rahmen für „Gleich erledigen“", "Limit for “Do it now”"),
  "app.quickFix.timeMin": paar("Zeitrahmen", "Time limit"),
  "app.quickFix.costUsd": paar("Kostenrahmen", "Cost limit"),
  "app.priorities": paar("Prioritäten", "Priorities"),
});

const SPRACHEN = new Set(["de", "en"]);

/** Die Namen einer Tabelle in einer Sprache; eine unbekannte Sprache faellt auf Deutsch. */
const inSprache = (tabelle, sprache) =>
  Object.fromEntries(Object.entries(tabelle).map(([schluessel, namen]) => [schluessel, namen[SPRACHEN.has(sprache) ? sprache : "de"]]));

/** Alle Anzeigenamen in einer Sprache: `{ abschnitte, teile, einstellungen }`, je Schluessel ein Text. */
export function anzeigeNamen(sprache) {
  return { abschnitte: inSprache(ABSCHNITTE, sprache), teile: inSprache(TEILE, sprache), einstellungen: inSprache(EINSTELLUNGEN, sprache) };
}
