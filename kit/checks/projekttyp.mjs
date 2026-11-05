// SPDX-License-Identifier: MIT
/**
 * checks/projekttyp.mjs — erkennt den Projekttyp und liefert seine Vorgaben (Issue #2115,
 * Plan #2102, fachliche Quelle #2100 Kriterium 11; aufgenommen aus Idee #1308).
 *
 * Der Projekttyp bestimmt, wie schnell die Pruefungen laufen, nie welche: Die Vorgaben
 * schalten Zwischenspeicher und Parallelitaet des Build-Werkzeugs ein und stellen
 * Integrationslaeufe mit `notAtCompletion` auf den Integrationslauf zurueck. Die Menge der
 * `buildChecks` bleibt dieselbe.
 *
 * Was ein Projekt schon selbst eingestellt hat, wird nicht erneut vorgeschlagen, auch wenn es
 * vom Vorschlag abweicht: Ein `org.gradle.caching=false` oder ein `notAtCompletion: false`
 * ist eine Entscheidung des Projekts. Darum ist der Vorschlag leer, sobald alles steht, und
 * die Einrichtung fragt beim naechsten Update nicht noch einmal.
 *
 * Die Datei laedt nur Node-Bausteine: Der Installer importiert sie aus seinem Blob.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

// Die Reihenfolge entscheidet: Ein pnpm-Projekt traegt auch eine package.json.
const ERKENNUNG = [
  ["maven", ["pom.xml"]],
  ["gradle", ["build.gradle", "build.gradle.kts"]],
  ["pnpm", ["pnpm-lock.yaml"]],
  ["npm", ["package.json"]],
];

/** Setzt die Properties-Datei `inhalt` den Schluessel schon, gleich mit welchem Wert? */
const propertySteht = (schluessel) => (inhalt) => inhalt.split("\n").some((zeile) => {
  const rest = zeile.trim();
  return rest.startsWith(schluessel) && ["=", ":"].includes(rest.slice(schluessel.length).trim()[0]);
});

/** Nennt die maven.config schon eine Thread-Zahl (`-T 4`, `-T4`, `--threads=2C`)? */
const threadsStehen = (inhalt) => inhalt.split(/\s+/).some((wort) => wort.startsWith("-T") || wort.startsWith("--threads"));

// Je Typ die Dateien mit ihren Eintraegen: `steht` erkennt eine vorhandene Einstellung.
const DATEIEN = {
  gradle: [{
    pfad: "gradle.properties",
    eintraege: [
      { zeile: "org.gradle.caching=true", steht: propertySteht("org.gradle.caching") },
      { zeile: "org.gradle.parallel=true", steht: propertySteht("org.gradle.parallel") },
    ],
  }],
  maven: [{
    pfad: ".mvn/maven.config",
    eintraege: [{ zeile: "-T 1C", steht: threadsStehen }],
  }],
};

// Kommandos, die Integrationstests fahren: Sie gehoeren in den Integrationslauf, nicht in den Abschluss.
const INTEGRATION = /(^|[\s:])(verify|integrationTest|test:e2e)(?![\w:-])/;

// Testcontainers wiederverwenden spart je Lauf den Start der Container; die Einstellung liegt
// in der Benutzer-Datei ~/.testcontainers.properties, ausserhalb des Projekts — darum nur ein Hinweis.
const HINWEISE = { maven: ["testcontainers.reuse.enable=true"], gradle: ["testcontainers.reuse.enable=true"] };

/** Der Projekttyp der Wurzel: "maven", "gradle", "pnpm", "npm" oder null. */
export function erkenneProjekttyp(wurzel) {
  for (const [typ, dateien] of ERKENNUNG) {
    if (dateien.some((d) => existsSync(join(wurzel, d)))) return typ;
  }
  return null;
}

function lies(pfad) {
  try { return readFileSync(pfad, "utf-8"); } catch { return ""; }
}

/** Markiert einen Integrationslauf mit notAtCompletion; ein ausdruecklich gesetzter Wert bleibt. */
function zurueckstellen(check) {
  const cmd = typeof check === "string" ? check : check?.cmd;
  if (typeof cmd !== "string" || !INTEGRATION.test(cmd)) return null;
  if (typeof check === "object" && Object.hasOwn(check, "notAtCompletion")) return null;
  return typeof check === "string" ? { cmd, notAtCompletion: true } : { ...check, notAtCompletion: true };
}

/**
 * Die Vorgaben fuer die Wurzel und ihre `buildChecks`. `dateien` nennt je Datei nur die
 * fehlenden Zeilen, `buildChecks` ist die Liste mit den zurueckgestellten Integrationslaeufen,
 * `zurueckgestellt` nennt deren Kommandos, `hinweise` die Einstellungen ausserhalb des Projekts.
 */
export function projekttypVorgaben(wurzel, buildChecks = []) {
  const typ = erkenneProjekttyp(wurzel);
  const dateien = [];
  for (const { pfad, eintraege } of DATEIEN[typ] ?? []) {
    const inhalt = lies(join(wurzel, pfad));
    const zeilen = eintraege.filter((e) => !e.steht(inhalt)).map((e) => e.zeile);
    if (zeilen.length > 0) dateien.push({ pfad, zeilen });
  }
  const zurueckgestellt = [];
  const checks = buildChecks.map((check) => {
    const neu = zurueckstellen(check);
    if (!neu) return check;
    zurueckgestellt.push(neu.cmd);
    return neu;
  });
  return { typ, dateien, buildChecks: checks, zurueckgestellt, hinweise: HINWEISE[typ] ?? [] };
}

/** Gibt es etwas, das geschrieben wuerde? Ein Hinweis allein fragt nicht. */
export function vorgabenOffen(vorgaben) {
  return vorgaben.dateien.length > 0 || vorgaben.zurueckgestellt.length > 0;
}

/**
 * Schreibt die Dateien der Vorgaben in die Wurzel und haengt fehlende Zeilen an. Ein Pfad
 * ausserhalb der Wurzel bricht ab, bevor etwas geschrieben ist. Liefert die geschriebenen Pfade.
 */
export function vorgabenSchreiben(wurzel, vorgaben) {
  const ziele = vorgaben.dateien.map(({ pfad, zeilen }) => {
    const ziel = resolve(wurzel, pfad);
    const rel = relative(resolve(wurzel), ziel);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Vorgabe ausserhalb des Projekts: ${pfad}`);
    return { pfad, ziel, zeilen };
  });
  for (const { ziel, zeilen } of ziele) {
    const vorher = lies(ziel);
    const trenner = vorher && !vorher.endsWith("\n") ? "\n" : "";
    mkdirSync(dirname(ziel), { recursive: true });
    writeFileSync(ziel, `${vorher}${trenner}${zeilen.join("\n")}\n`, "utf-8");
  }
  return ziele.map((z) => z.pfad);
}
