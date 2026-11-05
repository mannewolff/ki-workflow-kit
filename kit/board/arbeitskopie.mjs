// SPDX-License-Identifier: MIT
/**
 * board/arbeitskopie.mjs — die Arbeitskopie neben der Hauptkopie (Issue #1858, Plan #1853,
 * E3, E15): Worktree anlegen, abbauen und aufraeumen, die Befunde aus ihm zurueckholen und
 * pruefen, ob das lokale `<mainBranch>` nachgezogen werden darf — dazu die Helfer, an denen
 * das haengt: die Reste des Arbeitsbaums (`gitReste` und seine Ausnahmen), die Prozess-Id
 * einer Lock-Datei und die Laufzeitpfade `UMSETZUNG_LOCK`, `KIT_STAND_MARKIERUNG`,
 * `VORBEREITUNG_DATEI`, `PRUEFZWEIG_OFFEN_DATEI` und `KARTENPRUEFUNG_DATEI`.
 *
 * Ein Community-Teil. Die Release-Skills (`push main`, `merge production`) arbeiten ueber
 * kit/worktree.mjs in einer solchen Arbeitskopie, auch ohne den Runner. Bis #1858 standen die
 * Funktionen in kit/night/kitstand.mjs und kit/night/grundlagen.mjs; dort werden sie seither
 * nur weiterexportiert. KEIN ZWEITER WEG: Runner und Release-Skills benutzen dieselben
 * Funktionen — sie wurden verschoben, nicht kopiert (E15).
 *
 * Dieser Teil importiert nie aus kit/night/ (test/kit-importrichtung.test.mjs). Was der
 * Runner fuehrt — die geladene Config, sein Protokoll, seine Sperren —, kommt als Parameter
 * herein. Die Abhaengigkeiten nach aussen (git, ein Programm mit Warten, Uhr, Prozess-Probe)
 * lassen sich ueber `kitstandAbhaengigkeiten` einsetzen; der Runner reicht den Haken unter
 * demselben Namen weiter und ergaenzt seine eigenen Abhaengigkeiten.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, rmSync, readdirSync, cpSync, realpathSync } from "node:fs";
import { join, dirname, basename, resolve, relative, isAbsolute } from "node:path";
import { tmpdir, hostname } from "node:os";

import { normalisiereConfig } from "./config-namen.mjs";
import { text } from "./namen.mjs";
import { vergleicheText } from "../checks.mjs";

// Die Texte an den Menschen liegen unter kit/texte/board-arbeitskopie.mjs.
import { TEXTE } from "../texte/board-arbeitskopie.mjs";

export { TEXTE };

/** Ein Text dieses Teils in der Projektsprache. */
const t = (schluessel, werte) => text(TEXTE, schluessel, werte);

/** Der Pfad der Lock-Datei der Umsetzung (Issue #696), relativ zur Hauptkopie. */
export const UMSETZUNG_LOCK = ".claude/night-umsetzung.lock";

/** Die Markierung eines eingesetzten Baums (Issue #1102, A4), relativ zu seiner Wurzel — mit `/` wie UMSETZUNG_LOCK. */
export const KIT_STAND_MARKIERUNG = ".claude/kit-stand.json";

/**
 * Die Statusdatei der Pruefung je Karte (Issue #2149, Plan #2145, E2), relativ zur Hauptkopie: Sperre
 * mit PID, Nachlauf und der zuletzt gepruefte Stand. Sie bleibt beim Spiegeln in der Hauptkopie.
 */
export const KARTENPRUEFUNG_DATEI = ".claude/kartenpruefung.json";

/** Der Worktree-Praefix der Pruefung je Karte (Issue #2149, Plan #2145, E4, E22). */
export const KARTENPRUEFUNG_PRAEFIX = "kartenpruefung";

/** Der Worktree-Praefix des Reparatur-Kreislaufs (Plan #2145, E10, E22). */
export const REPARATUR_PRAEFIX = "reparatur";

/** Die feste, kartenuebergreifende Stelle der vorbereiteten Veroeffentlichung in der Hauptkopie (Plan #1243, A6). */
export const VORBEREITUNG_DATEI = ".claude/push-vorbereitung.json";

/**
 * Die offen gebliebene Freigabe des Pruefzweigs (Plan #1965, E8; Issue #1973), relativ zur
 * Hauptkopie: Gelingt dem Runner das Loeschen nach dem Urteil nicht (ohne Netz, hartes Ende,
 * fremder Stand), haelt er hier `zweig`, `commit`, `laufId` und `grund` fest.
 * `worktree.mjs clean-check-branch` holt die Freigabe mit derselben Lease nach.
 */
export const PRUEFZWEIG_OFFEN_DATEI = ".claude/pruefzweig-offen.json";

/** Haelt die offene Freigabe des Pruefzweigs fest; eine fruehere wird ersetzt. */
export function pruefzweigOffenSchreiben(repoRoot, { zweig, commit, laufId = null, grund = null }) {
  const pfad = join(repoRoot, ...PRUEFZWEIG_OFFEN_DATEI.split("/"));
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, `${JSON.stringify({ zweig, commit, laufId, grund }, null, 2)}\n`);
}

/**
 * Die offene Freigabe des Pruefzweigs oder null, wenn nichts offen ist. Eine unlesbare Datei
 * oder eine ohne `zweig` und `commit` ist ein Fehler: Still als „nichts offen" gelesen, bliebe
 * der Zweig liegen, ohne dass es jemand erfaehrt.
 */
export function pruefzweigOffenLesen(repoRoot) {
  const pfad = join(repoRoot, ...PRUEFZWEIG_OFFEN_DATEI.split("/"));
  if (!existsSync(pfad)) return null;
  let daten;
  try {
    daten = JSON.parse(readFileSync(pfad, "utf-8"));
  } catch (err) {
    throw new Error(t("pruefzweigOffenUnlesbar", { datei: PRUEFZWEIG_OFFEN_DATEI, grund: err.message }), { cause: err });
  }
  if (typeof daten?.zweig !== "string" || !daten.zweig || typeof daten.commit !== "string" || !daten.commit) {
    throw new Error(t("pruefzweigOffenUnvollstaendig", { datei: PRUEFZWEIG_OFFEN_DATEI }));
  }
  return { zweig: daten.zweig, commit: daten.commit, laufId: daten.laufId ?? null, grund: daten.grund ?? null };
}

/**
 * Das Urteil ohne vorbereitete Veroeffentlichung (Plan #1243, E10): Die Datei fehlt oder ist
 * unlesbar. Der Runner urteilt so, wenn er sie nicht lesen kann, und `worktree.mjs`, wenn es
 * den Runner gar nicht gibt (Issue #1858) — dann hat ihn auch niemand vorbereitet. Der Grund
 * ist `nie-geprueft`, der Satz dazu steht in `detail` (Issue #2134).
 */
export function ohneVorbereitung() {
  return { uebernehmen: false, grund: "nie-geprueft", detail: t("keineVorbereitung", { datei: VORBEREITUNG_DATEI }), commit: null, offen: [], zeitpunkt: null, mutation: null, sicherheit: null };
}

/**
 * Die Obergrenze des Wartens auf das Urteil des Build-Diensts, ab dem Push (Plan #1965, E5, E9),
 * seit Issue #2132 die 90 Minuten des Runners aus Kriterium 5 von #2130.
 * Das Urteil selbst liest seit Issue #2017 der Pro-Teil kit/board/build-dienst.mjs.
 */
export const BUILD_DIENST_FRIST_MS = 90 * 60_000;

// --- Abhaengigkeiten nach aussen (Plan #1199, E6) ---

const VORGABEN = Object.freeze({
  // PATH-Aufloesung bewusst, siehe die Begruendung zu den Git-Helfern in kit/night/grundlagen.mjs (S4036, Issue #183).
  git: (repoRoot, gitArgs) => spawnSync("git", gitArgs, { encoding: "utf-8", cwd: repoRoot }),
  // Ein Programm, auf dessen Ende gewartet wird; der Runner startet so sync-blobs und findings.mjs.
  spawnSync: (befehl, argumente, optionen) => spawnSync(befehl, argumente, optionen),
  jetzt: () => new Date(),
  kill: (pid, signal) => process.kill(pid, signal),
});

/** Die eingesetzten Abhaengigkeiten; der Runner liest sie hier, statt eigene zu fuehren. */
export const abh = { ...VORGABEN };

/**
 * Setzt Abhaengigkeiten des Teils ein; nicht genannte behalten ihren Wert, ohne Argument
 * gelten wieder alle Vorgaben. Nur fuer Tests.
 */
export function kitstandAbhaengigkeiten(neu) {
  if (neu === undefined) {
    Object.assign(abh, VORGABEN);
    return;
  }
  for (const [name, fn] of Object.entries(neu)) {
    if (!Object.hasOwn(VORGABEN, name)) throw new Error(t("abhaengigkeitUnbekannt", { name }));
    abh[name] = fn;
  }
}

/** Die Vorgabe fuer `melden`: eine Zeile auf stdout. */
function zeileAusgeben(zeile) {
  process.stdout.write(`${zeile}\n`);
}

// --- Die Prozess-Id einer Lock-Datei (Plan #691, E10; Issue #696) ---
//
// Den Umsetzungs-Lock nimmt und gibt der Runner (kit/night/kitstand.mjs). Hier steht, woran
// jeder Leser erkennt, ob ihn ein laufender Prozess haelt.

/**
 * Die Prozess-Id aus einer Lock-Datei — null, wenn es sie nicht gibt, sie nicht lesbar ist
 * oder nicht als positive ganze Zahl dasteht. Alle drei zaehlen als verwaist: Ein Lock,
 * dessen Halter nicht benennbar ist, kann niemanden abhalten.
 *
 * `0` ist ausdruecklich keine gueltige Id — `process.kill(0, 0)` zielte auf die eigene
 * Prozessgruppe und meldete damit fuer jede kaputte Datei einen lebenden Halter.
 */
export function lockPid(pfad) {
  try {
    return pidAusInhalt(readFileSync(pfad, "utf-8"));
  } catch {
    return null;
  }
}

/** Die Prozess-Id aus dem Inhalt einer Lock-Datei, nach denselben Regeln wie `lockPid`. */
export function pidAusInhalt(inhalt) {
  const pid = Number(inhalt.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/**
 * Laeuft der Prozess mit dieser Id noch? `ESRCH` heisst nein; `EPERM` heisst, es gibt ihn
 * und er gehoert einem anderen Nutzer — das ist kein verwaister Lock.
 */
export function prozessLaeuft(pid) {
  try {
    abh.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== "ESRCH";
  }
}

// --- Nachziehen der Hauptkopie (Issue #929) ---

/** Die Config der Hauptkopie, so weit sie ohne Lauf-Kontext lesbar ist (Muster #800). */
export function configVonPlatte(repoRoot) {
  try {
    return normalisiereConfig(JSON.parse(readFileSync(join(repoRoot, ".claude", "workflow.config.json"), "utf-8"))).config;
  } catch {
    return null; // keine oder unlesbare Config ist ein normaler Zustand
  }
}

/**
 * Darf das lokale `<mainBranch>` der Hauptkopie jetzt nachgezogen werden (Issue #929)?
 *
 * Die Release-Skills arbeiten seit #929 in einem eigenen Worktree und pushen von dort;
 * das lokale `<mainBranch>` bleibt dabei zurueck. Nachgezogen wird es nur, wenn niemand
 * sonst in der Hauptkopie arbeitet: Ein `git rebase` unter einer laufenden Umsetzung
 * verschoebe ihr den Boden, und ein schmutziger Baum bringt den Rebase zum Halten.
 *
 * Gemessen wird mit den Mitteln, die es schon gibt — die Prozess-Id-Logik des
 * Umsetzungs-Locks und `gitReste()` mit denselben Ausnahmen wie der Rest-Guard. Zwei
 * eigene Messungen desselben Zustands liefen auseinander (dieselbe Begruendung wie #818).
 *
 * `sperren` sind die Sperren, an denen ein Lauf des Runners erkennbar ist (Issue #1858, Plan
 * #1853, E3). Die Vorgabe ist der Umsetzungs-Lock — dieselbe Liste, die der Runner als
 * `RUNNER_SPERREN` fuehrt. Ohne Runner liegt keine Sperre, und die Pruefung findet keine.
 *
 * Rueckgabe: `{ nachziehen, grund }`. `grund` ist bei `true` null, sonst der Satz, den
 * der Skill in seinen Bericht uebernimmt.
 */
export function nachziehenPruefen(repoRoot = process.cwd(), sperren = [UMSETZUNG_LOCK]) {
  for (const sperre of sperren) {
    const pid = lockPid(join(repoRoot, sperre));
    if (pid !== null && prozessLaeuft(pid)) {
      return { nachziehen: false, grund: t("sperreGehalten", { sperre, pid }) };
    }
  }
  const reste = gitReste(repoRoot, configVonPlatte(repoRoot));
  if (reste.length > 0) {
    return { nachziehen: false, grund: t("hauptkopieReste", { reste: reste.join(", ") }) };
  }
  return { nachziehen: true, grund: null };
}

// --- Worktree je Kette (Plan #638, A3) ---
//
// Die Kette arbeitet in einem eigenen Worktree ausserhalb des Repos: Im Repo laege
// er als untracked Verzeichnis im `git status` des Umsetzungslaufs. `.claude/` ist bis
// auf `workflow.config.json` und `launch.json` nicht versioniert; ein frischer Worktree
// traegt damit die Config, aber weder Kit-Kopie noch Skills, Settings oder Token. Der
// Runner spiegelt deshalb `.claude/` der Hauptkopie hinein — ohne `night-run-*`, denn
// Log und Ergebnisstand bleiben in der Hauptkopie.

/**
 * Der Ordnername eines Worktrees; der Praefix dient dem Aufraeumen beim Start.
 *
 * `praefix` trennt die Laeufe, die nebeneinander stehen koennen: die Kette
 * (`kette`, der Vorgabewert) und der Prueflauf am Tag (`pruefung`). Ohne diese
 * Trennung entfernte ein Prueflauf beim Start den Worktree einer laufenden Kette.
 */
function worktreePraefix(repoRoot, praefix = "kette") {
  return `${praefix}-${basename(resolve(repoRoot))}-`;
}

export function gitIm(repoRoot, gitArgs) {
  return abh.git(repoRoot, gitArgs);
}

/**
 * Die volle Kennung des Commits `commit` im Repo `repoRoot` (Issue #2132). Der Build-Dienst kennt
 * Laeufe nur unter der vollen Kennung; eine verkuerzte fand keinen Lauf und meldete darum ohne
 * Ende `laeuft`. Eine unbekannte Kennung wirft mit der Kennung im Text.
 */
export function volleKennung(repoRoot, commit) {
  const res = gitIm(repoRoot, ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`]);
  if (res.status !== 0) throw new Error(t("kennungUnbekannt", { commit }));
  return res.stdout.trim();
}

/**
 * Spiegelt `.claude/` der Hauptkopie in den Worktree, ohne Protokolle und Ergebnisstaende.
 *
 * `force`, weil der Worktree `workflow.config.json` schon traegt — dieselbe Datei, sie
 * wird ueberschrieben, nicht gedoppelt.
 *
 * Die Aufwands-Auswertung (`aufwand.md`, `aufwand.json`, Issue #752) bleibt aus demselben
 * Grund zurueck wie `night-run-*`: Sie gehoert dem Lauf, der sie geschrieben hat, und
 * liegt in der Hauptkopie. Im Worktree waere sie ein fremder Stand, der mit ihm verginge.
 *
 * Dasselbe gilt fuer die vier Dateien der Wirksamkeits-Auswertung (Plan #782, E12):
 * `bewegungen.tsv`, `ausfuehrungen.tsv`, `wirksamkeit.md` und `wirksamkeit.json` bleiben
 * in der Hauptkopie.
 *
 * Auch die vier Dateien der Befunde (Plan #797; Issue #803) bleiben zurueck —
 * `befunde.tsv`, `befunde-vorschlaege.json`, `befunde.md` und `befunde.json`. Fuer
 * `befunde.tsv` kommt zum Grund der anderen ein zweiter dazu: Der Rueckweg
 * `befundeZurueck` HAENGT die im Worktree gebuchten Zeilen an die Hauptkopie AN.
 * Truege der Spiegel die Hauptkopie hinein, kaeme beim Abbau jede alte Zeile doppelt
 * zurueck; so enthaelt die Datei im Worktree ausschliesslich die Buchungen dieser Kette.
 *
 * ANNAHME (E12): Bewegungen und Ausfuehrungen, die IM Worktree entstuenden, gingen mit
 * ihm verloren — der Spiegel geht nur in eine Richtung, und nichts holt sie zurueck.
 * Heute trifft das nichts: Die Umsetzungsstufe baut den Worktree
 * zuerst ab und arbeitet in der Hauptkopie, und die erzeugenden Stufen bewegen nichts
 * nach In review und fahren keine Pruefungen — im Worktree entsteht also gar nichts,
 * was zu protokollieren waere. Bricht diese Annahme (arbeitet eine Stufe kuenftig am
 * Board oder faehrt Pruefungen im Worktree), bricht die Erhebung still: Die Auswertung
 * saehe die Bewegungen und Ausfuehrungen jener Stufe nie und meldete darum zu wenig,
 * ohne dass etwas rot wird. Dann muessen die beiden Protokolle aus dem Worktree
 * zurueckgeholt werden. Fuer die Befunde gilt das seit Issue #803 nicht mehr:
 * `befundeZurueck` holt `befunde.tsv` an beiden Abbaustellen der Kette zurueck — dort
 * fallen die meisten Buchungen an, denn /issue-review laeuft im Worktree —, seit Issue
 * #1028 auch beim Abbau des Prueflaufs.
 */
/**
 * Ob ein Eintrag direkt unter `.claude/` in der Hauptkopie zurueckbleibt: die Protokolle
 * und Auswertungen des Laufs, nicht die Werkzeuge. Entschieden wird am Namen des Eintrags
 * auf der obersten Ebene (Issue #824, night-68) — `.claude/kit/effort.mjs` und
 * `.claude/kit/effectiveness.mjs` kommen darum mit, `.claude/aufwand.json` nicht.
 * Die Markierung des Runners `kit-stand.json` und das Register `veroeffentlichungen.tsv` bleiben
 * ebenfalls zurueck (Issue #2132): Im Release-Worktree hielt die gespiegelte Markierung
 * `sync-blobs` an. Ebenso die Statusdatei der Pruefung je Karte `kartenpruefung.json` (Issue #2149):
 * Sperre und Nachlauf gehoeren dem Prozess der Hauptkopie.
 */
function bleibtInHauptkopie(name) {
  return name.startsWith("night-run-")
    || name.startsWith("aufwand.")
    || name.startsWith("wirksamkeit.")
    || name.startsWith("befunde.")
    || name === "befunde-vorschlaege.json"
    || name === "bewegungen.tsv"
    || name === "ausfuehrungen.tsv"
    || name === "kit-stand.json"
    || name === "kartenpruefung.json"
    || name === "veroeffentlichungen.tsv";
}

function claudeSpiegeln(repoRoot, pfad) {
  const quelle = join(repoRoot, ".claude");
  if (!existsSync(quelle)) return;
  const ziel = join(pfad, ".claude");
  mkdirSync(ziel, { recursive: true });
  // Die oberste Ebene geht der Runner selbst durch und kopiert jeden uebrigen Eintrag ohne
  // Filter (Issue #832). Bis dahin entschied ein `cpSync`-Filter ueber den Pfad von `src`
  // relativ zu `.claude/` — und das hing daran, dass `cpSync` ihn in derselben Schreibweise
  // uebergibt wie die Quelle. Tat es das nicht (etwa ein Kurzname des Temp-Verzeichnisses),
  // liess der Filter alles durch, und die Protokolle landeten im Worktree. Ohne
  // Pfadvergleich gibt es keine Schreibweise, die abweichen kann.
  for (const eintrag of readdirSync(quelle, { withFileTypes: true })) {
    if (bleibtInHauptkopie(eintrag.name)) continue;
    cpSync(join(quelle, eintrag.name), join(ziel, eintrag.name), { recursive: true, force: true });
  }
}

/**
 * Legt den Worktree einer Kette an und liefert seinen Pfad.
 *
 * Scheitert `git worktree add`, wirft die Funktion mit der git-Meldung; ob daraus ein
 * `abgebrochen` wird, entscheidet der Aufrufer — ein stiller Rueckfall auf die Hauptkopie
 * hiesse, dass die Kette manchmal neben der Umsetzung im selben Baum liefe.
 *
 * `ref` ist der Stand, auf dem der Worktree aufsetzt (Issue #929). Die Kette und der
 * Prueflauf nehmen den Vorgabewert `HEAD` — sie messen die Arbeit dieser Maschine. Die
 * Release-Skills setzen ihn ausdruecklich: `/merge-production` auf `origin/<mainBranch>`,
 * weil veroeffentlicht wird, was gepusht ist. Immer `--detach`: Ein Branch, der in der
 * Hauptkopie ausgecheckt ist, liesse sich in einem zweiten Worktree gar nicht auschecken.
 *
 * `spiegeln: false` laesst `.claude/` ungespiegelt: Der Worktree ist dann ein frischer
 * Checkout mit nur versionierten Dateien, wie ihn die Pruefung der Push-Stufe braucht
 * (Plan #1035).
 *
 * Der Pfad ist der realpath (Issue #1372): Ueber den macOS-Symlink des Temp-Verzeichnisses
 * scheitert `npm ci --prefix <pfad>`.
 */
export function worktreeAnlegen({ repoRoot, issueId = null, stempel, praefix = "kette", ref = "HEAD", spiegeln = true }) {
  // Ohne Kartennummer bleibt das Segment ganz weg (Plan #904, E11): Der Prueflauf legt
  // EINEN Worktree je Lauf an, und ein leeres Segment behauptete eine fehlende Nummer.
  const nummer = issueId === null ? "" : `${issueId}-`;
  const pfad = join(tempWurzel(), `${worktreePraefix(repoRoot, praefix)}${nummer}${stempel}`);
  // Der Halter steht vor dem Ordner: Ein zweiter Start dazwischen saehe sonst einen Ordner
  // ohne Halter und raeumte ihn als verwaist ab (Plan #1113, E1).
  writeFileSync(halterPfad(pfad), JSON.stringify({ host: hostname(), pid: process.pid, seit: abh.jetzt().toISOString() }) + "\n", "utf-8");
  const res = gitIm(repoRoot, ["worktree", "add", "--detach", pfad, ref]);
  if (res.status !== 0) {
    rmSync(halterPfad(pfad), { force: true });
    throw new Error(t("worktreeAddFehlgeschlagen", { meldung: (res.stderr || res.stdout || "").trim() }));
  }
  if (spiegeln) claudeSpiegeln(repoRoot, pfad);
  return pfad;
}

/**
 * Das Temp-Verzeichnis als realpath (Issue #1372). Auf macOS fuehrt `tmpdir()` ueber den
 * Symlink `/var` bzw. `/tmp`, und `npm ci --prefix <pfad>` scheitert an einem solchen Pfad
 * mit „Missing: … from lock file“. Ueber den realpath laeuft es durch.
 */
function tempWurzel() {
  return realpathSync(tmpdir());
}

/** `pfad` aufgeloest, wenn es ihn gibt, sonst nur normalisiert. */
function echterPfad(pfad) {
  try {
    return realpathSync(pfad);
  } catch {
    return resolve(pfad);
  }
}

/**
 * Liegt das Arbeitsverzeichnis des Prozesses innerhalb von `pfad` (Issue #955)?
 *
 * Ueber aufgeloeste, normalisierte Pfade — nicht ueber einen Zeichenkettenvergleich, der
 * `…/release-abc` fuer einen Teil von `…/release-a` hielte. Laesst sich eine der beiden
 * Seiten nicht aufloesen, lautet die Antwort nein: Dann ist kein Wechsel begruendet.
 */
function cwdLiegtIn(pfad) {
  let ziel, cwd;
  try {
    ziel = realpathSync(pfad);
    cwd = realpathSync(process.cwd());
  } catch {
    return false;
  }
  const rel = relative(ziel, cwd);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Entfernt den Worktree — ueber git, und den Ordner, falls er danach noch liegt.
 *
 * Steht das Arbeitsverzeichnis des Prozesses IM Worktree, wechselt die Funktion zuerst
 * hinaus nach `repoRoot` (Issue #955): Genau so rufen die Release-Skills den Abbau, und
 * ein Prozess soll nicht in einem Verzeichnis stehen, das unter ihm geloescht wird; ein
 * Dateisystem, das das Loeschen dann sperrt (EBUSY), liesse den Abbau scheitern.
 * `repoRoot` ist immer vorhanden und der Ort, an dem der Worktree-Eintrag gefuehrt wird.
 * Der Wechsel geschieht NUR in diesem Fall: Wer von aussen aufraeumt, soll sein cwd nicht wechseln sehen.
 */
export function worktreeEntfernen(pfad, repoRoot) {
  if (cwdLiegtIn(pfad)) process.chdir(repoRoot);
  gitIm(repoRoot, ["worktree", "remove", "--force", pfad]);
  rmSync(pfad, { recursive: true, force: true });
  rmSync(halterPfad(pfad), { force: true });
}

/**
 * Die Halter-Datei eines Worktrees oder Kit-Stands (Issue #1183, Plan #1113, E1): neben dem
 * Ordner im Temp-Verzeichnis, nicht darin — so bleibt der Git-Baum und mit ihm `gitClean`
 * unberuehrt, und der Ordnername samt Lauf-Stempel aendert sich nicht.
 */
const HALTER_ENDUNG = ".halter";

function halterPfad(pfad) {
  return `${pfad}${HALTER_ENDUNG}`;
}

/**
 * Gehoert der Ordner noch einem laufenden Runner? Nur dann, wenn sein Halter lesbar ist,
 * auf diesem Rechner geschrieben wurde und sein Prozess noch laeuft. Ein Ordner ohne Halter
 * stammt aus der Zeit vor den Haltern und gilt als verwaist (E2).
 */
function halterLebt(pfad) {
  let halter;
  try {
    halter = JSON.parse(readFileSync(halterPfad(pfad), "utf-8"));
  } catch {
    return false;
  }
  return halter?.host === hostname() && Number.isInteger(halter?.pid) && halter.pid > 0 && prozessLaeuft(halter.pid);
}

/**
 * Die Schwelle aus dem Config-Block `befunde` der Hauptkopie (Issue #800).
 * SYNC: `schwelleLesen` in kit/findings.mjs — dieselbe Regel samt Vorgabe 3, dupliziert
 * nach dem Muster #440 und mit `repoRoot` statt `process.cwd()`, denn der Runner steht
 * beim Abbau nicht zwingend in der Hauptkopie.
 */
function befundeSchwelle(repoRoot) {
  try {
    const { config: cfg } = normalisiereConfig(JSON.parse(readFileSync(join(repoRoot, ".claude", "workflow.config.json"), "utf-8")));
    const wert = cfg?.befunde?.schwelle;
    if (Number.isInteger(wert) && wert > 0) return wert;
  } catch { /* keine Config ist ein normaler Zustand — Vorgabe. */ }
  return 3;
}

/**
 * Der Nullpunkt je Art aus `befunde-vorschlaege.json` der Hauptkopie (Plan #797, E11).
 * SYNC: `nullpunktFuer` in kit/findings.mjs — dupliziert wie die Schwelle darueber.
 */
function befundeNullpunkt(repoRoot, art) {
  try {
    const daten = JSON.parse(readFileSync(join(repoRoot, ".claude", "befunde-vorschlaege.json"), "utf-8"));
    const wert = daten?.[art]?.nullpunkt;
    if (Number.isInteger(wert) && wert >= 0) return wert;
  } catch { /* keine Vorschlagsdatei ist der Regelfall — Nullpunkt null. */ }
  return 0;
}

/** Der Zaehlerstand je Art (Spalte 5) aus Protokollzeilen; fehlerhafte Zeilen zaehlen nicht.
 *  SYNC: `zaehleArten` in kit/findings.mjs. */
function befundeArtenZaehlen(zeilen) {
  const zaehler = new Map();
  for (const zeile of zeilen) {
    const spalten = zeile.split("\t");
    if (spalten.length < 7) continue;
    zaehler.set(spalten[4], (zaehler.get(spalten[4]) ?? 0) + 1);
  }
  return zaehler;
}

/** Die Zeilen einer `befunde.tsv`; eine fehlende oder unlesbare Datei zaehlt als keine. */
function befundeZeilen(pfad) {
  try {
    return readFileSync(pfad, "utf-8").split(/\r?\n/).filter((z) => z !== "");
  } catch {
    return [];
  }
}

/**
 * Holt die im Worktree gebuchten Befunde in die Hauptkopie zurueck (Issue #803, night-69).
 *
 * ANHAENGEND, nie kopierend (Plan #797, E8): Der Spiegel traegt `befunde.tsv` gar nicht
 * erst in den Worktree, die Datei dort enthaelt also ausschliesslich die Buchungen dieser
 * Kette — und Kopieren ueberschriebe die Hauptkopie und loeschte jede fruehere Zeile.
 *
 * Die Schwelle prueft der Rueckweg selbst, am GESAMTSTAND der Hauptkopie nach dem
 * Anhaengen (E20, Fund B1 der Plan-Pruefung): Der Worktree zaehlt ab null — stehen zwei
 * Vorkommen in der Hauptkopie und kommt das dritte in der Kette, sah `buchen` dort den
 * Stand 1 und schwieg. Zurueck kommen nur die BERUEHRTEN Arten, die die Schwelle
 * (oberhalb ihres Nullpunkts, wie bei `buchen`) erreichen; der Aufrufer macht daraus je
 * Art einen Vorschlag (Issue #804).
 *
 * Fehlt die Datei im Worktree, bleibt die Hauptkopie unberuehrt. Ein gescheitertes
 * Anhaengen ist ein Hinweis im Protokoll und haelt den Abbau nicht auf — das Protokoll
 * ist Buchhaltung, keine Bedingung (Muster checks-7). `melden` nimmt den Hinweis; der Runner
 * reicht sein Protokoll herein, ohne ihn geht er auf stdout.
 */
export function befundeZurueck(pfad, repoRoot, melden = zeileAusgeben) {
  const zeilen = befundeZeilen(join(pfad, ".claude", "befunde.tsv"));
  if (zeilen.length === 0) return [];

  const ziel = join(repoRoot, ".claude", "befunde.tsv");
  try {
    mkdirSync(dirname(ziel), { recursive: true });
    appendFileSync(ziel, zeilen.map((z) => `${z}\n`).join(""), "utf-8");
  } catch (e) {
    melden(t("befundeNichtZurueck", { ziel, fehler: e.message }));
    return [];
  }

  const beruehrt = befundeArtenZaehlen(zeilen);
  const stand = befundeArtenZaehlen(befundeZeilen(ziel));
  const schwelle = befundeSchwelle(repoRoot);
  return [...beruehrt.keys()].sort(vergleicheText)
    .filter((art) => (stand.get(art) ?? 0) - befundeNullpunkt(repoRoot, art) >= schwelle);
}

/**
 * Raeumt liegengebliebene Worktrees dieses Repos auf — beim Start jeder Kette.
 *
 * Ein harter Absturz laesst den Ordner unter dem Temp-Verzeichnis und den Eintrag in
 * `git worktree list` zurueck; beide muessen weg, sonst legt der naechste Lauf einen
 * zweiten Worktree neben einen toten. Liefert die entfernten Pfade.
 *
 * Geraeumt wird nur der eigene Praefix (`kette` als Vorgabe, `pruefung` fuer den
 * Prueflauf am Tag): Ein Lauf, der jeden Praefix abraeumte, zerstoerte den Worktree
 * des jeweils anderen, der gerade daneben laeuft.
 *
 * Innerhalb des Praefixes bleibt jeder Ordner stehen, dessen Halter einem laufenden Prozess
 * auf diesem Rechner gehoert (Issue #1183): Ein zweiter Runner derselben Laufart in einer
 * anderen Session raeumt nur die Reste abgestuerzter Laeufe ab. Die Liste nennt nur sie.
 *
 * `behalten` nimmt einen Ordner ausdruecklich aus — den eigenen Kit-Stand (Issue #1200).
 */
export function worktreesAufraeumen(repoRoot, praefixName = "kette", behalten = null) {
  gitIm(repoRoot, ["worktree", "prune"]);
  const praefix = worktreePraefix(repoRoot, praefixName);
  const entfernt = [];
  const wurzel = tempWurzel();
  const namen = readdirSync(wurzel).filter((n) => n.startsWith(praefix));
  for (const name of namen) {
    const pfad = join(wurzel, name);
    if (name.endsWith(HALTER_ENDUNG)) {
      // Ein Halter ohne Ordner ist der Rest eines Absturzes zwischen den beiden Loeschungen.
      const ordner = pfad.slice(0, -HALTER_ENDUNG.length);
      if (!existsSync(ordner) && !halterLebt(ordner)) rmSync(pfad, { force: true });
      continue;
    }
    // Der Ordner eines lebenden Runners ist kein Rest (Issue #1183): Ihn zu raeumen zerstoerte
    // die Arbeit einer Kette, die in einer anderen Session laeuft.
    if (halterLebt(pfad)) continue;
    // Ueber den realpath (Issue #1372): Gelistet wird unter dem realpath des Temp-Verzeichnisses,
    // und ein frueher notierter Pfad kann noch ueber den Symlink laufen.
    if (behalten && pfad === echterPfad(behalten)) continue;
    worktreeEntfernen(pfad, repoRoot);
    entfernt.push(pfad);
  }
  return entfernt;
}

// --- Die Reste des Arbeitsbaums ---

/**
 * Die Pfade, die kein Rest sind — eine Liste mit zwei Lesern (Issue #818).
 *
 * `gitReste()` misst damit, was als unkommittete Arbeit zaehlt, und
 * `salvageSauberkeitsKommando()` baut daraus das Kommando, das der Salvage-Prompt
 * der Session nennt. Bis #818 stand im Prompt ein nacktes `git status --porcelain`,
 * und damit urteilten Session und Runner in einem Projekt ohne den `.claude/*`-Block
 * in `.gitignore` verschieden: Die Session sah `night-run-*`, den Umsetzungs-Lock und
 * die Protokolle, liess das Board darum unberuehrt, und der Runner meldete danach
 * "SALVAGE UNVOLLSTAENDIG" mit hartem Stopp. Die Rettung scheiterte an einem
 * Widerspruch zwischen zwei Regeln desselben Werkzeugs. Eine Liste kann nicht
 * auseinanderlaufen, zwei Aufzaehlungen koennen es.
 *
 * `cfg` ist die Config des Projekts. Einen Vorgabewert gibt es nicht (Issue #1858, Plan #1853,
 * E3): Die geladene Config fuehrt der Runner, und seine Aufrufer uebergeben sie ausdruecklich.
 */
export function gitResteAusnahmen(cfg) {
  return [
    // Beim lokalen Tracker sind Board-Moves Dateiaenderungen unter issuesDir —
    // Board-Zustand ist kein Code-Zustand und zaehlt nicht als dirty.
    ...(cfg?.issueTracker === "local" ? [cfg.local?.issuesDir || "issues"] : []),
    // Das Protokoll des Laufs (Textdatei und Ergebnisstand, Issue #486) entsteht waehrend
    // des Laufs im Arbeitsbaum: Protokoll-Zustand ist kein Code-Zustand. Anders als die
    // issuesDir-Ausnahme gilt diese unabhaengig vom Tracker — der Runner legt seine
    // Dateien in jedem Projekt an, und ohne die Ausnahme stoppte der Rest-Guard (#152)
    // nach jeder erfolgreichen Runde hart, sobald .gitignore .claude/* nicht fuehrt.
    ".claude/night-run-*",
    // Altlast aus SDD, Rueckbau mit dem uebernaechsten Major (Plan #825, A5): Bis zum
    // Rueckbau von Spec-Driven Development legte `/techplan` wartende Vorhaben-Notizen unter
    // `.claude/vorhaben-wartend-*` ab. Heute entsteht keine mehr, aber in Zielprojekten kann
    // noch eine liegen. Ohne den `.claude/*`-Block in `.gitignore` (der Installer laesst eine
    // eigene `.claude`-Regel unangetastet) hielte sie den Lauf sonst hart an.
    ".claude/vorhaben-wartend-*",
    // Ein wartender Bericht des Laufs (Issue #645) liegt in der Hauptkopie, bis der Tracker ihn
    // annimmt — Protokoll-Zustand wie `night-run-*`, und aus demselben Grund hier ausgeschlossen.
    ".claude/night-bericht-*",
    // Die vorbereitete Veroeffentlichung (Plan #1243, A6; Issue #1254) liegt in der
    // Hauptkopie, bis `/push-main` sie uebernimmt oder verwirft — Protokoll-Zustand
    // wie der wartende Bericht des Laufs darueber, und aus demselben Grund hier ausgeschlossen.
    VORBEREITUNG_DATEI,
    // Die offen gebliebene Freigabe des Pruefzweigs (Plan #1965, E8; Issue #1973) liegt in der
    // Hauptkopie, bis der naechste Lauf oder `/push-main` sie nachholt — Laufzeit-Zustand wie
    // die Vorbereitung darueber, und aus demselben Grund hier ausgeschlossen.
    PRUEFZWEIG_OFFEN_DATEI,
    // Der Umsetzungs-Lock (Issue #696) liegt waehrend jeder Umsetzung in der Hauptkopie:
    // Laufzeit-Zustand, kein Code-Zustand. Der Ausschluss steht hier aus demselben Grund wie
    // das Protokoll darueber — nachgewiesen, nicht angenommen: Ohne ihn stoppte der
    // Rest-Guard (#152) in jedem Projekt ohne den `.claude/*`-Block nach der ersten
    // erfolgreichen Runde hart, und die Umsetzungsstufe saehe die Hauptkopie schon vor ihrem
    // ersten Paket als unsauber.
    UMSETZUNG_LOCK,
    // Die Markierung des festen Kit-Stands (Issue #1102, A4) liegt waehrend des Laufs in der
    // Hauptkopie: Laufzeit-Zustand wie der Lock darueber, kein Code-Zustand.
    KIT_STAND_MARKIERUNG,
    // Die feste Rechnerkennung (Issue #2168) legt der Runner beim ersten Start in der Hauptkopie
    // an: Zustand dieses Rechners, kein Code-Zustand. Ohne den Ausschluss hielte sie in jedem
    // Projekt ohne den `.claude/*`-Block den ersten Lauf an.
    // SYNC: derselbe Pfad steckt als RECHNER_DATEI in kit/night/laufstand.mjs, das ihn schreibt.
    ".claude/rechner.json",
    // Die Wegmarken (Issue #733) entstehen bei JEDEM Zug nach In progress oder In review —
    // der Runner schreibt zwei je Runde, die Session weitere. Buchhaltung, kein
    // Code-Zustand, und aus demselben Grund hier ausgeschlossen wie das Protokoll darueber:
    // Ohne den Ausschluss stoppte der Rest-Guard (#152) in jedem Projekt ohne den
    // `.claude/*`-Block nach der ersten erfolgreichen Runde hart. Damit waere die Wegmarke
    // eine Bedingung der Arbeit statt ihrer Buchhaltung.
    // SYNC: derselbe Pfad steckt als WEGMARKEN_DATEI in kit/board.mjs, das ihn schreibt;
    // die Kit-Werkzeuge sind bewusst eigenstaendige Single-File-Tools ohne gemeinsames
    // Modul (#440), geteilte Konstanten werden dupliziert und hier markiert.
    ".claude/wegmarken.tsv",
    // Die Aufwands-Auswertung (Issue #752) entsteht am Ende JEDES Laufs im Arbeitsbaum —
    // `.claude/aufwand.md` fuer Menschen, `.claude/aufwand.json` fuer die zwei
    // Ausgabestellen. Protokoll-Zustand, kein Code-Zustand, und aus demselben Grund
    // ausgeschlossen wie `night-run-*` darueber: Ohne den Ausschluss stoppte der Rest-Guard
    // (#152) im naechsten Lauf nach der ersten erfolgreichen Runde hart, sobald `.gitignore`
    // den `.claude/*`-Block nicht fuehrt. Die Messung machte dann die Arbeit unmoeglich,
    // die sie misst.
    ".claude/aufwand.*",
    // Die Wirksamkeits-Auswertung (Plan #782, E12) legt vier weitere Dateien im Arbeitsbaum
    // an: die Protokolle `bewegungen.tsv` und `ausfuehrungen.tsv`, die in JEDEM Lauf
    // mitschreiben, und die beiden Berichte `wirksamkeit.md` (fuer Menschen) und
    // `wirksamkeit.json` (fuer die Weiterverarbeitung). Erhebung und Auswertung, kein
    // Code-Zustand — und aus demselben Grund ausgeschlossen wie `aufwand.*` darueber:
    // Ohne den Ausschluss stoppte der Rest-Guard (#152) in jedem Projekt, dessen
    // `.gitignore` den `.claude/*`-Block nicht fuehrt, nach der ersten erfolgreichen Runde
    // hart. Die Messung machte dann die Arbeit unmoeglich, die sie misst. Dieses Repo
    // fuehrt den Block und ist darum nicht selbst betroffen; ein frisch installiertes
    // Projekt ohne ihn waere es.
    // SYNC: die schreibenden Stellen liegen anderswo — `bewegungen.tsv` in kit/board.mjs,
    // `ausfuehrungen.tsv` in kit/checks.mjs, `wirksamkeit.md` und `wirksamkeit.json` in
    // kit/effectiveness.mjs; die Kit-Werkzeuge sind bewusst eigenstaendige Single-File-Tools
    // ohne gemeinsames Modul (#440), geteilte Konstanten werden dupliziert und hier markiert.
    ".claude/bewegungen.tsv", // SYNC: kit/board.mjs schreibt sie
    ".claude/ausfuehrungen.tsv", // SYNC: kit/checks.mjs schreibt sie
    // Der Pruef-Nachweis, aus demselben Grund und mit demselben Schadensbild (Issue #919):
    // Seit die Salvage-Vorpruefung ueber `checks.mjs run` geht, legt der RUNNER die Datei
    // selbst an. In einem Projekt ohne den `.claude/*`-Block zaehlte sie danach als
    // liegengebliebene Arbeit, und die geglueckte Rettung endete als "SALVAGE
    // WIDERSPRUECHLICH" — der Nachweis der Pruefung machte die Rettung unmoeglich, die er
    // belegt. Nachweis einer Pruefung, kein Code-Zustand.
    ".claude/checks-summary.json", // SYNC: kit/checks.mjs schreibt ihn (SUMMARY_DATEI)
    // Das Ergebnis des Integrationslaufs (Issue #1982), aus demselben Grund: Nachweis einer
    // Pruefung, kein Code-Zustand.
    ".claude/integration.json", // SYNC: kit/checks.mjs schreibt sie (INTEGRATION_DATEI)
    // Die abgelegten Ausgaben roter Pruefungen (Issue #1196), aus demselben Grund: Ohne den
    // Ausschluss stoppte der Rest-Guard nach jedem roten Lauf in einem Projekt ohne den
    // `.claude/*`-Block hart.
    ".claude/checks-protokolle", // SYNC: kit/checks.mjs schreibt ihn (PROTOKOLL_ORDNER)
    ".claude/wirksamkeit.md", // SYNC: kit/effectiveness.mjs schreibt ihn
    ".claude/wirksamkeit.json", // SYNC: kit/effectiveness.mjs schreibt ihn
    // Die Befunde der Modell-Pruefungen (Plan #797; Issue #803) legen vier weitere Dateien
    // an: das Protokoll `befunde.tsv` (`befunde buchen` schreibt es, `befundeZurueck` holt
    // es aus dem Worktree zurueck), die Nullpunkte `befunde-vorschlaege.json` und die
    // Berichte `befunde.md` und `befunde.json`. Buchhaltung, kein Code-Zustand — und aus
    // demselben Grund ausgeschlossen wie die vier Dateien der Wirksamkeits-Auswertung
    // darueber: Ohne den Ausschluss stoppte der Rest-Guard (#152) in jedem Projekt ohne
    // den `.claude/*`-Block nach der ersten Buchung hart.
    ".claude/befunde.tsv", // SYNC: kit/findings.mjs schreibt sie
    ".claude/befunde-vorschlaege.json", // SYNC: kit/findings.mjs liest sie
    ".claude/befunde.md",
    ".claude/befunde.json",
    // Die Stuecke eines gestueckelten Abschlussberichts (Issue #1022): `issue report
    // --teil` legt sie ab, der Abschlussaufruf raeumt sie erst nach Ablage und Zug.
    // Scheitert er, liegen sie bis zur Wiederholung dort — Zwischenstand einer Meldung,
    // kein Code-Zustand, und ohne den Ausschluss stoppte der Rest-Guard (#152) in jedem
    // Projekt ohne den `.claude/*`-Block hart, obwohl die Wiederholung alles aufraeumt.
    ".claude/berichte/", // SYNC: kit/board.mjs schreibt sie (BERICHTE_ORDNER)
    // Journal und Puls jedes Laufs (Issue #1084): Laufzeit-Zustand, kein Code-Zustand —
    // und ohne den Ausschluss stoppte der Rest-Guard (#152) in jedem Projekt ohne den
    // `.claude/*`-Block schon nach der ersten Runde hart, weil der Runner beide selbst anlegt.
    ".claude/lauf/",
    // Die Protokolle je Schritt (Issue #1090, E16) aus demselben Grund: Der Runner legt sie
    // waehrend jeder Runde selbst an.
    ".claude/protokolle/",
  ];
}

/**
 * Die Ausnahmen als git-Pathspec (Issue #818). Eine Herleitung, zwei Verwendungen:
 * `gitReste()` uebergibt sie als Argumente, das Salvage-Kommando setzt sie als Text
 * zusammen. Zwei Herleitungen desselben Pathspec liefen bei der ersten Aenderung
 * auseinander — und genau das war der Fehler, den #818 behebt.
 */
export function gitRestePathspec(ausnahmen = gitResteAusnahmen()) {
  return ["--", ".", ...ausnahmen.map((pfad) => `:(exclude)${pfad}`)];
}

/**
 * Die unkommittierten Pfade in `cwd`, mit den Ausnahmen aus `gitResteAusnahmen(cfg)`.
 * Scheitert `git status`, wirft die Funktion einen `Error` (Issue #1858, Plan #1853, E3): Der
 * Runner faengt ihn und bricht ueber `fail` ab, `worktree.mjs` meldet ihn als `ok: false`.
 * `spawn` ersetzt den git-Aufruf im Test (Plan #1199, E6).
 */
export function gitReste(cwd = process.cwd(), cfg = null, { spawn = spawnSync } = {}) {
  const res = spawn("git", ["status", "--porcelain", ...gitRestePathspec(gitResteAusnahmen(cfg))], { encoding: "utf-8", cwd });
  if (res.status !== 0) throw new Error(t("gitStatusFehler"));
  return res.stdout.split(/\r?\n/).filter((zeile) => zeile.trim() !== "");
}
