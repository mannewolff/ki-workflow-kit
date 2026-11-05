#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Das Commit-Gate (Issue #470, Plan #467).
//
// Ein Commit entsteht nur, wenn jede Datei, die in ihn geht, beim gruenen
// Prueflauf denselben Inhalt trug. Der Nachweis steht in der Zusammenfassung, die
// `checks.mjs run` hinterlaesst; verglichen wird gegen den INDEX, nicht gegen den
// Working Tree — der Commit schreibt den Index, und die implement-Skills stagen
// ausdruecklich selektiv.
//
// Warum ein Git-Hook und kein Kit-Kommando: Kein Kit-Code committet. Jeder Commit
// im Workflow entsteht dadurch, dass eine Session Skill-Text befolgt. Nur git
// sieht jeden Commit, gleich welches Werkzeug ihn ausloest — auch ein
// selbstgebautes Hilfsskript.
//
// Die Zusicherung ist bewusst die schwaechere: Jede committete Datei war Teil
// eines gruenen Laufs. NICHT: Der committete Stand als Ganzes wurde geprueft. Wer
// A committet und das dazugehoerige B ungestagt liegen laesst, erzeugt einen
// Stand, den so nie jemand geprueft hat (Plan #467, A3).
//
// `commit-msg` prueft dazu einen Commit, der die Config aendert, auf eine Absenkung der
// Strenge (Issue #2109, Plan #2102 A11).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const HILFE = "node .claude/kit/checks.mjs run";

/**
 * Die Texte des Gates in beiden Sprachen (Issue #1458, Plan #1420 E13). Das Gate laeuft in
 * jedem Projekt allein und importiert nur Node-Bordmittel; es traegt seine Tabelle deshalb
 * selbst, statt den Texthelfer aus kit/board/namen.mjs zu laden. Vertragswerte wie das
 * Ergebnis einer Pruefung (`rot`) und die Option `--area` gehen unuebersetzt ein (E14).
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    abgewiesen: "Commit abgewiesen — {grund}.\n  {hilfe}\n",
    abgewiesenPfad: "Commit abgewiesen — {pfad}: {grund}.\n  {hilfe}\n",
    checksFehlt: "checks.mjs liegt weder unter .claude/kit/ noch unter kit/ — bitte den Installer laufen lassen",
    zusammenfassungFehlt: "die Pruef-Zusammenfassung fehlt",
    zusammenfassungUnlesbar: "die Pruef-Zusammenfassung ist unlesbar",
    altesFormat: "die Pruef-Zusammenfassung hat ein altes Format ohne hashes — bitte den Installer laufen lassen",
    gitFehler: "{kommando} schlug fehl: {fehler}",
    pruefungEndete: "die Pruefung endete {ergebnis} ({cmd})",
    bereichslauf: "die Pruefung lief eingegrenzt auf den Bereich '{bereich}' und deckt den Commit nicht — bitte '{hilfe}' ohne --area fahren",
    loeschungNichtGeprueft: "Loeschung nicht geprueft",
    nichtGeprueft: "nicht geprueft",
    geaendert: "nach der Pruefung geaendert",
    einzigesKommando: "gate.mjs: Kommandos sind 'pre-commit', 'commit-msg', 'post-commit' und 'post-merge'.\n",
    nichtGestartet: "{hook}: Kartenpruefung nicht gestartet — {grund}\n",
    exitCode: "Exit {status}",
    strengeModulFehlt: "board/strenge.mjs liegt weder unter .claude/kit/ noch unter kit/ — bitte den Installer laufen lassen",
    configUnlesbar: "Commit abgewiesen — {pfad} im Commit ist kein gueltiges JSON; ob er die Strenge abschwaecht, laesst sich so nicht pruefen.\n",
    strengeAbgewiesen: "Commit abgewiesen — er schwaecht die Strenge des Projekts ab:\n{liste}\n"
      + "  Die Strenge und jede Einstellung, die eine von ihr verlangte Pruefung abschwaecht, aendert nur ein Mensch; "
      + "ein unbeaufsichtigter Lauf (KIT_AGENT_MODEL gesetzt) committet keine Absenkung.\n",
    strengeOhneZeile: "Commit abgewiesen — er schwaecht die Strenge des Projekts ab:\n{liste}\n"
      + "  Eine Absenkung braucht in der Commit-Nachricht die Zeile 'Strenge: <alt> -> <neu> (<Urheber>)'.\n",
  }),
  en: Object.freeze({
    abgewiesen: "Commit rejected — {grund}.\n  {hilfe}\n",
    abgewiesenPfad: "Commit rejected — {pfad}: {grund}.\n  {hilfe}\n",
    checksFehlt: "checks.mjs is in neither .claude/kit/ nor kit/ — please run the installer",
    zusammenfassungFehlt: "the check summary is missing",
    zusammenfassungUnlesbar: "the check summary is unreadable",
    altesFormat: "the check summary has an old format without hashes — please run the installer",
    gitFehler: "{kommando} failed: {fehler}",
    pruefungEndete: "the check ended {ergebnis} ({cmd})",
    bereichslauf: "the check ran limited to the area '{bereich}' and does not cover the commit — please run '{hilfe}' without --area",
    loeschungNichtGeprueft: "deletion not checked",
    nichtGeprueft: "not checked",
    geaendert: "changed after the check",
    einzigesKommando: "gate.mjs: the commands are 'pre-commit', 'commit-msg', 'post-commit' and 'post-merge'.\n",
    nichtGestartet: "{hook}: card check not started — {grund}\n",
    exitCode: "exit {status}",
    strengeModulFehlt: "board/strenge.mjs is in neither .claude/kit/ nor kit/ — please run the installer",
    configUnlesbar: "Commit rejected — {pfad} in the commit is not valid JSON; whether it weakens the strictness cannot be checked that way.\n",
    strengeAbgewiesen: "Commit rejected — it weakens the project's strictness:\n{liste}\n"
      + "  Only a human changes the strictness and any setting that weakens a check it requires; "
      + "an unsupervised run (KIT_AGENT_MODEL set) does not commit a weakening.\n",
    strengeOhneZeile: "Commit rejected — it weakens the project's strictness:\n{liste}\n"
      + "  A weakening needs the line 'Strenge: <alt> -> <neu> (<Urheber>)' in the commit message.\n",
  }),
});

let sprache = null;
let config = null;

/** Die Team-Config aus `.claude/workflow.config.json` im cwd, einmal gelesen; kaputt oder fehlend: `{}`. */
function projektConfig() {
  if (config === null) {
    try {
      config = JSON.parse(readFileSync(join(process.cwd(), ".claude", "workflow.config.json"), "utf-8")) ?? {};
    } catch {
      // keine oder kaputte Config: Vorgabe
      config = {};
    }
  }
  return config;
}

/**
 * Die Sprache des Projekts, einmal aus `.claude/workflow.config.json` im cwd gelesen:
 * `language`, sonst `sprache`, sonst `de`; ein unbekannter Wert gilt als `de`.
 * SYNC: dieselbe Regel wie `projektSprache` in kit/board/namen.mjs.
 */
function projektSprache() {
  if (sprache === null) {
    const wert = projektConfig().language ?? projektConfig().sprache;
    sprache = wert === "en" || wert === "de" ? wert : "de";
  }
  return sprache;
}

/** Der Text zu `schluessel` in der Projektsprache, die Platzhalter `{name}` ersetzt. */
function text(schluessel, werte = {}) {
  return TEXTE[projektSprache()][schluessel].replaceAll(/\{([A-Za-z_]\w*)\}/g, (_, name) => String(werte[name]));
}

function ab(grund, pfad) {
  const werte = { grund, pfad, hilfe: HILFE };
  process.stderr.write(text(pfad ? "abgewiesenPfad" : "abgewiesen", werte));
  process.exit(1);
}

function git(...args) {
  return spawnSync("git", args, { cwd: process.cwd(), encoding: "utf-8" });
}

/**
 * Wo liegt `checks.mjs`? Zwei Orte, in dieser Reihenfolge.
 *
 * Das Nachbar-Muster aus `night.mjs` traegt hier nicht: Neben dieser Datei liegt
 * keine `checks.mjs`. Im Zielprojekt schreibt der Installer sie nach
 * `.claude/kit/` (dort per .gitignore ausgeschlossen), im Kit-Repo und seinem
 * CI-Checkout liegt sie unter `kit/`. Ein fester Pfad ginge in einer der beiden
 * Lagen schief — und weil ein nicht lauffaehiges Gate nicht durchlaesst, waere
 * das dort jeder Commit.
 */
async function ladeZusammenfassungPfad() {
  const orte = [
    join(__dirname, "..", ".claude", "kit", "checks.mjs"),
    join(__dirname, "..", "kit", "checks.mjs"),
  ];
  for (const ort of orte) {
    if (existsSync(ort)) return (await import(pathToFileURL(ort).href)).zusammenfassungPfad;  // eslint-disable-line no-await-in-loop -- NOSONAR S9382: der erste vorhandene Ort gewinnt
  }
  ab(text("checksFehlt"));
  return null;
}

/** Die Zusammenfassung, gepruft auf Form. */
function leseZusammenfassung(pfad) {
  if (!existsSync(pfad)) ab(text("zusammenfassungFehlt"));
  let daten;
  try {
    daten = JSON.parse(readFileSync(pfad, "utf-8"));
  } catch {
    ab(text("zusammenfassungUnlesbar"));
  }
  // Ein gueltiges JSON ohne `hashes` stammt aus einer checks.mjs vor Issue #469.
  // Ohne diesen Zweig wuerde jede Datei einzeln als ungeprueft gemeldet, und das
  // genannte Heilkommando heilte nichts, solange die alte Datei liegt.
  if (!Array.isArray(daten.laufen) || daten.hashes === null || typeof daten.hashes !== "object") {
    ab(text("altesFormat"));
  }
  return daten;
}

/**
 * Was in den Commit geht, aus dem Index.
 *
 * `-z`, weil git Pfade mit Nicht-ASCII sonst quotet (`core.quotePath`) und die
 * Schluessel in `hashes` unquotiert sind. `--no-renames`, weil eine R-Zeile zwei
 * Pfade traegt: Ohne die Option braeuchte das Gate Sonderlogik, mit ihr erscheint
 * eine Umbenennung als Loeschung plus Neuanlage und faellt unter die zwei Regeln,
 * die es ohnehin hat.
 */
function indexEintraege() {
  const res = git("diff", "--cached", "--name-status", "-z", "--no-renames");
  if (res.status !== 0) ab(text("gitFehler", { kommando: "git diff --cached", fehler: (res.stderr || "").trim() }));
  const felder = res.stdout.split("\0");
  const eintraege = [];
  for (let i = 0; i + 1 < felder.length; i += 2) {
    if (felder[i]) eintraege.push({ status: felder[i], pfad: felder[i + 1] });
  }
  return eintraege;
}

/** Blob-Hash je gestagtem Pfad, so wie git ihn committen wird. */
function indexHashes() {
  const res = git("ls-files", "--stage", "-z");
  if (res.status !== 0) ab(text("gitFehler", { kommando: "git ls-files --stage", fehler: (res.stderr || "").trim() }));
  const hashes = new Map();
  for (const zeile of res.stdout.split("\0")) {
    if (!zeile) continue;
    // "<mode> <sha> <stage>\t<pfad>"
    const tab = zeile.indexOf("\t");
    if (tab < 0) continue;
    const teile = zeile.slice(0, tab).split(" ");
    hashes.set(zeile.slice(tab + 1), teile[1]);
  }
  return hashes;
}

function preCommit(zusammenfassungPfad) {
  const daten = leseZusammenfassung(zusammenfassungPfad(process.cwd()));

  // Das erste `rot`, erst ohne ein solches das erste ungruene (Issue #1072): Nach einem
  // roten Teillauf stehen vor der roten Gruppe nicht gestartete, und die Meldung soll die
  // Pruefung nennen, die tatsaechlich rot war.
  // SYNC: dieselbe Regel wie `rotesKommando` in kit/checks.mjs und `lesePruefung` in kit/night.mjs.
  const rot = daten.laufen.find((e) => e.ergebnis === "rot") ?? daten.laufen.find((e) => e.ergebnis !== "gruen");
  if (rot) ab(text("pruefungEndete", { ergebnis: rot.ergebnis, cmd: rot.cmd }));

  // Ein Bereichslauf ist ein TEILNACHWEIS (Issue #922, Code-Review): `--area` grenzt
  // die gefahrenen Pruefungen auf einen Bereich ein, bestimmt `geaendert` und `hashes`
  // aber weiterhin aus dem Anker. Ohne diesen Zweig traegt jede geaenderte Datei einen
  // Hash und das Gate liesse den Commit durch — auch fuer Bereiche, deren Pruefungen nie
  // liefen. Der eingegrenzte Lauf bleibt richtig; er ist nur kein Abschlussnachweis.
  if (typeof daten.bereichWahl === "string") {
    ab(text("bereichslauf", { bereich: daten.bereichWahl, hilfe: HILFE }));
  }

  const geprueft = daten.hashes;
  const imIndex = indexHashes();
  for (const { status, pfad } of indexEintraege()) {
    const geloescht = status.startsWith("D");
    if (!(pfad in geprueft)) {
      ab(text(geloescht ? "loeschungNichtGeprueft" : "nichtGeprueft"), pfad);
    }
    if (geloescht) continue;
    if (geprueft[pfad] !== imIndex.get(pfad)) ab(text("geaendert"), pfad);
  }
  return 0;
}

// --- Schutz der Strenge im Commit (Issue #2109, Plan #2102 A11) ----------------------------
//
// Die Config ist bewusst schreibbar. `hook write-check` haelt die Schreibwerkzeuge einer
// Sitzung an; was an ihm vorbei entsteht, sieht erst git. Darum vergleicht `commit-msg` die
// Config in HEAD mit der im Index ueber `strengeVergleich` aus kit/board/strenge.mjs — erst in
// diesem Hook liegt die Commit-Nachricht vor, die pre-commit noch nicht kennt.

const CONFIG_PFAD = ".claude/workflow.config.json";

/** Der Vermerk eines Menschen, der die Strenge senkt (A10); `settings.mjs` und die App schreiben ihn. */
const STRENGE_ZEILE = /^Strenge: \S.* -> \S.* \(.+\)\s*$/m;

/** Inhalt eines Blobs (`HEAD:<pfad>` oder `:<pfad>` fuer den Index); `null`, wenn es ihn nicht gibt. */
function blobInhalt(spec) {
  const res = git("cat-file", "blob", spec);
  return res.status === 0 ? res.stdout : null;
}

/**
 * `strengeVergleich` und `normalisiereConfig` aus dem Kit, an denselben zwei Orten gesucht wie
 * `checks.mjs` in `ladeZusammenfassungPfad`; ein Ort mit einer aelteren Fassung gilt als leer.
 * Erst geladen, wenn der Commit die Config aendert: Ein Commit ohne sie braucht kein Kit-Modul.
 */
async function ladeStrenge() {
  for (const ort of [join(__dirname, "..", ".claude", "kit", "board"), join(__dirname, "..", "kit", "board")]) {
    const strenge = join(ort, "strenge.mjs");
    const namen = join(ort, "config-namen.mjs");
    if (!existsSync(strenge) || !existsSync(namen)) continue;
    const [{ strengeVergleich, abschwaechungText }, { normalisiereConfig }] = await Promise.all([  // eslint-disable-line no-await-in-loop -- NOSONAR S9382: der erste vorhandene Ort gewinnt
      import(pathToFileURL(strenge).href),
      import(pathToFileURL(namen).href),
    ]);
    // Eine installierte Kopie von vor Issue #2109 traegt `abschwaechungText` noch nicht.
    if (typeof abschwaechungText === "function") return { strengeVergleich, abschwaechungText, normalisiereConfig };
  }
  ab(text("strengeModulFehlt"));
  return null;
}

function strengeAb(schluessel, werte) {
  process.stderr.write(text(schluessel, werte));
  process.exit(1);
}

/**
 * Weist einen Commit ab, der die Strenge abschwaecht: mit `KIT_AGENT_MODEL` jeden, ohne nur
 * einen, dessen Nachricht keine Zeile `Strenge: <alt> -> <neu> (<Urheber>)` traegt. Ohne Config
 * in HEAD gibt es nichts abzuschwaechen; eine geloeschte Config gilt als leere.
 */
async function commitMsg(nachrichtDatei) {
  const vorher = blobInhalt(`HEAD:${CONFIG_PFAD}`);
  const nachher = blobInhalt(`:${CONFIG_PFAD}`);
  if (vorher === null || nachher === vorher) return;
  let alt;
  try {
    alt = JSON.parse(vorher);
  } catch {
    // Eine kaputte Config in HEAD gibt keine Strenge vor, die zu schuetzen waere.
    return;
  }
  let neu = {};
  try {
    if (nachher !== null) neu = JSON.parse(nachher);
  } catch {
    strengeAb("configUnlesbar", { pfad: CONFIG_PFAD });
  }
  const { strengeVergleich, abschwaechungText, normalisiereConfig } = await ladeStrenge();
  const { abschwaechungen } = strengeVergleich(normalisiereConfig(alt).config, normalisiereConfig(neu).config);
  if (abschwaechungen.length === 0) return;
  const liste = abschwaechungen.map((a) => `  - ${abschwaechungText(a)}`).join("\n");
  const unbeaufsichtigt = typeof process.env.KIT_AGENT_MODEL === "string" && process.env.KIT_AGENT_MODEL.trim() !== "";
  if (unbeaufsichtigt) strengeAb("strengeAbgewiesen", { liste });
  // Restrisiko (Plan #2102 A11): Eine interaktive KI-Sitzung ohne KIT_AGENT_MODEL kann die Config
  // per Bash am Hook write-check vorbei schreiben und die Strenge-Zeile selbst in die Nachricht
  // setzen. Der Vermerk macht die Absenkung dann in der Historie sichtbar, verhindert sie aber
  // nicht; dass ein Mensch sie wollte, kann git nicht pruefen.
  let nachricht = "";
  try {
    nachricht = readFileSync(nachrichtDatei, "utf-8");
  } catch {
    // keine lesbare Nachricht: keine Zeile
  }
  if (!STRENGE_ZEILE.test(nachricht)) strengeAb("strengeOhneZeile", { liste });
}

// --- Die Pruefung je Karte nach Commit und Merge (Issue #2156, Plan #2145 E1) ---------------
//
// `post-commit` und `post-merge` starten `night.mjs --card-check --detach`. Beide halten nie
// etwas auf: Der Commit steht schon, jeder Ausgang endet mit 0, ein Fehler beim Start ist eine
// Zeile. Gestartet wird nur, wenn alles zutrifft; sonst still nichts.

/** Ein Pfad aus `git rev-parse <option>`, absolut zum cwd; `null`, wenn git ihn nicht nennt. */
function gitPfad(...args) {
  const res = git("rev-parse", ...args);
  return res.status === 0 ? resolve(process.cwd(), res.stdout.trim()) : null;
}

/**
 * Das Kit-Verzeichnis mit dem Runner: im Projekt `.claude/kit/`, sonst — im CI-Checkout des
 * Kit-Repos — `kit/`; dieselbe Reihenfolge wie `ladeZusammenfassungPfad`. Gesucht wird unter
 * dem cwd, das git fuer einen Hook auf die Wurzel des Arbeitsbaums setzt, nicht neben dieser
 * Datei: Ein Fixture, das auf ein fremdes `.githooks` zeigt, startet so nie dessen Runner.
 */
function kitVerzeichnis() {
  return [join(process.cwd(), ".claude", "kit"), join(process.cwd(), "kit")]
    .find((ort) => existsSync(join(ort, "night.mjs"))) ?? null;
}

/**
 * Pro mit dem Teil `card-check`? Die Ausgabe steht in `board/fassung.mjs` als `KIT_AUSGABE`;
 * fehlt sie, gilt Pro. Der Teil muss zudem liegen — ohne ihn bliebe der Start wirkungslos.
 * SYNC: dieselbe Regel wie `ausgabe` in kit/board/ausgabe.mjs, die Datei des Teils wie
 * `PRO_TEILE["card-check"]` dort.
 */
function kartenpruefungInPro(kitDir) {
  let fassung = "";
  try {
    fassung = readFileSync(join(kitDir, "board", "fassung.mjs"), "utf-8");
  } catch {
    // keine Fassung: Vorgabe Pro
  }
  if (/^export const KIT_AUSGABE = "community";$/m.test(fassung)) return false;
  return existsSync(join(kitDir, "night", "kartenpruefung.mjs"));
}

/**
 * Steht der Arbeitsbaum auf `mainBranch` der Hauptkopie, ohne laufenden Rebase, mit
 * `origin/<mainBranch>`? Ohne den Ursprungszweig fehlt der Pruefung je Karte die Basis
 * (Plan #2145, E4) — wie im Abschluss eines Laufs (`abschlussDesLaufs` in kit/night/kitstand.mjs).
 * Ein Worktree hat ein eigenes Git-Verzeichnis neben dem gemeinsamen; nur die Hauptkopie nicht.
 */
function aufHauptzweigDerHauptkopie() {
  const mainBranch = typeof projektConfig().mainBranch === "string" ? projektConfig().mainBranch : "main";
  const zweig = git("symbolic-ref", "-q", "--short", "HEAD");
  if (zweig.status !== 0 || zweig.stdout.trim() !== mainBranch) return false;
  const eigenes = gitPfad("--git-dir");
  if (!eigenes || eigenes !== gitPfad("--git-common-dir")) return false;
  if (["rebase-merge", "rebase-apply"].some((name) => existsSync(gitPfad("--git-path", name)))) return false;
  return git("rev-parse", "--verify", "-q", `refs/remotes/origin/${mainBranch}^{commit}`).status === 0;
}

/**
 * Die Variablen, mit denen git im Hook jeden Git-Aufruf an dieses Repo bindet, aus
 * `git rev-parse --local-env-vars` ohne die drei zur Konfiguration (`GIT_CONFIG`,
 * `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`), die der Aufrufer mitbringt. Erbt der Runner etwa
 * `GIT_INDEX_FILE=.git/index`, scheitert sein `git worktree add`, weil `.git` im neuen Worktree
 * eine Datei ist (Issue #2165).
 */
const REPO_BINDUNG = Object.freeze([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_OBJECT_DIRECTORY", "GIT_DIR", "GIT_WORK_TREE", "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE", "GIT_INDEX_FILE", "GIT_NO_REPLACE_OBJECTS", "GIT_REPLACE_REF_BASE", "GIT_PREFIX", "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
]);

const ohneRepoBindung = (env) => Object.fromEntries(Object.entries(env).filter(([name]) => !REPO_BINDUNG.includes(name)));

function kartenpruefungAnstossen(hook) {
  const kitDir = kitVerzeichnis();
  if (!kitDir || !kartenpruefungInPro(kitDir) || !aufHauptzweigDerHauptkopie()) return;
  const res = spawnSync(process.execPath, [join(kitDir, "night.mjs"), "--card-check", "--detach"], {
    cwd: process.cwd(), env: ohneRepoBindung(process.env), stdio: ["ignore", "inherit", "pipe"], encoding: "utf-8", timeout: 60_000,
  });
  if (!res.error && res.status === 0) {
    process.stderr.write(res.stderr || "");
  } else {
    const grund = res.error?.message ?? [(res.stderr || "").trim(), text("exitCode", { status: res.status })].filter(Boolean).join(" — ");
    process.stderr.write(text("nichtGestartet", { hook, grund }));
  }
}

/**
 * Laedt ein anderes Programm diese Datei als Modul (der Test der Texttabelle), laeuft das
 * Gate nicht. Im Zweifel laeuft es: Ein Gate, das still nichts tut, liesse jeden Commit durch.
 * realpathSync, weil Node fuer import.meta.url Symlinks aufloest (macOS: /var -> /private/var).
 */
function alsModulGeladen() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) !== realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (!alsModulGeladen()) {
  const [befehl] = process.argv.slice(2);
  if (befehl === "post-commit" || befehl === "post-merge") {
    kartenpruefungAnstossen(befehl);
    process.exit(0);
  }
  if (befehl === "commit-msg") {
    await commitMsg(process.argv[3]);
    process.exit(0);
  }
  if (befehl !== "pre-commit") {
    process.stderr.write(text("einzigesKommando"));
    process.exit(2);
  }
  process.exit(preCommit(await ladeZusammenfassungPfad()));
}
