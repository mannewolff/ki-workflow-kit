// SPDX-License-Identifier: MIT
/**
 * night/kitstand.mjs — der feste Kit-Stand des Runners (Issue #1226, Plan #1199, E17):
 * der Umsetzungs-Lock, der Worktree je Kette samt Rueckweg der Befunde und der feste
 * Kit-Stand je unbeaufsichtigtem Lauf.
 *
 * Ein Teil von kit/night.mjs. Der Einstieg laedt ihn erst nach der Auskunft ueber
 * --version und --help und exportiert seine Namen unveraendert weiter. Dieser Teil
 * importiert nur aus den Grundlagen, nie aus dem Einstieg: Der Einstieg laedt die Teile,
 * ein Rueckimport waere ein Zyklus. `tools/frischer-checkout.mjs` importiert direkt von hier.
 *
 * Worktree anlegen, abbauen und aufraeumen, den Rueckweg der Befunde, das Nachziehen und die
 * Prozess-Id einer Lock-Datei fuehrt seit Issue #1858 (Plan #1853, E3, E15) der Community-Teil
 * kit/board/arbeitskopie.mjs: `push main` und `merge production` brauchen sie auch ohne den
 * Runner. Dieser Teil importiert sie statisch von dort und exportiert sie unter ihrem Namen
 * weiter — ein Pro-Teil wird nie ohne Community installiert.
 *
 * Mitgezogen, obwohl E17 sie nicht nennt: `laufKennungUmgebung` (stand im Abschnitt des
 * festen Kit-Stands und wird mit `kitStandUmgebung` jeder Sitzung mitgegeben) und
 * `laufArt`, das in die Grundlagen zog, weil Teil und Einstieg es teilen.
 *
 * Die Abhaengigkeiten nach aussen — git, der Start eines Programms mit und ohne Warten,
 * Uhr, Schlaf und die Prozess-Probe — lassen sich ueber `kitstandAbhaengigkeiten` einsetzen
 * (Plan #1199, E6): So pruefen die Tests den Teil im selben Prozess, ohne Kindprozess und
 * ohne feste Pause. git, das Programm mit Warten, Uhr und Prozess-Probe fuehrt seit Issue
 * #1858 kit/board/arbeitskopie.mjs; der Haken hier reicht sie dorthin weiter.
 *
 * Bewusst ohne eigene KIT_VERSION (Plan #1199, E19): Die Teile kommen im selben
 * Verzeichnis-Blob wie der Einstieg und werden nie einzeln verteilt.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { spawn as kindStarten } from "node:child_process";
import {
  existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, cpSync, renameSync, linkSync, realpathSync,
  openSync, closeSync,
} from "node:fs";
import { join, dirname, relative, isAbsolute } from "node:path";
import { constants as osConstants } from "node:os";
import { fileURLToPath } from "node:url";

import {
  ZUSTAND, BEFUNDE_PATH, BOARD_MAX_BUFFER, log, fail, ersteZeile, ladeConfigMitOverrides, laufArt,
} from "./grundlagen.mjs";

// Umgezogen nach kit/board/arbeitskopie.mjs (Issue #1858, Plan #1853, E3, E15); hier nur
// weiterexportiert, damit Runner und Tests sie unter ihrem Namen finden.
import {
  UMSETZUNG_LOCK, KIT_STAND_MARKIERUNG, VORBEREITUNG_DATEI, abh as gemeinsam, kitstandAbhaengigkeiten as gemeinsamEinsetzen,
  gitIm, lockPid, pidAusInhalt, prozessLaeuft, configVonPlatte, ohneVorbereitung, worktreeAnlegen,
  worktreeEntfernen, worktreesAufraeumen, befundeZurueck, BUILD_DIENST_FRIST_MS,
} from "../board/arbeitskopie.mjs";

export {
  VORBEREITUNG_DATEI, pidAusInhalt, prozessLaeuft, worktreeAnlegen, worktreeEntfernen,
  worktreesAufraeumen, befundeZurueck,
};
export { nachziehenPruefen } from "../board/arbeitskopie.mjs";

// Die Texte an den Menschen liegen unter kit/texte/night-kitstand.mjs (Issue #1525).
import { TEXTE } from "../texte/night-kitstand.mjs";

// Umgezogen nach kit/checks.mjs (Issue #1857, Plan #1853, E9/E15): Sie liest nur die
// Zusammenfassung, die checks.mjs schreibt; hier nur weiterexportiert.
import { zusammenfassungBezeugt } from "../checks.mjs";

export { zusammenfassungBezeugt };

export { TEXTE };

// Das Register mit literalem Pfad und abgefangen, wie in den uebrigen Teilen (Issue #1485):
// Fehlt board/namen.mjs neben night.mjs, bleiben die Texte deutsch.
const namen = await import("../board/namen.mjs").catch(() => null);

function t(schluessel, werte = {}) {
  if (namen) return namen.text(TEXTE, schluessel, werte);
  return TEXTE.de[schluessel].replaceAll(/\{([A-Za-z_]\w*)\}/g, (_, name) => String(werte[name]));
}

// --- Abhaengigkeiten nach aussen (Plan #1199, E6) ---

// git, das Programm mit Warten, Uhr und Prozess-Probe fuehrt kit/board/arbeitskopie.mjs
// (`gemeinsam`, Issue #1858); hier stehen nur die, die allein der Runner braucht.
const VORGABEN = Object.freeze({
  // Der Runner des Stands als Kind, auf den der Elternprozess asynchron wartet.
  spawn: kindStarten,
  schlaf: (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); },
  // Der Weg der Push-Stufe im Baum `pfad`: `"lokal"` oder `{ ort: "buildDienst", zweig }`.
  pushWeg: (pfad) => pushWegAusPlan(pfad),
  // Die Pause beim Warten auf den Build-Dienst (Issue #1974) — asynchron, der Lauf wartet Minuten.
  schlafen: (ms) => new Promise((fertig) => setTimeout(fertig, ms)),
  // Der Code-Host des Projekts; erst beim Aufruf geladen, nur die Vorbereitung im Build-Dienst braucht ihn.
  codeHost: async (cfg) => (await import("../board/adapter.mjs")).resolveCodeHost(cfg),
  // Der Pro-Teil `card-check` fuer die Installation unter `repoRoot` (Issue #2155), `null` ohne ihn:
  // Mit ihm ist das Projekt Pro, und die Pruefung je Karte ersetzt Vorbereitung und Integrationslauf.
  kartenpruefungTeil: (pro, repoRoot) => pro.proLaden("card-check", undefined, repoRoot),
});
const abh = { ...VORGABEN };

/**
 * Setzt Abhaengigkeiten des Teils ein; nicht genannte behalten ihren Wert, ohne Argument
 * gelten wieder alle Vorgaben. Nur fuer Tests — der Runner arbeitet mit den Vorgaben.
 *
 * Der Haken unter seinem alten Namen (Issue #1858): Was kit/board/arbeitskopie.mjs fuehrt
 * (`git`, `spawnSync`, `jetzt`, `kill`), geht an dessen Haken, der Rest bleibt hier. Ein
 * unbekannter Name scheitert dort, bevor hier etwas gesetzt ist.
 */
export function kitstandAbhaengigkeiten(neu) {
  if (neu === undefined) {
    Object.assign(abh, VORGABEN);
    gemeinsamEinsetzen();
    return;
  }
  const eigene = Object.entries(neu).filter(([name]) => Object.hasOwn(VORGABEN, name));
  gemeinsamEinsetzen(Object.fromEntries(Object.entries(neu).filter(([name]) => !Object.hasOwn(VORGABEN, name))));
  for (const [name, fn] of eigene) abh[name] = fn;
}

// --- Der Umsetzungs-Lock (Plan #691, E10; Issue #696) ---
//
// Kette und Umsetzungslauf liefen bisher ausdruecklich nebeneinander: Die Kette baute im
// Worktree, der Umsetzungslauf in der Hauptkopie. Unter Variante B stimmt das nicht mehr —
// die Umsetzungsstufe baut selbst in der Hauptkopie (E4), und zwei Laeufe, die gleichzeitig
// in denselben Working Tree committen, hinterlassen einen Zustand, den niemand mehr
// entwirrt. E10 entscheidet deshalb den Lock und nicht einen Satz in der Dokumentation:
// Ein Satz, den ein Cron-Eintrag nicht liest, verhindert nichts.
//
// Verwaist wird ueber die Prozess-Id erkannt, nicht ueber eine Verfallsfrist. Eine Frist
// waere geraten — ein Umsetzungslauf darf laenger dauern als jede Schaetzung, und ein zu
// kurzer Verfall gaebe genau die Gleichzeitigkeit frei, die der Lock verhindern soll.
//
// Die Datei liegt unter `.claude/` und ist damit in jedem Projekt mit dem `.claude/*`-Block
// des Installers per `.gitignore` gedeckt — in den uebrigen deckt sie der Ausschluss in
// `gitReste()`, wie bei Protokoll und wartendem Bericht. Beendet ein harter
// Stopp den Prozess an einem `finally` vorbei, bleibt sie liegen; der naechste Lauf erkennt
// sie als verwaist.

// UMSETZUNG_LOCK, der Pfad der Lock-Datei relativ zur Hauptkopie, und `lockPid` stehen in
// kit/board/arbeitskopie.mjs: Die Git-Helfer nehmen ihn vom Rest-Guard aus (Issue #1224), und
// `nachziehenPruefen` liest ihn auch ohne den Runner (Issue #1858).

/**
 * Nimmt den Umsetzungs-Lock in der Hauptkopie.
 *
 * Rueckgabe ist `{ ok: true, hinweis, freigeben }` oder `{ ok: false, art, grund }`. Beide
 * Arten des Fehlschlags lassen die Umsetzung aus — ein Lock, der bei Schreibfehlern
 * uebergangen wird, ist keiner —, sie stehen aber fuer Verschiedenes und sind darum an `art`
 * zu unterscheiden statt am Wortlaut des Grundes: `"belegt"` ist der vorgefundene Lock eines
 * laufenden Laufs, `"schreibfehler"` der Lock, der sich nicht schreiben liess.
 *
 * Die beiden Aufrufer sind darauf verschieden angewiesen: Der Umsetzungslauf (6861)
 * unterscheidet die Arten — belegt ist fuer sie ein ruhiger Lauf, ein Schreibfehler eine
 * Stoerung der Umgebung. Die Kettenstufe wartet bei `belegt` im Rahmen ihres
 * Umsetzungsbudgets (`aufUmsetzungWarten`, E10) und faellt erst danach, beim Schreibfehler
 * sofort, auf Variante A zurueck, was fuer sie ein vorgesehener Ausgang ist.
 *
 * Wer `ok: false` bekommt, ruft `freigeben` nicht: Der Lock gehoert dann einem anderen Lauf.
 *
 * Atomar (Plan #1113, E9): Die Datei entsteht mit `flag: "wx"` — von zwei Anlaeufen gegen
 * eine freie Sperre legt sie genau einer an. Eine verwaiste Sperre wird nicht ueberschrieben,
 * sondern auf einen eindeutigen Namen umbenannt und sofort geloescht; das Umbenennen gelingt
 * nur einem von zwei Anlaeufen, die dieselbe verwaiste Datei sehen. Danach wird das Anlegen
 * genau einmal wiederholt.
 */
export function umsetzungLockNehmen(repoRoot) {
  const pfad = join(repoRoot, UMSETZUNG_LOCK);
  try {
    mkdirSync(dirname(pfad), { recursive: true });
  } catch (e) {
    return lockSchreibfehler(e);
  }
  let verwaist = false;
  for (let versuch = 0; versuch < 2; versuch++) {
    try {
      writeFileSync(pfad, `${process.pid}\n`, { encoding: "utf-8", flag: "wx" });
      return {
        ok: true,
        hinweis: verwaist ? t("lockVerwaistGenommen", { lock: UMSETZUNG_LOCK }) : null,
        freigeben: () => lockFreigeben(pfad),
      };
    } catch (e) {
      if (e.code !== "EEXIST") return lockSchreibfehler(e);
    }
    // Ein zweites EEXIST heisst: Zwischen Wegraeumen und Anlegen kam ein anderer Anlauf
    // zuvor. Seine Sperre ist frisch, und wiederholt wird genau einmal (E9).
    if (versuch > 0) break;
    const geraeumt = verwaistRaeumen(pfad);
    if (geraeumt.ok === false) return geraeumt;
    verwaist = geraeumt.verwaist;
  }
  return lockBelegt(lockPid(pfad) ?? t("unbekannt"));
}

/** Der Takt, in dem eine Kette eine belegte Umsetzungssperre erneut versucht (E10). */
export const UMSETZUNG_WARTEN_MS = 60 * 1000;

/**
 * Wartet auf eine belegte Umsetzungssperre (Plan #1113, E10): Bei `art: "belegt"` alle
 * `UMSETZUNG_WARTEN_MS` ein neuer Versuch, bis `budgetMs` verbraucht ist. Die Wartezeit
 * zaehlt zum Umsetzungsbudget der Stufe, ein eigenes Wartebudget gibt es nicht
 * (PO-Antwort 4). Ein Schreibfehler wartet nicht — eine gestoerte Umgebung wird durch
 * Warten nicht heil.
 *
 * Waehrend des Wartens steht der Laufstand auf `laeuft`, nicht auf `wartet`: Das ist der
 * Zustand eines Halts, und eine wartende Kette belegt ihre Wurzel weiter (E6).
 *
 * Rueckgabe wie `umsetzungLockNehmen`; nach abgelaufenem Budget das letzte `belegt`, dessen
 * Grund die Wartezeit nennt. Uhr, Sperre, Schlaf und Laufstand sind eingespeist.
 */
export async function aufUmsetzungWarten({ nehmen, jetzt, schlafen, budgetMs, standSetzen }) {
  const start = jetzt();
  let lock = nehmen();
  let standGesetzt = false;
  while (!lock.ok && lock.art === "belegt") {
    const rest = budgetMs - (jetzt() - start);
    if (rest <= 0) {
      const minuten = Math.round((jetzt() - start) / 60000);
      return { ...lock, grund: t("umsetzungGewartet", { grund: lock.grund, minuten }) };
    }
    if (!standGesetzt) {
      standSetzen("laeuft", t("wartetAufUmsetzung", { seit: new Date(start).toISOString() }));
      standGesetzt = true;
    }
    await schlafen(Math.min(UMSETZUNG_WARTEN_MS, rest));  // eslint-disable-line no-await-in-loop -- NOSONAR S9382: Takt der Abfrage, bis die Umsetzung die Sperre freigibt
    lock = nehmen();
  }
  return lock;
}

function lockBelegt(pid) {
  return { ok: false, art: "belegt", grund: t("lockBelegt", { lock: UMSETZUNG_LOCK, pid }) };
}

function lockSchreibfehler(e) {
  return { ok: false, art: "schreibfehler", grund: t("lockSchreibfehler", { lock: UMSETZUNG_LOCK, fehler: e.message }) };
}

/**
 * Liest die vorgefundene Lock-Datei so, wie sie ueber ihren Halter entscheidet. Eine leere
 * Datei kann die frische Sperre eines Anlaufs sein, der sie eben mit `wx` angelegt, seine Id
 * aber noch nicht geschrieben hat; erst nach einem kurzen Moment gilt sie als verwaist.
 */
function lockGesehen(pfad) {
  const inhalt = lockInhalt(pfad);
  if (inhalt === null || inhalt.trim() !== "") return inhalt;
  abh.schlaf(LOCK_LEER_WARTEN_MS);
  return lockInhalt(pfad);
}

/**
 * Raeumt eine vorgefundene Sperre weg, wenn ihr Halter nicht mehr lebt (E9): umbenennen auf
 * einen eindeutigen Namen, dann loeschen. Das Umbenennen gelingt nur einem von zwei
 * Anlaeufen, die dieselbe verwaiste Datei sehen.
 *
 * Rueckgabe: `{ verwaist }` — `true`, wenn diese Datei weggeraeumt wurde, `false`, wenn sie
 * schon weg war —, oder das `ok: false`-Ergebnis von `umsetzungLockNehmen`.
 */
function verwaistRaeumen(pfad) {
  let gesehen;
  try {
    gesehen = lockGesehen(pfad);
  } catch (e) {
    return lockSchreibfehler(e);
  }
  if (gesehen === null) return { verwaist: false }; // inzwischen weg
  const pid = pidAusInhalt(gesehen);
  if (pid !== null && prozessLaeuft(pid)) return lockBelegt(pid);
  const weg = `${pfad}.${process.pid}.${gemeinsam.jetzt().getTime()}.verwaist`;
  try {
    renameSync(pfad, weg);
  } catch (e) {
    return e.code === "ENOENT" ? { verwaist: false } : lockSchreibfehler(e);
  }
  if (inhaltOderGesehen(weg, gesehen) !== gesehen) return zurueckholen(weg, pfad);
  rmSync(weg, { force: true });
  return { verwaist: true };
}

/** Der Inhalt der umbenannten Datei; unlesbar wie zuvor heisst: dieselbe verwaiste Datei. */
function inhaltOderGesehen(weg, gesehen) {
  try {
    return lockInhalt(weg);
  } catch {
    return gesehen;
  }
}

/**
 * Weggeraeumt ist, was zwischen Lesen und Umbenennen an dieser Stelle lag. War das nicht mehr
 * die verwaiste Datei, sondern die frische Sperre eines anderen Anlaufs, kommt sie zurueck —
 * per `linkSync`, das eine inzwischen neu angelegte Sperre nicht ueberschreibt.
 */
function zurueckholen(weg, pfad) {
  try {
    linkSync(weg, pfad);
  } catch {
    // Liegt schon eine neue Sperre, haelt die; die zurueckgeholte waere eine zweite.
  }
  rmSync(weg, { force: true });
  return lockBelegt(lockPid(pfad) ?? t("unbekannt"));
}

/** Wie lange eine leere Lock-Datei Zeit bekommt, die Id ihres Anlegers aufzunehmen. */
const LOCK_LEER_WARTEN_MS = 50;

/**
 * Der rohe Inhalt einer Lock-Datei, null wenn sie fehlt. Jeder andere Lesefehler wirft:
 * Ein Lock, der da ist, aber nicht lesbar, laesst sich auch nicht zuverlaessig nehmen.
 */
function lockInhalt(pfad) {
  try {
    return readFileSync(pfad, "utf-8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

/**
 * Gibt den Umsetzungs-Lock frei — nur, wenn er noch die eigene Prozess-Id traegt. Hat ein
 * anderer Lauf ihn inzwischen uebernommen, gehoert er ihm und bleibt liegen (E9).
 */
function lockFreigeben(pfad) {
  if (lockPid(pfad) !== process.pid) return;
  try {
    rmSync(pfad, { force: true });
  } catch (e) {
    // Gerufen wird das aus einem `finally`; ein Wurf von hier risse den ganzen Lauf
    // mit, nach getaner Arbeit. Liegenbleiben ist unschaedlich — der naechste Lauf
    // findet die Id dieses Prozesses vor und erkennt sie als verwaist.
    log(t("lockNichtEntfernt", { lock: UMSETZUNG_LOCK, fehler: e.message }));
  }
}

/**
 * Die Sperren, an denen ein Lauf des Runners in der Hauptkopie erkennbar ist (Issue #929).
 *
 * Heute ist es eine: `.claude/night-umsetzung.lock`. Sie deckt beide Faelle, die die
 * Release-Skills auseinanderhalten muessen — der Umsetzungslauf nimmt sie, und die
 * Umsetzungsstufe der Kette nimmt unter Variante B dieselbe Datei (6170), weil sie in der
 * Hauptkopie baut. Eine Liste statt einer Konstante, damit eine zweite Sperre hier
 * eingetragen wird und nicht an der Pruefung vorbei entsteht.
 *
 * SYNC: Dieselbe Liste ist die Vorgabe von `sperren` in `nachziehenPruefen`
 * (kit/board/arbeitskopie.mjs, Issue #1858): Der Community-Teil importiert nicht aus dem
 * Runner. test/ablauf-kit-worktree-ohne-runner.test.mjs haelt beide gleich.
 */
export const RUNNER_SPERREN = [UMSETZUNG_LOCK];

// --- Die vorbereitete Veroeffentlichung (Plan #1243, A5, A6, E10; Issue #1246) ---
//
// Der Runner faehrt den Weg von `/push-main` bis zum lokalen Commit `chore: vX.Y.Z` in einem
// eigenen Worktree und pusht nicht. Was er ergab, haelt `vorbereitungFesthalten` ueber den
// Abbau des Worktrees und ueber jeden Tracker hinaus fest — als lokale Referenz, die den
// Commit haelt, und als Datei in der Hauptkopie. Vor dem naechsten `push main` urteilt `vorbereitungPruefen` an
// Commit-Hashes, ob `/push-main` den Stand uebernimmt. Das Urteil spricht das Kommando,
// nicht das Modell (A5).

/** Die lokale Referenz auf den vorbereiteten Commit — nie gepusht (A6). */
export const VORBEREITUNG_REFERENZ = "refs/kit/push-vorbereitet";
// VORBEREITUNG_DATEI, die feste Stelle in der Hauptkopie (A6), steht in kit/board/arbeitskopie.mjs
// (Issue #1858): Der Rest-Guard nimmt sie aus, und worktree.mjs urteilt ohne Runner ueber sie.

const VORBEREITUNG_ERGEBNISSE = ["gruen", "gruen-offen", "rot"];
const VORBEREITUNG_FETCH = ["ok", "fehlgeschlagen"];
// Die Ergebnisse der Sicherheitspruefung, wie `issue-review security-result` sie meldet (Plan #1988, E8).
const VORBEREITUNG_SICHERHEIT = ["gruen", "kritisch", "ausfall"];
// Das Ergebnis, wenn die Strenge die Sicherheitspruefung vor die Auslieferung legt (Issue #2116, Plan #2102, A7).
const SICHERHEIT_ENTFALLEN = "entfallen";

// Die Ableitung der Strenge, mit literalem Pfad und abgefangen wie in kit/checks.mjs: Ohne das
// Modul prueft die Vorbereitung wie bisher.
const strengeModul = await import("../board/strenge.mjs").catch(() => null);

/** Legt die Strenge des Projekts unter `repoRoot` die Sicherheitspruefung vor die Auslieferung? */
function sicherheitVorAuslieferung(repoRoot) {
  return strengeModul?.strengeVorgaben(configVonPlatte(repoRoot) ?? {}).sicherheit === "vor-auslieferung";
}

/**
 * Der Weg der Push-Stufe, wie `checks.mjs plan --stage push` ihn meldet (E17) — dieselbe
 * Auskunft, die `/push-main` liest, statt die Config ein zweites Mal auszulegen. Gefragt
 * wird im Worktree, mit der `checks.mjs` neben diesem Teil.
 */
function pushWegAusPlan(pfad) {
  const checks = join(dirname(fileURLToPath(import.meta.url)), "..", "checks.mjs");
  const res = gemeinsam.spawnSync(process.execPath, [checks, "plan", "--stage", "push"], { cwd: pfad, encoding: "utf-8" });
  if (res.status !== 0) {
    throw new Error(t("pushPlanFehlgeschlagen", { meldung: ersteZeile((res.stderr || res.stdout || res.error?.message || "").trim()) }));
  }
  return JSON.parse(res.stdout).pushPruefung ?? "lokal";
}

/** Der Commit hinter `ref` oder `null`, wenn es ihn nicht gibt. */
function commitVon(baum, ref) {
  const res = gitIm(baum, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return res.status === 0 ? res.stdout.trim() : null;
}

function vorbereitungMainBranch(repoRoot) {
  return configVonPlatte(repoRoot)?.mainBranch || "main";
}

/** Die Kartennummern aller `(Issue #N)`-Betreffe zwischen `origin` und `commit`, aelteste zuerst (E11). */
function paketeZwischen(repoRoot, origin, commit) {
  const res = gitIm(repoRoot, ["log", "--reverse", "--format=%s", origin ? `${origin}..${commit}` : commit]);
  if (res.status !== 0) throw new Error(t("paketeLogFehlgeschlagen", { meldung: ersteZeile((res.stderr || "").trim()) }));
  const pakete = [];
  for (const betreff of res.stdout.split(/\r?\n/)) {
    const treffer = /\(Issue #(\d+)\)/.exec(betreff);
    if (treffer && !pakete.includes(treffer[1])) pakete.push(treffer[1]);
  }
  return pakete;
}

/**
 * Die Pakete, die lokal fertig, aber noch nicht veroeffentlicht sind (Plan #2131, A1; Issue #2134):
 * die Kartennummern aller `(Issue #N)`-Betreffe zwischen `origin/<mainBranch>` und `HEAD`,
 * aelteste zuerst, leer, wenn nichts unveroeffentlicht ist. Ohne `origin/<mainBranch>` zaehlt
 * die ganze Geschichte von `HEAD`. Kein eigenes `git fetch`.
 */
export function unveroeffentlichtePakete(repoRoot) {
  return paketeZwischen(repoRoot, commitVon(repoRoot, `refs/remotes/origin/${vorbereitungMainBranch(repoRoot)}`), "HEAD");
}

/**
 * Wie ein Lauf endet, der Pakete abgeschlossen hat (Plan #2131, A1, A2; Issue #2136; Plan #2145,
 * E14, E15; Issue #2155). Ohne `origin/<mainBranch>` gibt es nichts, wohin veroeffentlicht wuerde,
 * und keine Basis fuer die Pruefung je Karte: `{ art: "integration", pakete: [], proMeldung: null }`.
 * Sonst in Pro — der Pro-Teil `card-check` wirkt — `{ art: "kartenpruefung" }`: Die Pruefung je
 * Karte ersetzt Vorbereitung und Integrationslauf, der Runner startet sie nach dem Zusammenfuehren.
 * In Community `{ art: "integration", pakete, proMeldung }` mit dem lokalen Integrationslauf;
 * `proMeldung` traegt die Pro-Meldung, die der Bericht daneben nennt, wenn unveroeffentlichte
 * Pakete vorliegen. Laesst sich git nicht befragen, bleibt es beim Integrationslauf, und der Grund
 * steht im Protokoll.
 */
export async function abschlussDesLaufs(repoRoot) {
  let pakete;
  try {
    if (!commitVon(repoRoot, `refs/remotes/origin/${vorbereitungMainBranch(repoRoot)}`)) return { art: "integration", pakete: [], proMeldung: null };
    if (await kartenpruefungAktiv(repoRoot)) return { art: "kartenpruefung", pakete: [], proMeldung: null };
    pakete = unveroeffentlichtePakete(repoRoot);
  } catch (e) {
    log(t("abschlussUnbekannt", { fehler: e.message }));
    return { art: "integration", pakete: [], proMeldung: null };
  }
  if (pakete.length === 0) return { art: "integration", pakete, proMeldung: null };
  return { art: "integration", pakete, proMeldung: await buildDienstMeldung() };
}

/**
 * Wirkt der Pro-Teil `card-check` fuer die Installation unter `repoRoot` (Issue #2155)? Die eine
 * Grenze zwischen Pro und Community fuer das Ende eines Laufs (Plan #2145, E14).
 */
export async function kartenpruefungAktiv(repoRoot) {
  const pro = await import("../board/pro.mjs").catch(() => null);
  return pro ? Boolean(await abh.kartenpruefungTeil(pro, repoRoot)) : false;
}

/** Der Runner neben diesem Teil; er startet die Pruefung je Karte (Issue #2155). */
const NIGHT_PFAD = join(dirname(fileURLToPath(import.meta.url)), "..", "night.mjs");

/**
 * Startet die Pruefung je Karte losgeloest (`--card-check --detach`, Plan #2145, E1; Issue #2155)
 * in `repoRoot`, nachdem der Runner seine Ergebnisse in den Hauptzweig gebracht hat. Die Sperre
 * der Pruefung macht aus einem Start neben einer laufenden Pruefung den Nachlauf. Rueckgabe: ob
 * der Start gelang; ein Fehlschlag steht mit Grund im Protokoll und haelt nichts auf.
 * `NIGHT_KARTENPRUEFUNG_CMD` ersetzt den Start durch ein Shell-Kommando, wie `NIGHT_INTEGRATION_CMD`
 * den Integrationslauf — allein fuer die Ablauftests, die sonst eine echte Pruefung losliessen.
 */
export function kartenpruefungStarten(repoRoot) {
  const ersatz = process.env.NIGHT_KARTENPRUEFUNG_CMD;
  const [bin, argv] = ersatz ? ["sh", ["-c", ersatz]] : [process.execPath, [NIGHT_PFAD, "--card-check", "--detach"]];
  const res = gemeinsam.spawnSync(bin, argv, { cwd: repoRoot, stdio: "ignore" });
  if (res.status === 0) return true;
  log(t("kartenpruefungNichtGestartet", { fehler: res.error?.message ?? t("exit", { status: res.status }) }));
  return false;
}

/**
 * Die offenen Punkte eines gruenen Stands: zuerst der Build-Dienst-Punkt (E17), dann die
 * uebergebenen, dahinter je Wackler dieses Laufs sein Punkt (Plan #1395, E14).
 */
function offenePunkte(pfad, bezeugt, offen) {
  const punkte = [...offen];
  const weg = abh.pushWeg(pfad);
  if (weg?.ort === "buildDienst" && bezeugt.stufe === "paket") {
    punkte.unshift(t("buildDienstOffen", { zweig: weg.zweig }));
  }
  for (const cmd of bezeugt.gewackelt) {
    const punkt = t("gewackeltOffen", { cmd });
    if (!punkte.includes(punkt)) punkte.push(punkt);
  }
  return punkte;
}

/**
 * Haelt die vorbereitete Veroeffentlichung fest (A6) und gibt den geschriebenen Inhalt zurueck.
 *
 * Das Ergebnis der Zusammenfassung gilt; weicht das uebergebene ab, steht das in
 * `abweichung`. Bezeugt die Zusammenfassung nur die Paketstufe und laeuft der volle Lauf im
 * Build-Dienst (E17), ist Gruen hoechstens `gruen-offen`, und der Build-Dienst-Punkt steht
 * vor jedem uebergebenen offenen Punkt. Hat in diesem Lauf eine Pruefung gewackelt, ist Gruen
 * ebenso `gruen-offen`, und je Wackler steht hinter den uebergebenen Punkten
 * `Gewackelt: <cmd> — Entscheidung beim push main` — unbeaufsichtigt fragt niemand, die Entscheidung
 * faellt beim `push main` des Menschen (Plan #1395, E14). Ohne Release-Commit ist `commit`
 * der Stand, auf dem der Worktree steht — ohne `RELEASING.md` also `basis` (E15).
 *
 * `sicherheit` ist das Ergebnis der Sicherheitspruefung der Vorbereitung (Plan #1988, E8;
 * Issue #1993). Es gilt fuer genau `commit` und steht als `sicherheit: { commit, ergebnis,
 * zeitpunkt }` in der Datei; nach einem roten Prueflauf lief keine, und das Feld ist `null`.
 * Legt die Strenge (`strengeVorgaben`) sie vor die Auslieferung, entfaellt sie nach einem gruenen
 * Prueflauf mit Vermerk: `sicherheit: { commit, ergebnis: "entfallen", vermerk, zeitpunkt }`
 * (Issue #2116, Plan #2102, A7). Ein uebergebenes Ergebnis gilt dann trotzdem.
 *
 * `reparaturRunden` zaehlt die Reparaturrunden der Vorbereitung (Plan #2131, A7, E2; Issue #2138):
 * Bei gleicher Basis `origin` uebernimmt sie den Stand der vorigen Datei, Reparatur-Commits setzen
 * ihn nicht zurueck; eine neue Basis beginnt bei 0.
 */
export function vorbereitungFesthalten({ repoRoot, pfad, ergebnis, offen = [], fetch = "ok", sicherheit = null, env = process.env }) {
  if (!VORBEREITUNG_ERGEBNISSE.includes(ergebnis)) {
    throw new Error(t("ergebnisUnbekannt", { wert: ergebnis, erwartet: VORBEREITUNG_ERGEBNISSE.join(", ") }));
  }
  if (!VORBEREITUNG_FETCH.includes(fetch)) {
    throw new Error(t("fetchUnbekannt", { wert: fetch, erwartet: VORBEREITUNG_FETCH.join(", ") }));
  }
  if (sicherheit !== null && sicherheit !== undefined && !VORBEREITUNG_SICHERHEIT.includes(sicherheit)) {
    throw new Error(t("sicherheitUnbekannt", { wert: sicherheit, erwartet: VORBEREITUNG_SICHERHEIT.join(", ") }));
  }
  const mainBranch = vorbereitungMainBranch(repoRoot);
  const commit = commitVon(pfad, "HEAD");
  if (!commit) throw new Error(t("worktreeOhneHead", { pfad }));
  const basis = commitVon(repoRoot, `refs/heads/${mainBranch}`);
  const origin = commitVon(repoRoot, `refs/remotes/origin/${mainBranch}`);
  const pakete = paketeZwischen(repoRoot, origin, commit);
  const betreff = gitIm(pfad, ["show", "-s", "--format=%s", commit]).stdout.trim();
  const version = /^chore: v(\S+)$/.exec(betreff)?.[1] ?? null;

  const bezeugt = zusammenfassungBezeugt(pfad, pakete);
  const uebergebenGruen = ergebnis !== "rot";
  const abweichung = uebergebenGruen === (bezeugt.ergebnis === "gruen")
    ? null
    : t("abweichung", { ergebnis, bezeugt: bezeugt.ergebnis });

  const offenGesamt = bezeugt.ergebnis === "gruen" ? offenePunkte(pfad, bezeugt, offen) : [...offen];
  let endErgebnis = bezeugt.ergebnis;
  if (endErgebnis === "gruen" && (offenGesamt.length > 0 || ergebnis === "gruen-offen")) endErgebnis = "gruen-offen";

  gitIm(repoRoot, ["update-ref", VORBEREITUNG_REFERENZ, commit]);
  const zeitpunkt = gemeinsam.jetzt().toISOString();
  const ziel = join(repoRoot, ...VORBEREITUNG_DATEI.split("/"));
  const inhalt = {
    ergebnis: endErgebnis,
    commit,
    basis,
    origin,
    version,
    releaseDateien: existsSync(join(pfad, "RELEASING.md")) && version !== null,
    offen: offenGesamt,
    pakete,
    rot: bezeugt.rot,
    // Der Mutationstest des Push-Laufs im Runner (Issue #1673, Plan #1671, E4): Uebernommen
    // wird nur ein unveraenderter Stand, und genau ihn hat er gemessen — beim `push main` laeuft er nicht neu.
    mutation: bezeugt.mutation,
    fetch,
    zeitpunkt,
    sicherheit: sicherheitFeld({ repoRoot, commit, sicherheit, rot: endErgebnis === "rot", zeitpunkt }),
    laufId: env.KIT_NIGHT_RUN || null,
    kitStand: env.KIT_STAND || null,
    abweichung,
    reparaturRunden: rundenBeiBasis(ziel, origin),
  };
  mkdirSync(dirname(ziel), { recursive: true });
  writeFileSync(ziel, JSON.stringify(inhalt, null, 2) + "\n", "utf-8");
  return inhalt;
}

/** Das Feld `sicherheit` der Vorbereitung: gemessen, entfallen mit Vermerk oder `null`. */
function sicherheitFeld({ repoRoot, commit, sicherheit, rot, zeitpunkt }) {
  if (sicherheit) return { commit, ergebnis: sicherheit, zeitpunkt };
  if (rot || !sicherheitVorAuslieferung(repoRoot)) return null;
  return { commit, ergebnis: SICHERHEIT_ENTFALLEN, vermerk: t("sicherheitEntfallen"), zeitpunkt };
}

/**
 * Die Reparaturrunden der Vorbereitung zur Basis `origin` (Plan #2131, A7, E2; Issue #2138): der
 * Stand der Datei `datei`, wenn sie zur selben Basis `origin/<mainBranch>` gehoert, sonst 0.
 * Reparatur-Commits aendern `basis` und `commit`, nicht `origin` — sie setzen den Zaehler nicht
 * zurueck; erst ein neuer Stand von `origin/<mainBranch>` beginnt bei 0.
 */
function rundenBeiBasis(datei, origin) {
  let vorher;
  try {
    vorher = JSON.parse(readFileSync(datei, "utf-8"));
  } catch {
    return 0;
  }
  const runden = Number(vorher?.reparaturRunden);
  return vorher?.origin === origin && Number.isInteger(runden) && runden > 0 ? runden : 0;
}

/**
 * Die Reparaturrunden aus `.claude/push-vorbereitung.json` unter `repoRoot` (Issue #2138), 0 ohne
 * Datei oder ohne Feld.
 */
export function reparaturRundenLesen(repoRoot) {
  const datei = join(repoRoot, ...VORBEREITUNG_DATEI.split("/"));
  try {
    return rundenBeiBasis(datei, JSON.parse(readFileSync(datei, "utf-8"))?.origin);
  } catch {
    return 0;
  }
}

/**
 * Schreibt `runden` als `reparaturRunden` in `.claude/push-vorbereitung.json` unter `repoRoot` und
 * laesst jedes andere Feld stehen (Issue #2138). Ohne lesbare Datei schreibt sie nichts und liefert
 * `false`: Ohne Vorbereitung gibt es keine Basis, zu der der Zaehler gehoerte.
 */
export function reparaturRundenSetzen(repoRoot, runden) {
  const datei = join(repoRoot, ...VORBEREITUNG_DATEI.split("/"));
  let daten;
  try {
    daten = JSON.parse(readFileSync(datei, "utf-8"));
  } catch {
    return false;
  }
  writeFileSync(datei, JSON.stringify({ ...daten, reparaturRunden: runden }, null, 2) + "\n", "utf-8");
  return true;
}

/**
 * Haelt fest, dass eine Vorbereitung laeuft (Plan #2131, A9; Issue #2139): `buildDienst` mit
 * `ergebnis` `laeuft` und `schritt` `vorbereitung` in `.claude/push-vorbereitung.json` unter
 * `repoRoot`, jedes andere Feld bleibt. Ab hier meldet `check-preparation` „laeuft“, auch
 * bevor die Vorbereitung die Umsetzungssperre haelt. Der vorige Eintrag geht als `vorher` in
 * die Markierung; eine vorgefundene Markierung (der Elternprozess von `--detach`) reicht ihr
 * `vorher` weiter. Rueckgabe: die geschriebene Markierung fuer `vorbereitungLaeuftAufheben`.
 */
export function vorbereitungLaeuftSetzen(repoRoot, { laufId = null } = {}) {
  const datei = join(repoRoot, ...VORBEREITUNG_DATEI.split("/"));
  let daten = {};
  try {
    daten = JSON.parse(readFileSync(datei, "utf-8")) ?? {};
  } catch {
    // ohne lesbare Datei: die Markierung allein
  }
  const alt = daten.buildDienst ?? null;
  const vorher = istVorbereitungsMarke(alt) ? alt.vorher ?? null : alt;
  const marke = { ergebnis: "laeuft", schritt: "vorbereitung", laufId, zeitpunkt: gemeinsam.jetzt().toISOString(), vorher };
  mkdirSync(dirname(datei), { recursive: true });
  writeFileSync(datei, JSON.stringify({ ...daten, buildDienst: marke }, null, 2) + "\n", "utf-8");
  return marke;
}

function istVorbereitungsMarke(buildDienst) {
  return buildDienst?.ergebnis === "laeuft" && buildDienst.schritt === "vorbereitung";
}

/**
 * Nimmt die Markierung aus `vorbereitungLaeuftSetzen` zurueck — nur, wenn sie noch dasteht:
 * Hat die Vorbereitung die Datei neu geschrieben, gehoert sie ihr. `vorher` kehrt zurueck; bleibt
 * danach nichts in der Datei, faellt sie weg.
 */
export function vorbereitungLaeuftAufheben(repoRoot) {
  const datei = join(repoRoot, ...VORBEREITUNG_DATEI.split("/"));
  let daten;
  try {
    daten = JSON.parse(readFileSync(datei, "utf-8"));
  } catch {
    return;
  }
  if (!istVorbereitungsMarke(daten?.buildDienst)) return;
  const { buildDienst, ...rest } = daten;
  if (buildDienst.vorher) rest.buildDienst = buildDienst.vorher;
  if (Object.keys(rest).length === 0) rmSync(datei, { force: true });
  else writeFileSync(datei, JSON.stringify(rest, null, 2) + "\n", "utf-8");
}

/**
 * Ergaenzt `.claude/push-vorbereitung.json` unter `repoRoot` um `felder` (Issue #2139, der Bericht
 * der Vorbereitung). Ohne lesbare Datei schreibt sie nichts und liefert `false` — ein Bericht allein
 * ist keine Vorbereitung.
 */
export function vorbereitungErgaenzen(repoRoot, felder) {
  const datei = join(repoRoot, ...VORBEREITUNG_DATEI.split("/"));
  let daten;
  try {
    daten = JSON.parse(readFileSync(datei, "utf-8"));
  } catch {
    return false;
  }
  writeFileSync(datei, JSON.stringify({ ...daten, ...felder }, null, 2) + "\n", "utf-8");
  return true;
}

/**
 * Startet den Runner losgeloest (`--detach`, Plan #2131, A8; Issue #2139): derselbe Aufruf ohne
 * `--detach` als eigene Prozessgruppe, stdout und stderr in `.claude/night-run-<zeit>.log`. Mit
 * `--prepare` steht die Markierung „laeuft“ schon vor dem Start (A9) — ein `push main` direkt
 * danach sieht sie. Gibt pid, Log und Ort des Ergebnisses aus und kehrt sofort zurueck; die
 * aufrufende Session wartet nicht. Rueckgabe: der Exit-Code fuer diesen Prozess.
 */
export function losgeloestStarten(repoRoot, argv, { vorbereitung = false, melden = (zeile) => process.stdout.write(`${zeile}\n`) } = {}) {
  // Wie der Stempel des Ergebnisstands: Datum und Uhrzeit ohne Doppelpunkte.
  const iso = gemeinsam.jetzt().toISOString();
  const log = `.claude/night-run-${iso.slice(0, 10)}-${iso.slice(11, 19).replaceAll(":", "")}.log`;
  if (vorbereitung) vorbereitungLaeuftSetzen(repoRoot);
  let fd;
  try {
    mkdirSync(join(repoRoot, ".claude"), { recursive: true });
    fd = openSync(join(repoRoot, ...log.split("/")), "a");
    const kind = abh.spawn(process.execPath, [process.argv[1], ...argv.filter((a) => a !== "--detach")], {
      cwd: repoRoot, detached: true, stdio: ["ignore", fd, fd], env: process.env,
    });
    kind.unref();
    melden(t("losgeloestGestartet", { pid: kind.pid, log }));
    if (vorbereitung) melden(t("losgeloestErgebnis", { datei: VORBEREITUNG_DATEI }));
    return 0;
  } catch (e) {
    if (vorbereitung) vorbereitungLaeuftAufheben(repoRoot);
    melden(t("losgeloestNichtGestartet", { fehler: e.message }));
    return 1;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Die vier Gruende ohne gruenes Urteil, wie `push main` sie nennt (Plan #2131, E3; Issue #2134;
 * Kriterium 4 von #2130): nie geprueft, Stand seitdem geaendert, Pruefung rot, Pruefung laeuft.
 * Sprachunabhaengige Werte; den Satz dazu traegt das Feld `detail`.
 */
export const VORBEREITUNG_GRUENDE = Object.freeze(["nie-geprueft", "stand-geaendert", "rot", "laeuft"]);

/**
 * Laeuft gerade eine Pruefung des Stands? Ja, solange die Umsetzungssperre von einem lebenden
 * Prozess gehalten wird oder der Runner `buildDienst.ergebnis` `laeuft` festhielt. Ein
 * `laeuft` gilt wie in `buildDienstUrteil` (kit/board/build-dienst.mjs) nur innerhalb der Frist
 * oder solange `lebt(laufId)` den Lauf bestaetigt — ein gestorbener Runner sperrte sonst jeden
 * `push main`. Rueckgabe: der Satz fuer `detail` oder `null`.
 */
function laeuftNoch(repoRoot, daten, lebt) {
  const pid = lockPid(join(repoRoot, UMSETZUNG_LOCK));
  if (pid !== null && prozessLaeuft(pid)) return t("umsetzungLaeuft", { lock: UMSETZUNG_LOCK, pid });
  const bd = daten?.buildDienst;
  if (bd?.ergebnis !== "laeuft") return null;
  const alter = gemeinsam.jetzt().getTime() - Date.parse(bd.zeitpunkt);
  if (alter < BUILD_DIENST_FRIST_MS || (typeof lebt === "function" && lebt(bd.laufId ?? null))) {
    return t("buildDienstLaeuft", { zweig: bd.zweig ?? t("nichts") });
  }
  return null;
}

/**
 * Darf `/push-main` den vorbereiteten Stand uebernehmen (E10)? Ja nur, wenn das lokale
 * `<mainBranch>` noch auf `basis` steht, `origin/<mainBranch>` auf `origin`, die Referenz
 * auf `commit`, das Ergebnis `gruen` oder `gruen-offen` ist und die Sicherheitspruefung fuer
 * genau `commit` `gruen` ergab. Kein eigenes `git fetch` — das holt der Skill vorher.
 *
 * Fehlt `sicherheit` (Vorbereitung einer aelteren Kit-Fassung), galt sie einem anderen Commit
 * oder ist ihr Ergebnis nicht `gruen`, lautet der Grund woertlich `sicherheit`: Bei Uebernahme
 * entfallen in `push main` die Schritte 4 bis 6, ohne sie laeuft die Pruefung dort (Plan #1988, E8).
 *
 * `grund` ist ohne Uebernahme genau einer der `VORBEREITUNG_GRUENDE` (Issue #2134), sonst `null`;
 * `detail` ist der Satz dazu, bei der Sicherheitspruefung woertlich `sicherheit`. `laeuft` geht
 * jedem anderen Grund vor; ein veraenderter Stand geht `rot` vor, denn das rote Urteil galt
 * einem frueheren Stand. Eine kritische oder ausgefallene Sicherheitspruefung ist `rot`, eine
 * fehlende oder einem anderen Commit geltende `nie-geprueft`. `lebt(laufId)` fragt den Puls des
 * Runners fuer ein `laeuft` des Build-Diensts nach der Frist.
 *
 * Rueckgabe: `{ uebernehmen, grund, detail, commit, offen, zeitpunkt, mutation, sicherheit }` — `mutation` ist das
 * festgehaltene Ergebnis des Mutationstests oder `null` (Issue #1673, E4), `sicherheit` das
 * festgehaltene Ergebnis der Sicherheitspruefung oder `null`. Mit `verwerfen` stattdessen
 * Datei und Referenz loeschen: `{ verworfen: { datei, referenz } }`, je ob es sie gab.
 */
export function vorbereitungPruefen({ repoRoot, verwerfen = false, lebt = null }) {
  const pfad = join(repoRoot, ...VORBEREITUNG_DATEI.split("/"));
  if (verwerfen) {
    const datei = existsSync(pfad);
    rmSync(pfad, { force: true });
    const referenz = commitVon(repoRoot, VORBEREITUNG_REFERENZ) !== null;
    if (referenz) gitIm(repoRoot, ["update-ref", "-d", VORBEREITUNG_REFERENZ]);
    return { verworfen: { datei, referenz } };
  }

  let daten;
  try {
    daten = JSON.parse(readFileSync(pfad, "utf-8"));
  } catch {
    daten = null;
  }
  const laeuft = laeuftNoch(repoRoot, daten, lebt);
  if (daten === null) {
    const ohne = ohneVorbereitung();
    return laeuft ? { ...ohne, grund: "laeuft", detail: laeuft } : ohne;
  }
  const urteil = (grund, detail = null) => ({
    uebernehmen: grund === null, grund, detail, commit: daten.commit ?? null, offen: daten.offen ?? [], zeitpunkt: daten.zeitpunkt ?? null,
    mutation: daten.mutation ?? null, sicherheit: daten.sicherheit ?? null,
  });
  if (laeuft) return urteil("laeuft", laeuft);
  const verschoben = standVerschoben(repoRoot, daten);
  if (verschoben) return urteil("stand-geaendert", verschoben);
  if (daten.ergebnis !== "gruen" && daten.ergebnis !== "gruen-offen") return urteil("rot", t("nurGruen", { ergebnis: daten.ergebnis }));
  const sicherheit = sicherheitGrund(repoRoot, daten);
  return sicherheit ? urteil(sicherheit, "sicherheit") : urteil(null);
}

/** Der Satz, wenn `<mainBranch>`, `origin/<mainBranch>` oder die Referenz seit der Vorbereitung weiterzog, sonst `null`. */
function standVerschoben(repoRoot, daten) {
  const mainBranch = vorbereitungMainBranch(repoRoot);
  const kurz = (c) => (c ? c.slice(0, 12) : t("nichts"));
  if (commitVon(repoRoot, `refs/heads/${mainBranch}`) !== daten.basis) return t("standVerschoben", { ref: mainBranch, commit: kurz(daten.basis) });
  if (commitVon(repoRoot, `refs/remotes/origin/${mainBranch}`) !== daten.origin) return t("standVerschoben", { ref: `origin/${mainBranch}`, commit: kurz(daten.origin) });
  if (commitVon(repoRoot, VORBEREITUNG_REFERENZ) !== daten.commit) return t("referenzVerschoben", { ref: VORBEREITUNG_REFERENZ, commit: kurz(daten.commit) });
  return null;
}

/**
 * Der Grund, den die Sicherheitspruefung gibt (Plan #1988, E8; Issue #2134): `null` bei `gruen`
 * fuer genau `commit`, `rot` bei einem anderen gemessenen Ergebnis fuer ihn, sonst `nie-geprueft`.
 * Eine entfallene gilt nur, solange die Strenge sie weiter vor die Auslieferung legt; nach einem
 * Aufstieg ist sie `nie-geprueft` (Issue #2116).
 */
function sicherheitGrund(repoRoot, daten) {
  const sicherheit = daten.sicherheit;
  if (!sicherheit || sicherheit.commit !== daten.commit) return "nie-geprueft";
  if (sicherheit.ergebnis === "gruen") return null;
  if (sicherheit.ergebnis === SICHERHEIT_ENTFALLEN) return sicherheitVorAuslieferung(repoRoot) ? null : "nie-geprueft";
  return VORBEREITUNG_SICHERHEIT.includes(sicherheit.ergebnis) ? "rot" : "nie-geprueft";
}

// --- Der Lauf im Build-Dienst (Plan #1965, E1–E5, E8, E10; Issue #1974) ---
//
// Nach der Session `/push-main prepare` bringt der Runner selbst den vorbereiteten Commit auf
// den Pruefzweig, wartet auf das Urteil und haelt es unter `buildDienst` in der Datei der
// Vorbereitung fest (E1). Das steht seit Issue #2018 im Pro-Teil kit/board/build-dienst.mjs;
// hier bleiben der Weg der Push-Stufe, der offene Punkt und der Aufruf.

// Die Obergrenze des Wartens auf das Urteil, ab dem Push (E5, PO-Antwort 3), steht in
// kit/board/arbeitskopie.mjs (Issue #1976): `push main` misst ein `laeuft` an derselben Frist.
export { BUILD_DIENST_FRIST_MS };

/** Der offene Punkt einer Vorbereitung, deren voller Lauf im Build-Dienst aussteht (E17). */
export function buildDienstPunkt(zweig) {
  return t("buildDienstOffen", { zweig });
}

/**
 * Der Pruefzweig des Laufs: der Zweig, wenn die Push-Stufe im Build-Dienst prueft, sonst
 * `null` — auch, wenn sich der Weg nicht ermitteln laesst; dann steht der Grund im Protokoll.
 */
export function pruefzweigDesLaufs(repoRoot) {
  try {
    const weg = abh.pushWeg(repoRoot);
    return weg?.ort === "buildDienst" ? weg.zweig : null;
  } catch (e) {
    log(t("pushWegUnbekannt", { fehler: e.message }));
    return null;
  }
}

/**
 * Die Pro-Meldung zum Build-Dienst in der Projektsprache, `null` ohne kit/board/pro.mjs. In
 * Community schiebt der Runner nichts auf einen Pruefzweig (Plan #2131, A2; Issue #2018); in Pro
 * ersetzt die Pruefung je Karte die Vorbereitung (Plan #2145, E14).
 */
async function buildDienstMeldung() {
  const pro = await import("../board/pro.mjs").catch(() => null);
  return pro ? pro.proMeldungText("build-verdict") : null;
}

/**
 * Der Lauf im Build-Dienst nach der Vorbereitung, erreichbar nur noch in Community: Dort schiebt
 * der Runner nichts, fragt den Code-Host nicht, schreibt keine `.claude/pruefzweig-offen.json` und
 * laesst die Vorbereitung unberuehrt (Issue #2018). Rueckgabe `{ ergebnis: "pro", meldung }` mit
 * der Pro-Meldung in der Projektsprache; der naechste `push main` geht den vollen Weg (#1995
 * Kriterium 1). In Pro gibt es seit Plan #2145 (E14, Issue #2155) keine Vorbereitung mehr: Die
 * Pruefung je Karte prueft im Build-Dienst.
 */
export async function vorbereitungImBuildDienst() {
  return { ergebnis: "pro", meldung: await buildDienstMeldung() };
}

/**
 * Ruft `findings.mjs suggest --kind <a>` fuer eine Mangel-Art an der Schwelle
 * (Issue #804, night-70) und protokolliert das Ergebnis in genau einer Zeile.
 *
 * KEIN GATE, wie bei den Auswertungen (E9): Ein Fehlschlag — fehlendes Werkzeug,
 * unerreichbares Board, unlesbare Zustandsdatei — ist eine Protokollzeile und haelt den
 * Abbau des Worktrees nicht auf. Auf dem Spiel steht ein Vorschlag, den ein Mensch
 * ohnehin erst bewerten muss; der Abbau dagegen raeumt einen Worktree weg, dessen
 * Liegenbleiben den naechsten Lauf stoert.
 */
function befundeVorschlagen(repoRoot, art) {
  try {
    if (!existsSync(BEFUNDE_PATH)) throw new Error(t("werkzeugFehlt", { pfad: BEFUNDE_PATH }));
    const res = gemeinsam.spawnSync(process.execPath, [BEFUNDE_PATH, "suggest", "--kind", art], {
      encoding: "utf-8", cwd: repoRoot, maxBuffer: BOARD_MAX_BUFFER,
    });
    if (res.error) throw new Error(t("nichtGestartet", { fehler: res.error.message }));
    let stand;
    try {
      stand = JSON.parse(res.stdout);
    } catch (err) {
      throw new Error(t("ausgabeUnlesbar", { fehler: err.message }), { cause: err });
    }
    if (res.status !== 0 || stand?.ok !== true) throw new Error(stand?.fehler || t("exit", { status: res.status }));
    const kennung = stand.karte === null ? t("poolIdee", { id: stand.ideaId }) : t("karte", { karte: stand.karte });
    if (stand.angelegt) log(t("vorschlagAngelegt", { art, kennung, titel: stand.titel }));
    else if (stand.ergaenzt) log(t("vorschlagErgaenzt", { art, karte: stand.karte, stand: stand.zaehlerstand }));
    else log(t("keinVorschlag", { art, grund: stand.grund }));
  } catch (err) {
    log(t("vorschlagFehlgeschlagen", { art, fehler: err.message }));
  }
}

/**
 * Der Rueckweg unmittelbar vor einem Worktree-Abbau — in der Kette an BEIDEN Abbaustellen
 * gerufen (vor der Stufe umsetzung und im finally am Kettenende), im Prueflauf im finally
 * seiner Runden (Issue #1028). Das Nullen von `wt` nach dem ersten Abbau verhindert den
 * zweiten Lauf und damit doppeltes Anhaengen; die Arten an der Schwelle stehen als eine
 * Zeile im Protokoll.
 *
 * Je zurueckgegebener Art folgt ein `findings.mjs suggest --kind <a>` (Issue #804):
 * Hier — am Anlass — und nicht erst beim naechsten `push main`, weil ein zweiter Ort
 * ein zweiter Zeitpunkt waere, zu dem dieselbe Zahl anders herauskommen kann (E9).
 */
export function befundeZurueckUndVorschlagen(lauf) {
  const arten = befundeZurueck(lauf.wt, lauf.repoRoot, log);
  if (arten.length === 0) return;
  log(t("befundeZurueckgeholt", { arten: arten.join(", ") }));
  for (const art of arten) befundeVorschlagen(lauf.repoRoot, art);
}

// --- Fester Kit-Stand je unbeaufsichtigtem Lauf (Issue #1102, Plan #1101) ---
//
// Ein unbeaufsichtigter Lauf arbeitet und prueft mit dem Kit des letzten Pushs, nicht mit
// der Kopie der Hauptkopie: Die frischt jedes Paket ueber `sync-blobs` auf, und das naechste
// Paket desselben Laufs arbeitete schon mit dem neuen, unbewaehrten Werkzeug. Der Stand ist
// eine eigene Kit-Installation aus `origin/<mainBranch>` in einem Worktree (A1). Der Runner
// selbst laeuft als Kind aus ihr (A2), und ihre Kopie wird in jeden Baum eingesetzt, in dem
// Sitzungen laufen (A3). Die Markierung im Baum bindet die Wirkung auf `sync-blobs` und den
// Commit-Hook an genau diesen Baum (A4) — eine blosse Umgebungsvariable erbte jeder
// Testprozess eines Laufs samt seiner Fixture-Repos.

// KIT_STAND_MARKIERUNG, die Markierung eines eingesetzten Baums (A4), steht in
// kit/board/arbeitskopie.mjs: Die Git-Helfer nehmen sie vom Rest-Guard aus (Issue #1224, #1858).

// Der Stand dieses Laufs, `{ commit, pfad }` — gesetzt nur im Kind (A2), sonst `null`.
let KIT_STAND_LAUF = null;
// Die Baeume, die dieser Prozess markiert hat. Freigegeben wird beim Ende jedes Laufs, auch
// beim Abbruch ueber process.exit, der kein finally mehr erreicht.
export const KIT_STAND_BAEUME = new Set();

/** Traegt der Stand `ref` die Kit-Quelle selbst (E3)? Nur dann greift der Mechanismus. */
function traegtKitQuelle(repoRoot, ref) {
  return ["kit/night.mjs", "tools/sync-blobs.mjs"]
    .every((datei) => gitIm(repoRoot, ["cat-file", "-e", `${ref}:${datei}`]).status === 0);
}

/**
 * Die Laufarten, die im Kit-Repo mit dem lokalen `<mainBranch>` arbeiten statt mit dem
 * veroeffentlichten Stand (Issue #2150, Plan #2145, E16): die Pruefung je Karte und der
 * Reparatur-Kreislauf. Aendert eine Karte das Pruefen, gilt das schon bei der naechsten Pruefung.
 */
export const LAUFARTEN_LOKALER_STAND = Object.freeze(["card-check", "reparatur"]);

/**
 * Der Stand des Laufs: Commit und Commit-Zeit von `refs/remotes/origin/<mainBranch>`, ohne
 * `git fetch` (E1). `null`, wenn der Commit die Kit-Quelle nicht traegt (E3) — das ist jedes
 * Projekt ausser dem Kit selbst. Fuer die Laufarten aus `LAUFARTEN_LOKALER_STAND` ist es der
 * lokale `refs/heads/<mainBranch>` (Plan #2145, E16); die Hauptkopie bleibt dabei unberuehrt.
 *
 * Fehlt der Verweis, entscheidet der eigene Arbeitsstand: Traegt er die Kit-Quelle, ist das
 * Fehlen ein Abbruchgrund (E2), und die Funktion wirft. Sonst ist es ein anderes Projekt
 * ohne Remote, das unveraendert laeuft.
 */
export function kitStandErmitteln(repoRoot, mainBranch, laufart = null) {
  const lokal = LAUFARTEN_LOKALER_STAND.includes(laufart);
  const verweis = lokal ? `refs/heads/${mainBranch}` : `refs/remotes/origin/${mainBranch}`;
  const res = gitIm(repoRoot, ["rev-parse", "--verify", "--quiet", `${verweis}^{commit}`]);
  if (res.status !== 0) {
    if (!traegtKitQuelle(repoRoot, "HEAD")) return null;
    throw new Error(t("verweisFehlt", { branch: mainBranch }));
  }
  const commit = res.stdout.trim();
  if (!traegtKitQuelle(repoRoot, commit)) return null;
  const commitZeit = gitIm(repoRoot, ["show", "-s", "--format=%cI", commit]).stdout.trim();
  return { commit, ref: lokal ? mainBranch : `origin/${mainBranch}`, commitZeit };
}

/**
 * Stellt den Stand bereit (A1): ein abgeloester Worktree auf `commit` mit einer installierten
 * Kopie, gebaut auf dem Weg des Menschen — `.claude/kit/`, `.claude/skills/` und `.claude/agents/` anlegen,
 * das `sync-blobs` DIESES Stands laufen lassen, die Regeltexte nach `.claude/` kopieren.
 * Ein zweiter Weg mit eigener Dateiliste liefe beim ersten neuen Werkzeug auseinander.
 *
 * Er raeumt nichts ab (Issue #1200): Liegengebliebene Staende derselben Laufart raeumt erst
 * das Kind, wenn seine Vorpruefungen bestanden sind (`kitStaendeAufraeumen`) — ein Start,
 * der ohnehin abbricht, soll nichts wegnehmen. Scheitert ein Schritt, wirft die Funktion mit Grund
 * und laesst keinen halben Stand liegen; den Abbruch entscheidet der Aufrufer (E2).
 */
export function kitStandBereitstellen(repoRoot, commit, laufart) {
  const praefix = `kitstand-${laufart}`;
  // Ein eigener Stempel: Der Lauf-Stempel entsteht erst im Kind.
  const stempel = `${gemeinsam.jetzt().toISOString().replaceAll(/[-:.TZ]/g, "")}-${process.pid}`;
  const pfad = worktreeAnlegen({ repoRoot, stempel, praefix, ref: commit, spiegeln: false });
  try {
    mkdirSync(join(pfad, ".claude", "kit"), { recursive: true });
    mkdirSync(join(pfad, ".claude", "skills"), { recursive: true });
    mkdirSync(join(pfad, ".claude", "agents"), { recursive: true });
    // KIT_ROOT ueberschrieben: Eine ererbte Variable liesse sync-blobs in den fremden Root schreiben.
    const res = gemeinsam.spawnSync(process.execPath, [join(pfad, "tools", "sync-blobs.mjs")], {
      cwd: pfad, encoding: "utf-8", env: { ...process.env, KIT_ROOT: pfad },
    });
    if (res.status !== 0) {
      throw new Error(t("syncBlobsFehlgeschlagen", {
        commit: commit.slice(0, 12), meldung: ersteZeile((res.stderr || res.stdout || res.error?.message || "").trim()),
      }));
    }
    const vorlagen = join(pfad, "templates");
    for (const name of readdirSync(vorlagen).filter((n) => /^CLAUDE-.*\.md$/.test(n))) {
      cpSync(join(vorlagen, name), join(pfad, ".claude", name));
    }
  } catch (err) {
    worktreeEntfernen(pfad, repoRoot);
    throw err;
  }
  return pfad;
}

/**
 * Setzt den Stand in einen Baum ein, in dem Sitzungen laufen (A3): `.claude/kit/*`,
 * `.claude/skills/*`, `.claude/agents/*` und `.claude/CLAUDE-*.md` des Stands. Es wird nur
 * ueberschrieben, nichts geloescht — was `sync-blobs` nicht schreibt, gehoert nicht zum Stand
 * und bleibt. Danach die Markierung `{ commit, pfad, pid, seit }` (A4). Ein Stand ohne
 * `.claude/agents/` (vor Issue #1377 bereitgestellt) setzt keine Agenten ein.
 */
export function kitStandEinsetzen(stand, baum) {
  const quelle = join(stand.pfad, ".claude");
  const ziel = join(baum, ".claude");
  for (const teil of ["kit", "skills", "agents"]) {
    if (teil === "agents" && !existsSync(join(quelle, teil))) continue;
    cpSync(join(quelle, teil), join(ziel, teil), { recursive: true, force: true });
  }
  for (const name of readdirSync(quelle).filter((n) => /^CLAUDE-.*\.md$/.test(n))) {
    cpSync(join(quelle, name), join(ziel, name), { force: true });
  }
  const markierung = { commit: stand.commit, pfad: stand.pfad, pid: process.pid, seit: gemeinsam.jetzt().toISOString() };
  writeFileSync(join(baum, KIT_STAND_MARKIERUNG), JSON.stringify(markierung, null, 2) + "\n", "utf-8");
  KIT_STAND_BAEUME.add(baum);
}

/** Entfernt die Markierung; die Kopie bleibt auf dem Stand (E5). */
export function kitStandFreigeben(baum) {
  rmSync(join(baum, KIT_STAND_MARKIERUNG), { force: true });
  KIT_STAND_BAEUME.delete(baum);
}

/** Gibt einen Baum frei, den DIESER Prozess markiert hat — nie die Markierung eines anderen Laufs. */
export function kitStandAbgeben(baum) {
  if (KIT_STAND_BAEUME.has(baum)) kitStandFreigeben(baum);
}

/**
 * Setzt den Stand dieses Laufs ein, falls es einen gibt — die vier Stellen aus A3. Einmal je
 * Baum: Der Umsetzungslauf ruft es vor jeder Session, eingesetzt wird nur beim ersten Mal.
 */
export function kitStandInBaum(baum) {
  if (KIT_STAND_LAUF && !KIT_STAND_BAEUME.has(baum)) kitStandEinsetzen(KIT_STAND_LAUF, baum);
}

/**
 * Raeumt die liegengebliebenen Staende der eigenen Laufart ab (E4, Issue #1200) — im Kind,
 * erst nach `vorbereiten()`: Ein Start, der an den Vorpruefungen scheitert, hat dann nichts
 * weggeraeumt. Der eigene Stand bleibt ausdruecklich stehen; nebeneinander laufende Laufarten
 * raeumen einander nichts weg. Nichts im Dry-Run und nichts ohne Stand.
 */
export function kitStaendeAufraeumen(args) {
  if (args.dryRun || !KIT_STAND_LAUF) return;
  const praefix = `kitstand-${laufArt(args)}`;
  for (const p of worktreesAufraeumen(process.cwd(), praefix, KIT_STAND_LAUF.pfad)) log(t("standEntfernt", { pfad: p }));
}

/** Die Startzeile des festen Kit-Stands (A7) — nichts ohne Stand. */
export function kitStandMelden() {
  if (ZUSTAND.LAUF?.kitStand) log(kitStandZeile(ZUSTAND.LAUF.kitStand));
}

/**
 * Ist dieser Prozess das Kind, das aus dem Stand laeuft (A2)? `KIT_STAND` allein genuegt
 * nicht: Ein Runner, den ein Test in einer unbeaufsichtigten Sitzung startet, erbt die Variable,
 * liegt aber nicht unter dem Stand — er baut seinen eigenen.
 */
export function istStandKind(skript, env = process.env) {
  if (!env.KIT_STAND || !env.KIT_STAND_PFAD) return false;
  try {
    const rel = relative(realpathSync(env.KIT_STAND_PFAD), realpathSync(skript));
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  } catch {
    return false;
  }
}

/** Was `KIT_STAND` und `KIT_STAND_PFAD` jeder Sitzung mitgeben — leer ohne Stand. */
export function kitStandUmgebung() {
  return KIT_STAND_LAUF ? { KIT_STAND: KIT_STAND_LAUF.commit, KIT_STAND_PFAD: KIT_STAND_LAUF.pfad } : {};
}

/**
 * Die Laufkennung jeder Sitzung (Issue #1194): `KIT_NIGHT_RUN` ist der `start` des
 * Ergebnisstands, unveraendert als ISO-Zeitstempel — derselbe Wert, den die Laufmeldung
 * als `startedAt` sendet. board.mjs schickt ihn als Header `X-Night-Run` mit, und das Board
 * ordnet daran jede Karte ihrem Lauf zu. Leer ohne Ergebnisstand (--dry-run).
 */
export function laufKennungUmgebung() {
  return ZUSTAND.LAUF?.start ? { KIT_NIGHT_RUN: ZUSTAND.LAUF.start } : {};
}

/** Das Feld `kitStand` des Laufberichts (A7): `{ commit, ref, commitZeit }` oder `null`. */
export function kitStandFeld() {
  if (!KIT_STAND_LAUF) return null;
  const mainBranch = ZUSTAND.config?.mainBranch || "main";
  const commitZeit = gitIm(process.cwd(), ["show", "-s", "--format=%cI", KIT_STAND_LAUF.commit]).stdout.trim() || null;
  return { commit: KIT_STAND_LAUF.commit, ref: `origin/${mainBranch}`, commitZeit };
}

/**
 * Die Zeile `Kit-Stand: <commit, 12 Stellen> (origin/<mainBranch> vom <JJJJ-MM-TT HH:MM>)` (A7),
 * in einem englischen Projekt unter dem Marker `Kit-Revision:` aus dem Register (Issue #1490).
 * SYNC: dieselbe Form baut `kitStandZeileFuer` in kit/board.mjs fuer jeden Kommentar.
 */
export function kitStandZeile(kitStand) {
  const zeit = kitStand.commitZeit
    ? t("standZeit", { datum: kitStand.commitZeit.slice(0, 10), uhrzeit: kitStand.commitZeit.slice(11, 16) })
    : "";
  const marker = namen ? namen.markerName("kitStand", namen.prozessSprache()) : "Kit-Stand:";
  return `${marker} ${kitStand.commit.slice(0, 12)} (${kitStand.ref}${zeit})`;
}

/**
 * Der Stand-Schritt in main() (A2): ermitteln, bereitstellen, den Runner des Stands als Kind
 * starten und dessen Exit-Code zurueckgeben. `null` heisst, dieser Prozess arbeitet selbst —
 * als Kind (dann ist der Stand gesetzt) oder ohne Stand. Fehler brechen ab (E2).
 */
export async function kitStandSchritt(args, argv) {
  if (args.dryRun) return null;
  if (istStandKind(process.argv[1])) {
    KIT_STAND_LAUF = { commit: process.env.KIT_STAND, pfad: process.env.KIT_STAND_PFAD };
    return null;
  }
  const repoRoot = process.cwd();
  const configPfad = join(repoRoot, ".claude", "workflow.config.json");
  let stand;
  let pfad;
  try {
    const mainBranch = (existsSync(configPfad) ? ladeConfigMitOverrides(configPfad)?.mainBranch : null) || "main";
    stand = kitStandErmitteln(repoRoot, mainBranch, laufArt(args));
    if (!stand) return null;
    pfad = kitStandBereitstellen(repoRoot, stand.commit, laufArt(args));
  } catch (err) {
    fail(t("nichtBereitgestellt", { fehler: err.message }), "umgebung");
  }
  process.stdout.write(`${t("laufArbeitetMit", { zeile: kitStandZeile(stand), pfad })}\n`);
  return await new Promise((fertig) => {
    const kind = abh.spawn(process.execPath, [join(pfad, ".claude", "kit", "night.mjs"), ...argv], {
      cwd: repoRoot, stdio: "inherit",
      env: { ...process.env, KIT_STAND: stand.commit, KIT_STAND_PFAD: pfad },
    });
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      process.on(signal, () => kind.kill(signal));
    }
    kind.on("error", (err) => {
      process.stderr.write(`${t("runnerNichtGestartet", { fehler: err.message })}\n`);
      fertig(1);
    });
    kind.on("exit", (code, signal) => {
      // Die Pruefung je Karte (E16) startet oft und nebeneinander: Ihr Stand gehoert allein diesem
      // Aufruf und geht mit ihm, statt bis zum Aufraeumen der naechsten Laufart liegenzubleiben.
      if (LAUFARTEN_LOKALER_STAND.includes(laufArt(args))) worktreeEntfernen(pfad, repoRoot);
      fertig(code ?? (signal ? 128 + (osConstants.signals[signal] ?? 0) : 1));
    });
  });
}

