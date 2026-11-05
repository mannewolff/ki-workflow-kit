// SPDX-License-Identifier: MIT
/**
 * board/pro.mjs — der Lader der Pro-Teile (Issue #1855, Plan #1853 E1, E2): die Liste aus board/ausgabe.mjs
 * `PRO_TEILE`, die Ladepruefung `proVorhanden`, das Laden `proLaden` und der Befehl `pro`
 * mit `pro run <auswertung> -- <argumente>` und `pro list`. Die Auswertungen, die `pro run`
 * startet, sind seit Issue #2012 Community und stehen in der eigenen Liste `AUSWERTUNGEN`
 * (Plan #2008 E3); `pro run` bleibt ihr Aufruf, weil Skills und Runner ihn so nennen.
 *
 * Das Kit laeuft interaktiv ohne die Pro-Teile (#1814). Diese Datei ist die eine Stelle, die
 * weiss, was ein Pro-Teil ist und ob er in der installierten Kopie liegt. Sie selbst gehoert
 * zu Community und laedt nie ein Pro-Teil statisch.
 *
 * `proVorhanden` ist eine Ladepruefung, keine Erkennung der Ausgabe: Ob ein Projekt Community
 * oder Pro ist, haelt eine ausdrueckliche Angabe von Installation und Update fest (#1816). Die
 * Grenzlogik dazu steht in board/ausgabe.mjs (Issue #1867), das nur `node:*` importiert, damit
 * der Installer es ohne Nachbarn laden kann; diese Datei reicht sie weiter, bildet ihre
 * Meldungen in der Projektsprache und traegt den Befehl `edition`.
 *
 * Ein Teil von kit/board.mjs. Er importiert nie aus dem Einstieg: Der Einstieg laedt die
 * Teile, ein Rueckimport waere ein Zyklus. Darum bekommt `dispatchPro` die Hilfe als Argument.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { configWurzel, fail, out, readWorkflowConfig } from "./grundlagen.mjs";
import { prozessSprache, text } from "./namen.mjs";
import { mitEnglischenNamen } from "./config-namen.mjs";
import { ausgabe, proMeldung, PRO_FUNKTIONEN, PRO_TEILE, uebergangeneEinstellungen, uebergangenZeile } from "./ausgabe.mjs";

// Die Texte an den Menschen liegen unter kit/texte/board-pro.mjs.
import { TEXTE } from "../texte/board-pro.mjs";

export { TEXTE };
// Die Listen der Pro-Teile liegen in board/ausgabe.mjs, damit der Installer sie laden kann (Plan #1918, E10).
export { ausgabe, proMeldung, PRO_FUNKTIONEN, PRO_TEILE, uebergangeneEinstellungen, uebergangenZeile };
export { PRO_EINSTELLUNGEN, PRO_BEIGABEN } from "./ausgabe.mjs";

/** Ein Text dieses Teils in der Projektsprache. */
const t = (schluessel, werte) => text(TEXTE, schluessel, werte);

/** Das Kit-Verzeichnis, in dem board.mjs liegt: in einem Projekt `.claude/kit/`, im Repo `kit/`. */
const KIT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Die Auswertungen, die `pro run` startet (Issue #2012, Plan #2008 E3), mit ihren Dateien wie in
 * `PRO_TEILE`; die erste ist die Hauptdatei. Sie gehoeren zu Community. Fehlt die Hauptdatei,
 * steht die Zeile „<Auswertung>: nicht installiert" da.
 */
export const AUSWERTUNGEN = Object.freeze({
  effort: Object.freeze({ dateien: Object.freeze(["kit/effort.mjs", "kit/texte/effort.mjs"]) }),
  effectiveness: Object.freeze({ dateien: Object.freeze(["kit/effectiveness.mjs"]) }),
  findings: Object.freeze({ dateien: Object.freeze(["kit/findings.mjs", "kit/texte/findings.mjs"]) }),
});

function teilVon(teil) {
  if (!Object.hasOwn(PRO_TEILE, teil)) {
    throw new Error(t("teilNichtInListe", { teil, bekannt: Object.keys(PRO_TEILE).join(", ") }));
  }
  return PRO_TEILE[teil];
}

/** Ein Kit-Pfad in der installierten Kopie: `kit/x.mjs` liegt dort als `<kitDir>/x.mjs`. */
const imKit = (pfad, kitDir) => join(kitDir, ...pfad.replace(/^kit\//, "").split("/"));

/** Die Hauptdatei eines Teils in der installierten Kopie. */
function hauptdatei(teil, kitDir) {
  return imKit(teilVon(teil).dateien[0], kitDir);
}

/**
 * Liegt die Hauptdatei des Teils neben board.mjs? `null` fuer einen Teil mit
 * `installiert: false` — fuer ihn ist die Frage nicht anwendbar. Ein unbekannter Teil wirft.
 */
export function proVorhanden(teil, kitDir = KIT_DIR) {
  if (teilVon(teil).installiert === false) return null;
  return existsSync(hauptdatei(teil, kitDir));
}

/**
 * Darf der Teil wirken? In Community nie, gleich ob seine Datei liegt (Plan #2008 A2): Ein
 * 5.x-Projekt bringt `doctor.mjs` und `update.mjs` mit, und sie bleiben liegen. Sonst die
 * Ladepruefung `proVorhanden`. Die Ausgabe liest sie an der Installation unter `wurzel`.
 */
export function proVerfuegbar(teil, kitDir = KIT_DIR, wurzel = configWurzel()) {
  teilVon(teil);
  if (ausgabe({ wurzel }) === "community") return false;
  return proVorhanden(teil, kitDir) === true;
}

/**
 * Laedt die Hauptdatei eines Teils, `null`, wenn sie fehlt oder die Installation Community ist
 * (Plan #2008 A2). Ein Fehler beim Laden einer vorhandenen Datei geht weiter: Fehlen ist
 * erlaubt, kaputt sein nicht.
 */
export async function proLaden(teil, kitDir = KIT_DIR, wurzel = configWurzel()) {
  if (!proVerfuegbar(teil, kitDir, wurzel)) return null;
  return import(pathToFileURL(hauptdatei(teil, kitDir)).href);
}

/** Die Zeile „<Auswertung>: nicht installiert" (#1814, Kriterium 6), eine je Schritt und Auswertung. */
export function nichtInstalliertZeile(teil) {
  return t("nichtInstalliert", { auswertung: t("auswertung_" + teil) });
}

/** `pro run <auswertung> -- <argumente>`: startet die CLI der Auswertung und reicht ihren Exit-Code weiter. */
function proRun([teil, ...rest], kitDir) {
  const zulaessig = Object.keys(AUSWERTUNGEN).join(", ");
  if (teil === undefined) fail(t("teilFehlt", { zulaessig }));
  if (!Object.hasOwn(AUSWERTUNGEN, teil)) fail(t("teilUnbekannt", { teil, zulaessig }));
  const datei = imKit(AUSWERTUNGEN[teil].dateien[0], kitDir);
  if (!existsSync(datei)) {
    process.stdout.write(`${nichtInstalliertZeile(teil)}\n`);
    process.exitCode = 0;
    return;
  }
  const argumente = rest[0] === "--" ? rest.slice(1) : rest;
  const kind = spawnSync(process.execPath, [datei, ...argumente], { stdio: "inherit" });
  if (kind.error) throw kind.error;
  process.exitCode = kind.status ?? 1;
}

/** `pro list`: welche Teile vorhanden sind; die nicht installierbaren stehen gesondert. */
export function proListe(kitDir = KIT_DIR) {
  const teile = {};
  const nichtInstallierbar = {};
  for (const teil of Object.keys(PRO_TEILE)) {
    if (PRO_TEILE[teil].installiert === false) nichtInstallierbar[teil] = { installiert: false };
    else teile[teil] = { vorhanden: proVorhanden(teil, kitDir) };
  }
  return { teile, nichtInstallierbar };
}

/** Der Befehl `pro` (E2). Die Argumente kommen roh, damit `pro run` sie unveraendert weitergibt. */
export async function dispatchPro(command, rest, hilfe, kitDir = KIT_DIR) {
  if (command === "run") return proRun(rest, kitDir);
  if (command === "list") return out(proListe(kitDir));
  process.stdout.write(hilfe);
  fail(t("proUnbekannt", { befehl: command }));
}

// ============================================================
// Die Grenze zu Pro: Meldungen und der Befehl `edition` (Issue #1867, Plan #1866 E4, E9, E14)
// ============================================================

/** Die Pro-Meldung zu einer Funktion in der Projektsprache, Adresse passend zur Sprache. */
export function proMeldungText(funktion) {
  const meldung = proMeldung(funktion, { sprache: prozessSprache() });
  return t(meldung.schluessel, { funktion: t(meldung.funktion), url: meldung.url });
}

/** Die Zeile der uebergangenen Einstellungen in der Projektsprache, `null` ohne Namen. */
export function uebergangenText(namen) {
  const zeile = uebergangenZeile(namen);
  return zeile === null ? null : t(zeile.schluessel, { namen: zeile.namen });
}

/**
 * `edition show`: die Ausgabe der Installation, die Version des Kits (Plan #2008 A9) und, nur in
 * Community, die uebergangenen Pro-Einstellungen. In Pro wird nichts uebergangen (Kriterium 7).
 */
export function editionShow({ wurzel = configWurzel(), config = readWorkflowConfig(), env = process.env, version = null } = {}) {
  const art = ausgabe({ wurzel });
  const uebergangen = art === "community" ? uebergangeneEinstellungen(mitEnglischenNamen(config ?? {}), { env }) : [];
  return { ausgabe: art, version, uebergangen, zeile: uebergangenText(uebergangen) };
}

/** `edition gate <funktion>`: in Community die Pro-Meldung und Exit 3, in Pro still mit Exit 0. */
function editionGate(funktion, wurzel) {
  const zulaessig = PRO_FUNKTIONEN.join(", ");
  if (funktion === undefined) fail(t("funktionFehlt", { zulaessig }));
  if (!PRO_FUNKTIONEN.includes(funktion)) fail(t("funktionUnbekannt", { funktion, zulaessig }));
  if (ausgabe({ wurzel }) !== "community") return;
  process.stdout.write(`${proMeldungText(funktion)}\n`);
  process.exitCode = 3;
}

/** Der Befehl `edition` (E4); `version` ist die des Einstiegs board.mjs. */
export function dispatchEdition(command, rest, hilfe, { wurzel = configWurzel(), version = null } = {}) {
  if (command === "show") return out(editionShow({ wurzel, version }));
  if (command === "gate") return editionGate(rest[0], wurzel);
  process.stdout.write(hilfe);
  fail(t("editionUnbekannt", { befehl: command }));
}
