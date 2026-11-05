// SPDX-License-Identifier: MIT
/**
 * checks/testauswahl.mjs — welche Testdateien ein Pruefkommando faehrt, gelesen aus seiner
 * Kommandozeile und den Vorgaben seines Laeufers (Issue #1716, Plan #1713 A5, A6, E8).
 *
 * Vorschlag und Abgleich der Pruefbereiche ordnen die Messung je Test einem Kommando zu. Eine
 * eigene Einstellung fuer die Testmenge eines Kommandos gibt es nicht (E8): Was hier nicht
 * gelesen wird, ist „nicht beurteilbar". Das Lesen irrt deshalb nur in eine Richtung. Eine
 * Testmenge, die groesser geraten ist als die gefahrene, schriebe einem Kommando Tests zu, die
 * es nicht faehrt, und der Abgleich verschwiege die Luecke — eine stille Entwarnung. Darum
 * heisst jede eigene Testauswahl eines Laeufers „nicht beurteilbar", statt sie nachzubauen.
 *
 * Gelesen wird (A5):
 *   - Segmente an `&&`, `||`, `|` und `;`; `cd <dir>`, `--prefix <dir>`, `-f <pom>` und `-pl`
 *     wirken als Ort.
 *   - `npm test` und `npm run <skript>` eine Stufe weit ueber die `package.json`.
 *   - `node --test` mit Pfaden oder Globs, sonst seine Vorgabesuche; Vitest und Jest mit ihrer
 *     Vorgabesuche.
 *   - Maven `test`, `verify`, `install` mit den Vorgaben von Surefire und Failsafe, eingeengt
 *     durch `-Dtest=` und `-Dit.test=`; Gradle `test` mit `--tests`.
 *
 * Das Urteil (A6): „nicht beurteilbar" mit Grund bei einem Laeufer einer anderen Sprache, einer
 * eigenen Testauswahl oder einem Abbruch; „nicht aus der Auswertung abgeleitet" bei einem
 * Kommando ohne erkannte Tests, `always: true`, der Stringform und den Stufen `push` und `merge`.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { readFileSync } from "node:fs";
import { posix as pfad } from "node:path";

import { globZuRegex, vergleicheText } from "../checks.mjs";
import { imArbeitsstand } from "./verflechtung.mjs";
import { TEXTE } from "../texte/checks-testauswahl.mjs";

// Die Texttabelle liegt im Teil texte/ (Issue #1524); exportiert bleibt sie unter ihrem Namen.
export { TEXTE };

// Der Texthelfer aus dem Board-Teil namen (Plan #1420 E13), abgefangen: Fehlt
// board/namen.mjs neben dem Kit, bleiben die Texte deutsch.
const namen = await import(new URL("../board/namen.mjs", import.meta.url).href).catch(() => null);

/** Der Text zu `schluessel` aus `TEXTE` in der Sprache des Prozesses; ohne Register deutsch. */
function t(schluessel, werte = {}) {
  if (namen) return namen.text(TEXTE, schluessel, werte);
  return TEXTE.de[schluessel].replaceAll(/\{([A-Za-z_]\w*)\}/g, (_, name) => String(werte[name]));
}

/** Die drei Urteile je Kommando (A6). */
export const URTEIL = Object.freeze({
  beurteilbar: "beurteilbar",
  nichtBeurteilbar: "nichtBeurteilbar",
  nichtAbgeleitet: "nichtAbgeleitet",
});

/** Traegt den Grund eines „nicht beurteilbar" aus der Tiefe des Lesens nach oben. */
class NichtBeurteilbar extends Error {}

const unbeurteilbar = (schluessel, werte) => new NichtBeurteilbar(t(schluessel, werte));

// --- Kommandozeile ---

// Ein Wort-Stueck der Kommandozeile: Leerraum, ein Trenner (`&&`, `||`, `|`, `;`, `&`), ein
// Text in Anfuehrungszeichen, ein maskiertes Zeichen oder ein Stueck ohne Sonderzeichen.
const STUECK = /(\s+)|(&&|\|\||[|;&])|'([^']*)'|"([^"]*)"|\\(.)|([^\s'"\\|;&]+)/gs;

/**
 * Zerlegt eine Kommandozeile in Segmente aus Woertern, getrennt an `&&`, `||`, `|`, `;` und
 * `&`. Anfuehrungszeichen und Backslash wie in der Shell; Umleitungen fallen heraus.
 */
function segmentieren(zeile) {
  return segmentierenMitStellen(zeile).map((segment) => segment.map(({ wort }) => wort));
}

/**
 * Dieselbe Zerlegung, je Wort mit seiner Stelle in der Zeile (`von` bis vor `bis`) — fuer den
 * Teilaufruf, der Woerter ersetzt und den Rest der Zeile stehen laesst (Issue #1980).
 */
function segmentierenMitStellen(zeile) {
  const segmente = [[]];
  let wort = null;
  const wortEnde = () => {
    if (wort !== null) segmente.at(-1).push(wort);
    wort = null;
  };
  // Die Umleitung auf einen Kanal wird durch gleich viele Leerzeichen ersetzt: Die Stellen
  // bleiben die der Zeile.
  const ohneKanal = zeile.replaceAll(/\d?>&\d/g, (treffer) => " ".repeat(treffer.length));
  for (const treffer of ohneKanal.matchAll(STUECK)) {
    const [text, leer, trenner, einfach, doppelt, maskiert, roh] = treffer;
    if (leer !== undefined) wortEnde();
    else if (trenner !== undefined) {
      wortEnde();
      segmente.push([]);
    } else {
      const teil = einfach ?? doppelt?.replaceAll(/\\(.)/g, "$1") ?? maskiert ?? roh;
      wort = wort === null ? { wort: teil, von: treffer.index } : { ...wort, wort: wort.wort + teil };
      wort.bis = treffer.index + text.length;
    }
  }
  wortEnde();
  return segmente.map(ohneUmleitung).filter((woerter) => woerter.length > 0);
}

/** Ein Segment ohne Umleitungen (`> datei`, `2>datei`). */
function ohneUmleitung(woerter) {
  let ziel = false;
  return woerter.filter(({ wort }) => {
    if (ziel) {
      ziel = false;
      return false;
    }
    if (!/^\d*[<>]/.test(wort)) return true;
    ziel = /^\d*[<>]+$/.test(wort);
    return false;
  });
}

// --- Orte und Dateien ---

/** `rel` vom Ort `basis` aus, repo-relativ; `.` ist die Wurzel. Ausserhalb des Repos bricht ab. */
function imOrt(basis, rel) {
  const ziel = pfad.normalize(pfad.join(basis, rel)).replace(/\/$/, "");
  if (rel.startsWith("/") || ziel === ".." || ziel.startsWith("../")) throw unbeurteilbar("ortAusserhalb", { ort: rel });
  return ziel === "" ? "." : ziel;
}

/** Der Pfad von `datei` relativ zum Ort `ort`, oder `null`, wenn die Datei nicht darunter liegt. */
function relativZu(ort, datei) {
  if (ort === ".") return datei;
  return datei.startsWith(`${ort}/`) ? datei.slice(ort.length + 1) : null;
}

/** Die Dateien unter `ort`, die `trifft(relativerPfad)` erfuellen. */
function unter(ctx, ort, trifft) {
  return ctx.alle.filter((d) => {
    const rel = relativZu(ort, d);
    return rel !== null && !/(?:^|\/)node_modules\//.test(rel) && trifft(rel);
  });
}

/** Der Text einer Datei des Arbeitsstands, oder `null`, wenn sie fehlt. */
function lesen(ctx, datei) {
  if (!ctx.menge.has(datei)) return null;
  try {
    return readFileSync(pfad.join(ctx.repoRoot, datei), "utf-8");
  } catch (error) {
    throw unbeurteilbar("unlesbar", { datei, grund: error.code ?? error.message });
  }
}

/** `{a,b}` ausgefaltet — die Globs von `checkAreas` kennen nur `*` und `**`. */
function klammernAusfalten(muster) {
  const m = muster.match(/^(.*?)\{([^{}]*)\}(.*)$/);
  if (!m) return [muster];
  return m[2].split(",").flatMap((teil) => klammernAusfalten(`${m[1]}${teil}${m[3]}`));
}

const globTrifft = (muster) => {
  const regexe = klammernAusfalten(muster).map((m) => globZuRegex(m));
  return (datei) => regexe.some((r) => r.test(datei));
};

// --- Eigene Testauswahl in einer Konfiguration ---

// Die Schluessel, mit denen Vitest oder Jest die Testmenge selbst waehlen (A5). Ueber die
// vier des Plans hinaus `root`, `rootDir`, `dir`, `projects` und `workspace`: Sie verlegen
// oder teilen die Suche, und eine verlegte Suche ist ebenso eine eigene Auswahl.
const AUSWAHL_SCHLUESSEL = ["include", "testMatch", "testRegex", "roots", "root", "rootDir", "dir", "projects", "workspace"];

/** Der Text ohne die Kommentare `/* … *\/`. */
function ohneBlockkommentar(text) {
  let rest = text;
  for (let anfang = rest.indexOf("/*"); anfang !== -1; anfang = rest.indexOf("/*")) {
    const ende = rest.indexOf("*/", anfang + 2);
    rest = rest.slice(0, anfang) + (ende === -1 ? "" : rest.slice(ende + 2));
  }
  return rest;
}

/** Die Zeile ohne einen Kommentar `// …`; `://` in einer Adresse bleibt stehen. */
function ohneZeilenkommentar(zeile) {
  const stelle = zeile.indexOf("//");
  return stelle === -1 || `:"'\\`.includes(zeile[stelle - 1] ?? "-") ? zeile : zeile.slice(0, stelle);
}

/** Der Text ohne Kommentare und ohne die Bloecke `coverage: { … }`. */
function ohneCoverage(text) {
  let rest = ohneBlockkommentar(text).split("\n").map(ohneZeilenkommentar).join("\n");
  const kopf = /["']?coverage["']?\s*:\s*\{/;
  for (let m = rest.match(kopf); m; m = rest.match(kopf)) {
    let tiefe = 0;
    let ende = m.index + m[0].length - 1;
    for (; ende < rest.length; ende += 1) {
      if (rest[ende] === "{") tiefe += 1;
      else if (rest[ende] === "}" && --tiefe === 0) break;
    }
    rest = rest.slice(0, m.index) + rest.slice(ende + 1);
  }
  return rest;
}

/** Der erste Auswahl-Schluessel im Text ausserhalb von `coverage`, oder `null`. */
function auswahlSchluessel(text) {
  const rest = ohneCoverage(text);
  return AUSWAHL_SCHLUESSEL.find((s) => new RegExp(String.raw`(?:^|[\s,{(])["']?${s}["']?\s*:`, "m").test(rest)) ?? null;
}

/** Bricht ab, wenn eine der Konfigurationen die Tests selbst waehlt. */
function konfigurationPruefen(dateien) {
  for (const { datei, text } of dateien) {
    const schluessel = auswahlSchluessel(text);
    if (schluessel) throw unbeurteilbar("eigeneAuswahl", { datei, schluessel });
  }
}

// --- Die Laeufer ---

/** Die Optionen, deren Wert als eigenes Wort folgt — je Laeufer. */
const NODE_MIT_WERT = new Set([
  "--import", "--require", "-r", "--loader", "--experimental-loader", "--test-reporter",
  "--test-reporter-destination", "--test-name-pattern", "--test-skip-pattern", "--test-concurrency",
  "--test-timeout", "--env-file", "--conditions", "-C", "--input-type", "--test-isolation",
]);
const VITEST_MIT_WERT = new Set([
  "--reporter", "--outputFile", "--pool", "--environment", "--maxWorkers", "--minWorkers",
  "--testTimeout", "--mode", "-t", "--testNamePattern", "--retry", "--bail", "--hookTimeout",
]);
const VITEST_AUSWAHL = new Set(["--dir", "--project", "--workspace", "--changed", "--shard", "--exclude", "--related"]);
const JEST_MIT_WERT = new Set([
  "--maxWorkers", "-w", "--reporters", "-t", "--testNamePattern", "--coverageReporters",
  "--outputFile", "--testTimeout", "--env", "--coverageDirectory", "--seed",
]);
const JEST_AUSWAHL = new Set([
  "--testPathPattern", "--testPathPatterns", "--testMatch", "--testRegex", "--roots", "--rootDir",
  "--selectProjects", "--projects", "--shard", "--onlyChanged", "-o", "--changedSince", "--lastCommit",
  "--findRelatedTests", "--testPathIgnorePatterns",
]);
const MAVEN_MIT_WERT = new Set(["-f", "--file", "-pl", "--projects", "-P", "--activate-profiles", "-s", "--settings", "-gs", "-T", "--threads", "-t", "-l", "--log-file", "-b", "-rf", "--resume-from"]);
const GRADLE_MIT_WERT = new Set(["-x", "--exclude-task", "--tests", "-p", "--project-dir", "-b", "--build-file", "-c", "--settings-file", "--max-workers", "-g", "--gradle-user-home"]);

/**
 * Die Optionen eines Laeufers und seine uebrigen Woerter, Werte zur Option gelegt. `stellen`
 * nennt je Position ihren Index in `woerter` (Issue #1980).
 */
function optionenLesen(woerter, mitWert) {
  const optionen = [];
  const positionen = [];
  const stellen = [];
  const position = (i) => {
    positionen.push(woerter[i]);
    stellen.push(i);
  };
  for (let i = 0; i < woerter.length; i += 1) {
    const wort = woerter[i];
    const gleich = wort.indexOf("=");
    if (wort === "--") {
      for (let j = i + 1; j < woerter.length; j += 1) position(j);
      break;
    }
    if (!wort.startsWith("-") || wort === "-") position(i);
    else if (gleich > 0) optionen.push({ name: wort.slice(0, gleich), wert: wort.slice(gleich + 1) });
    else if (mitWert.has(wort)) {
      optionen.push({ name: wort, wert: woerter[i + 1] ?? "" });
      i += 1;
    } else optionen.push({ name: wort, wert: null });
  }
  return { optionen, positionen, stellen };
}

const wertVon = (optionen, ...namen) => optionen.filter((o) => namen.includes(o.name)).map((o) => o.wert);

// Die Vorgabesuche von `node --test` (Node 22 bis 26, ohne Typen-Abstreifen).
const NODE_VORGABE = [/(?:^|\/)[^/]*[.\-_]test\.[cm]?js$/, /(?:^|\/)test(?:-[^/]*)?\.[cm]?js$/, /(?:^|\/)test\/.*\.[cm]?js$/];
const nodeVorgabe = (rel) => NODE_VORGABE.some((r) => r.test(rel));

/** Die Optionen mit Wert je teilbarem Laeufer — dieselben, mit denen er gelesen wird. */
const VITEST_LESEN = new Set([...VITEST_MIT_WERT, "--config", "-c", "--root", "-r"]);
const JEST_LESEN = new Set([...JEST_MIT_WERT, "--config", "-c"]);

function nodeTest(woerter, ort, ctx) {
  const { optionen, positionen } = optionenLesen(woerter, NODE_MIT_WERT);
  if (!optionen.some((o) => o.name === "--test")) return null;
  const schnitt = optionen.find((o) => o.name === "--test-shard");
  if (schnitt) throw unbeurteilbar("optionAuswahl", { laeufer: "node --test", option: schnitt.name });
  if (positionen.length === 0) return { ort, tests: unter(ctx, ort, nodeVorgabe) };
  const tests = [];
  for (const arg of positionen) {
    const ziel = imOrt(ort, arg);
    if (ctx.menge.has(ziel)) tests.push(ziel);
    else if (/[*?{[]/.test(arg)) tests.push(...ctx.alle.filter(globTrifft(ziel)));
    else tests.push(...unter(ctx, ziel, nodeVorgabe));
  }
  return { ort, tests };
}

const VITEST_VORGABE = /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/;
const VITEST_AUSGENOMMEN = /(?:^|\/)(?:dist|cypress|\.idea|\.git|\.cache|\.output|\.temp)\//;
const JS_KONFIG = ["ts", "mts", "cts", "js", "mjs", "cjs"];

function vitest(woerter, ort, ctx) {
  const { optionen, positionen } = optionenLesen(woerter, VITEST_LESEN);
  const auswahl = optionen.find((o) => VITEST_AUSWAHL.has(o.name));
  if (auswahl) throw unbeurteilbar("optionAuswahl", { laeufer: "vitest", option: auswahl.name });
  const [erstes] = positionen;
  if (erstes === "related") throw unbeurteilbar("optionAuswahl", { laeufer: "vitest", option: erstes });
  if (["bench", "list", "init"].includes(erstes)) return null;
  const filter = positionen.filter((p, i) => !(i === 0 && ["run", "watch", "dev"].includes(p)));
  const wurzel = wertVon(optionen, "--root", "-r").reduce((basis, w) => imOrt(basis, w), ort);

  const konfig = wertVon(optionen, "--config", "-c").map((w) => imOrt(ort, w));
  const kandidaten = konfig.length > 0 ? konfig : [
    ...JS_KONFIG.map((e) => imOrt(wurzel, `vitest.config.${e}`)),
    ...JS_KONFIG.map((e) => imOrt(wurzel, `vite.config.${e}`)),
  ];
  const arbeitsbereich = [...JS_KONFIG, "json"].map((e) => imOrt(wurzel, `vitest.workspace.${e}`)).find((d) => ctx.menge.has(d));
  if (arbeitsbereich) throw unbeurteilbar("eigeneAuswahl", { datei: arbeitsbereich, schluessel: "workspace" });
  const gelesen = kandidaten.find((d) => ctx.menge.has(d));
  if (gelesen) konfigurationPruefen([{ datei: gelesen, text: lesen(ctx, gelesen) }]);

  const tests = unter(ctx, wurzel, (rel) => VITEST_VORGABE.test(rel) && !VITEST_AUSGENOMMEN.test(rel)
    && (filter.length === 0 || filter.some((f) => rel.includes(f))));
  return { ort: wurzel, tests };
}

const JEST_VORGABE = [/(?:^|\/)__tests__\/.*\.[cm]?[jt]sx?$/, /(?:^|\/)(?:[^/]*\.)?(?:spec|test)\.[cm]?[jt]sx?$/];

function jest(woerter, ort, ctx) {
  const { optionen, positionen } = optionenLesen(woerter, JEST_LESEN);
  const auswahl = optionen.find((o) => JEST_AUSWAHL.has(o.name));
  if (auswahl) throw unbeurteilbar("optionAuswahl", { laeufer: "jest", option: auswahl.name });

  const konfigurationen = [];
  for (const wert of wertVon(optionen, "--config", "-c")) {
    if (wert.trim().startsWith("{")) konfigurationen.push({ datei: "--config", text: wert });
    else {
      const datei = imOrt(ort, wert);
      konfigurationen.push({ datei, text: lesen(ctx, datei) ?? "" });
    }
  }
  if (konfigurationen.length === 0) {
    for (const e of [...JS_KONFIG, "json"]) {
      const datei = imOrt(ort, `jest.config.${e}`);
      if (ctx.menge.has(datei)) konfigurationen.push({ datei, text: lesen(ctx, datei) });
    }
    const paket = imOrt(ort, "package.json");
    const angabe = paketLesen(ctx, paket)?.jest;
    if (angabe !== undefined) konfigurationen.push({ datei: paket, text: JSON.stringify(angabe) });
  }
  konfigurationPruefen(konfigurationen);

  let muster;
  try {
    muster = positionen.map((p) => new RegExp(p));
  } catch {
    throw unbeurteilbar("optionAuswahl", { laeufer: "jest", option: positionen.join(" ") });
  }
  const tests = unter(ctx, ort, (rel) => JEST_VORGABE.some((r) => r.test(rel)) && (muster.length === 0 || muster.some((r) => r.test(rel))));
  return { ort, tests };
}

/** Die `package.json` als Objekt, `null`, wenn sie fehlt oder unlesbar ist. */
function paketLesen(ctx, datei) {
  const text = lesen(ctx, datei);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw unbeurteilbar("unlesbar", { datei, grund: error.message });
  }
}

function npm(woerter, ort, ctx, ebene) {
  if (ebene.skript !== undefined) {
    throw unbeurteilbar("skriptVerschachtelt", { skript: ebene.skript, aufruf: ["npm", ...woerter].join(" ") });
  }
  const { optionen, positionen } = optionenLesen(woerter, new Set(["--prefix", "-C", "--workspace", "-w"]));
  const bereich = optionen.find((o) => ["--workspace", "-w", "--workspaces", "-ws"].includes(o.name));
  if (bereich) throw unbeurteilbar("optionAuswahl", { laeufer: "npm", option: bereich.name });
  const [befehl, ...rest] = positionen;
  let skript;
  let zusatz;
  if (["test", "t", "tst"].includes(befehl)) [skript, zusatz] = ["test", rest];
  else if (["run", "run-script", "rum", "urn"].includes(befehl)) [skript, ...zusatz] = rest;
  else return null;
  if (!skript) return null;

  const paketOrt = wertVon(optionen, "--prefix", "-C").reduce((basis, w) => imOrt(basis, w), ort);
  const datei = imOrt(paketOrt, "package.json");
  const zeile = paketLesen(ctx, datei)?.scripts?.[skript];
  if (typeof zeile !== "string") throw unbeurteilbar("skriptFehlt", { datei, skript });
  const maskiert = (z) => ["'", z.replaceAll("'", String.raw`'\''`), "'"].join("");
  const mitZusatz = [zeile, ...zusatz.map(maskiert)].join(" ");
  return segmenteLesen(mitZusatz, paketOrt, ctx, { skript });
}

// Die Phasen des Maven-Lebenszyklus, die Surefire und Failsafe erreichen.
const MAVEN_PHASEN = [
  "validate", "initialize", "generate-sources", "process-sources", "generate-resources", "process-resources",
  "compile", "process-classes", "generate-test-sources", "process-test-sources", "generate-test-resources",
  "process-test-resources", "test-compile", "process-test-classes", "test", "prepare-package", "package",
  "pre-integration-test", "integration-test", "post-integration-test", "verify", "install", "deploy",
];
const SUREFIRE_VORGABE = /^(?:Test[^/]*|[^/]*Test|[^/]*Tests|[^/]*TestCase)\.java$/;
const FAILSAFE_VORGABE = /^(?:IT[^/]*|[^/]*IT|[^/]*ITCase)\.java$/;

/** Modul und Klassenpfad einer Java-Testquelle unter `src/test/java/`, oder `null`. */
function javaTest(datei) {
  if (!datei.endsWith(".java") || /(?:^|\/)node_modules\//.test(datei)) return null;
  const marke = "src/test/java/";
  const stelle = datei.startsWith(marke) ? 0 : datei.indexOf(`/${marke}`) + 1;
  if (stelle === 0 && !datei.startsWith(marke)) return null;
  const klasse = datei.slice(stelle + marke.length, -".java".length);
  return { modul: stelle === 0 ? "." : datei.slice(0, stelle - 1), klasse, name: `${klasse.split("/").at(-1)}.java` };
}

/** Ob eine Systemeigenschaft gesetzt und nicht `false` ist. */
const schalter = (eigenschaften, name) => eigenschaften.has(name) && eigenschaften.get(name) !== "false";

/** Ob das Klassenmuster von `-Dtest=`/`-Dit.test=` die Testklasse trifft. */
function klasseTrifft(muster, klasse) {
  const [ohneMethode] = muster.split("#");
  if (ohneMethode.includes("/")) return globTrifft(ohneMethode.replace(/\.java$/, ""))(klasse);
  if (ohneMethode.includes(".")) return globTrifft(ohneMethode.replaceAll(".", "/"))(klasse);
  return globTrifft(ohneMethode)(klasse.split("/").at(-1));
}

/** Die Klassen, die eine Liste aus `-Dtest=` waehlt; `null` heisst: die Vorgaben. */
function klassenFilter(liste, vorgabe) {
  if (liste === undefined) return vorgabe;
  const teile = liste.split(",").map((s) => s.trim()).filter(Boolean);
  const ein = teile.filter((s) => !s.startsWith("!"));
  const aus = teile.filter((s) => s.startsWith("!")).map((s) => s.slice(1));
  return (klasse, name) => (ein.length === 0 ? vorgabe(klasse, name) : ein.some((m) => klasseTrifft(m, klasse)))
    && !aus.some((m) => klasseTrifft(m, klasse));
}

/** Die pom.xml vom Modul `modul` bis zur Wurzel, die es im Arbeitsstand gibt, ohne Kommentare. */
function pomKette(ctx, modul) {
  const kette = [];
  for (let ordner = modul; ; ordner = pfad.dirname(ordner)) {
    const datei = ordner === "." || ordner === "" ? "pom.xml" : `${ordner}/pom.xml`;
    const text = lesen(ctx, datei);
    if (text !== null) kette.push({ datei, text: text.replaceAll(/<!--[\s\S]*?-->/g, "") });
    if (ordner === "." || ordner === "") return kette;
  }
}

/** Bricht ab, wenn ein pom die Testauswahl eines aktiven Plugins selbst traegt. */
function pomPruefen(kette, plugins) {
  for (const { datei, text } of kette) {
    for (const [, block] of text.matchAll(/<plugin>([\s\S]*?)<\/plugin>/g)) {
      const plugin = plugins.find((p) => block.includes(`<artifactId>${p}</artifactId>`));
      const eintrag = plugin && ["<includes>", "<testSourceDirectory>"].find((e) => block.includes(e));
      if (eintrag) throw unbeurteilbar("eigeneAuswahl", { datei, schluessel: `${plugin} ${eintrag}` });
    }
    if (text.replaceAll(/<plugin>[\s\S]*?<\/plugin>/g, "").includes("<testSourceDirectory>")) {
      throw unbeurteilbar("eigeneAuswahl", { datei, schluessel: "<testSourceDirectory>" });
    }
  }
}

/** Welche Plugins der Aufruf erreicht und welche Klassen sie waehlen. */
function mavenPlugins(optionen, positionen) {
  const eigenschaften = new Map();
  for (const o of optionen.filter((x) => x.name.startsWith("-D"))) eigenschaften.set(o.name.slice(2), o.wert ?? "true");
  const phase = Math.max(-1, ...positionen.map((p) => MAVEN_PHASEN.indexOf(p)));
  const ohneTests = schalter(eigenschaften, "skipTests") || schalter(eigenschaften, "maven.test.skip");
  return {
    surefire: (phase >= MAVEN_PHASEN.indexOf("test") || positionen.includes("surefire:test")) && !ohneTests,
    failsafe: (phase >= MAVEN_PHASEN.indexOf("integration-test") || positionen.some((p) => p.startsWith("failsafe:")))
      && !ohneTests && !schalter(eigenschaften, "skipITs"),
    surefireFilter: klassenFilter(eigenschaften.get("test"), (_, name) => SUREFIRE_VORGABE.test(name)),
    failsafeFilter: klassenFilter(eigenschaften.get("it.test"), (_, name) => FAILSAFE_VORGABE.test(name)),
  };
}

/** Der Ort des Reaktors (`-f`) und die Modulordner aus `-pl`. */
function mavenOrte(optionen, ort, ctx) {
  let mavenOrt = ort;
  for (const f of wertVon(optionen, "-f", "--file")) {
    const ziel = imOrt(ort, f);
    mavenOrt = ziel.endsWith(".xml") ? imOrt(pfad.dirname(ziel), ".") : ziel;
  }
  const module = wertVon(optionen, "-pl", "--projects").flatMap((w) => w.split(",")).map((m) => m.trim()).filter(Boolean);
  for (const m of module) {
    if (/^[:!-]/.test(m) || !ctx.menge.has(imOrt(imOrt(mavenOrt, m), "pom.xml"))) throw unbeurteilbar("modulUnbekannt", { modul: m });
  }
  return { mavenOrt, ordner: module.map((m) => imOrt(mavenOrt, m)) };
}

function maven(woerter, ort, ctx) {
  const { optionen, positionen } = optionenLesen(woerter, MAVEN_MIT_WERT);
  const mit = optionen.find((o) => ["-am", "--also-make", "-amd", "--also-make-dependents"].includes(o.name));
  if (mit) throw unbeurteilbar("mitAbhaengigen", { option: mit.name });
  const plugins = mavenPlugins(optionen, positionen);
  if (!plugins.surefire && !plugins.failsafe) return null;
  const { mavenOrt, ordner } = mavenOrte(optionen, ort, ctx);
  const imReaktor = (datei, modul) => (ordner.length === 0 ? relativZu(mavenOrt, datei) !== null : ordner.includes(modul));

  // Je Modul einmal: ob Failsafe gebunden ist, und ob ein pom die Auswahl selbst traegt.
  const mitFailsafe = new Map();
  const failsafeIn = (modul) => {
    if (!mitFailsafe.has(modul)) {
      const kette = pomKette(ctx, modul);
      const failsafe = plugins.failsafe && kette.some(({ text }) => text.includes("maven-failsafe-plugin"));
      pomPruefen(kette, [plugins.surefire && "maven-surefire-plugin", failsafe && "maven-failsafe-plugin"].filter(Boolean));
      mitFailsafe.set(modul, failsafe);
    }
    return mitFailsafe.get(modul);
  };
  const tests = ctx.alle.filter((datei) => {
    const java = javaTest(datei);
    if (!java || !imReaktor(datei, java.modul)) return false;
    const failsafe = failsafeIn(java.modul);
    return (plugins.surefire && plugins.surefireFilter(java.klasse, java.name))
      || (failsafe && plugins.failsafeFilter(java.klasse, java.name));
  });
  return { ort: ordner.length === 1 ? ordner[0] : mavenOrt, tests };
}

/** Ob ein Muster aus `--tests` die Testklasse trifft (voll qualifiziert, einfach, mit Methode). */
function gradleTrifft(muster, klasse) {
  const voll = klasse.replaceAll("/", ".");
  const einfach = voll.split(".").at(-1);
  const quelle = muster.split("*").map((s) => s.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`)).join(".*");
  const regex = new RegExp(`^${quelle}$`);
  return [voll, einfach].some((n) => regex.test(n) || muster.startsWith(`${n}.`));
}

function gradle(woerter, ort, ctx) {
  const { optionen, positionen } = optionenLesen(woerter, GRADLE_MIT_WERT);
  const ausgelassen = new Set(wertVon(optionen, "-x", "--exclude-task"));
  const aufgaben = positionen.filter((p) => /(?:^|:)(?:test|check|build)$/.test(p) && !ausgelassen.has(p) && !ausgelassen.has("test"));
  if (aufgaben.length === 0) return null;
  const gradleOrt = wertVon(optionen, "-p", "--project-dir").reduce((basis, w) => imOrt(basis, w), ort);
  const ordner = aufgaben.map((a) => (a.includes(":") ? imOrt(gradleOrt, a.split(":").slice(0, -1).filter(Boolean).join("/") || ".") : null));
  const ueberall = ordner.includes(null);

  for (const o of new Set(ueberall ? [gradleOrt] : ordner)) {
    for (const name of ["build.gradle", "build.gradle.kts"]) {
      const datei = imOrt(o, name);
      const text = lesen(ctx, datei);
      const schluessel = text && ["includeTestsMatching", "testClassesDirs"].find((s) => text.includes(s));
      if (schluessel) throw unbeurteilbar("eigeneAuswahl", { datei, schluessel });
    }
  }
  const muster = wertVon(optionen, "--tests");
  const tests = ctx.alle.filter((datei) => {
    const java = javaTest(datei);
    if (!java) return false;
    const imOrdner = ueberall ? relativZu(gradleOrt, datei) !== null : ordner.includes(java.modul);
    return imOrdner && (muster.length === 0 || muster.some((x) => gradleTrifft(x, java.klasse)));
  });
  return { ort: !ueberall && ordner.length === 1 ? ordner[0] : gradleOrt, tests };
}

/** Der Laeufer einer anderen Sprache, den das Segment startet, oder `null`. */
function fremdeSprache(name, woerter) {
  if (["pytest", "py.test", "rspec", "phpunit", "bats"].includes(name)) return name;
  if (/^python\d*(?:\.\d+)?$/.test(name) && woerter[0] === "-m" && woerter[1] === "pytest") return "pytest";
  if (["go", "cargo", "dotnet"].includes(name) && woerter[0] === "test") return `${name} test`;
  if (name === "bundle" && woerter[0] === "exec") return fremdeSprache(woerter[1] ?? "", woerter.slice(2));
  return null;
}

/** Die Stelle des Programms in einem Segment: hinter Variablen und `npx` samt seinen Optionen. */
function kopfStelle(woerter) {
  let i = 0;
  while (i < woerter.length && /^[A-Za-z_]\w*=/.test(woerter[i])) i += 1;
  if (woerter[i] === "npx") {
    i += 1;
    while (woerter[i]?.startsWith("-")) i += 1;
  }
  return i;
}

/** Liest ein Segment: einen neuen Ort, die gefahrenen Tests oder `null`. */
function segmentLesen(woerter, ort, ctx, ebene) {
  const rest = woerter.slice(kopfStelle(woerter));
  if (rest.length === 0) return null;
  const [kopf, ...argumente] = rest;
  const name = pfad.basename(kopf);
  if (name === "cd") return { cd: imOrt(ort, argumente[0] ?? ".") };

  const fremd = fremdeSprache(name, argumente);
  if (fremd) throw unbeurteilbar("fremdeSprache", { laeufer: fremd });
  if (name === "npm") return npm(argumente, ort, ctx, ebene);
  if (name === "node") return nodeTest(argumente, ort, ctx);
  if (name === "vitest") return vitest(argumente, ort, ctx);
  if (name === "jest") return jest(argumente, ort, ctx);
  if (name === "mvn" || name === "mvnw") return maven(argumente, ort, ctx);
  if (name === "gradle" || name === "gradlew") return gradle(argumente, ort, ctx);
  return null;
}

/**
 * Liest alle Segmente einer Kommandozeile vom Ort `ort` aus. Ergebnis: die gefahrenen Tests
 * und der Ort des ersten Segments mit Tests (`null`, wenn keines Tests faehrt).
 */
function segmenteLesen(zeile, ort, ctx, ebene = {}) {
  let hier = ort;
  let ortMitTests = null;
  const tests = new Set();
  for (const woerter of segmentieren(zeile)) {
    const ergebnis = segmentLesen(woerter, hier, ctx, ebene);
    if (ergebnis?.cd !== undefined) hier = ergebnis.cd;
    else if (ergebnis && ergebnis.tests.length > 0) {
      ortMitTests ??= ergebnis.ort;
      for (const d of ergebnis.tests) tests.add(d);
    }
  }
  return { ort: ortMitTests, tests: [...tests] };
}

const ergebnis = (urteil, grund, ort = ".", tests = []) => ({ urteil, grund, ort, tests });

/**
 * Welche Testdateien ein Eintrag aus `buildChecks` faehrt, mit Ort und Urteil (A5, A6).
 *
 * `dateien` ist die Dateimenge, in der gesucht wird (repo-relativ); ohne sie der Arbeitsstand
 * aus `git ls-files`, versioniert und uncommittet neu angelegt, wie in der Messung.
 *
 * @param {string|{ cmd: string, areas?: string[], always?: boolean, stufe?: string }} eintrag
 * @param {{ repoRoot?: string, dateien?: string[] }} [optionen]
 * @returns {{ urteil: string, grund: string|null, ort: string, tests: string[] }} `ort` und
 *   `tests` repo-relativ, `ort` `.` fuer die Wurzel; `grund` nur ohne Urteil `beurteilbar`
 */
export function testsVon(eintrag, { repoRoot = process.cwd(), dateien } = {}) {
  if (typeof eintrag === "string" || !(eintrag.always || eintrag.areas?.length > 0)) {
    return ergebnis(URTEIL.nichtAbgeleitet, t("stringform"));
  }
  if (eintrag.always === true) return ergebnis(URTEIL.nichtAbgeleitet, t("immer"));
  const stufe = eintrag.stufe ?? "paket";
  if (stufe !== "paket") return ergebnis(URTEIL.nichtAbgeleitet, t("stufe", { stufe }));

  try {
    const alle = (dateien ?? imArbeitsstand(repoRoot)).map((d) => d.replaceAll("\\", "/")).sort(vergleicheText);
    const ctx = { repoRoot, alle, menge: new Set(alle) };
    const { ort, tests } = segmenteLesen(eintrag.cmd, ".", ctx);
    if (tests.length === 0) return ergebnis(URTEIL.nichtAbgeleitet, t("keineTests"));
    return ergebnis(URTEIL.beurteilbar, null, ort, tests.sort(vergleicheText));
  } catch (error) {
    // Ein Abbruch beim Lesen ist nie eine Entwarnung (Kriterium 8): Er wird zum Grund.
    return ergebnis(URTEIL.nichtBeurteilbar, error.message);
  }
}

/**
 * Der Zaehler fuer das Gewicht einer Pruefung beim Teilen mit `--part` (Issue #2188, Plan #2176,
 * E2, E12): eine Funktion `(cmd) => Zahl der Testdateien`, die die Muster der Kommandozeile
 * treffen, gelesen ueber `segmenteLesen` wie jede andere Auswahl hier — ohne das Urteil von
 * `testsVon`, das `always` und die spaeteren Stufen nicht ableitet. Die Dateimenge wird einmal
 * gelesen; ein Abbruch beim Lesen zaehlt 0.
 *
 * @param {{ repoRoot?: string, dateien?: string[] }} [optionen]
 * @returns {(cmd: string) => number}
 */
export function testdateienZaehler({ repoRoot = process.cwd(), dateien } = {}) {
  const alle = (dateien ?? imArbeitsstand(repoRoot)).map((d) => d.replaceAll("\\", "/")).sort(vergleicheText);
  const ctx = { repoRoot, alle, menge: new Set(alle) };
  return (cmd) => {
    try {
      return segmenteLesen(cmd, ".", ctx).tests.length;
    } catch {
      return 0;
    }
  };
}

// --- Der Teilaufruf (Issue #1980, Plan #1969, E3) ---

/**
 * Die teilbaren Laeufer: wie ihre Woerter gelesen werden und welche Positionen stehen bleiben.
 * Vitest behaelt seinen Unterbefehl; mit `--root` sucht es anders als vom Ort aus und ist
 * nicht teilbar.
 */
const TEILBAR = Object.freeze({
  node: { lesen: NODE_MIT_WERT, bleibt: () => false, gesperrt: [] },
  vitest: { lesen: VITEST_LESEN, bleibt: (wort, i) => i === 0 && ["run", "watch", "dev"].includes(wort), gesperrt: ["--root", "-r"] },
  jest: { lesen: JEST_LESEN, bleibt: () => false, gesperrt: [] },
});

/** Ein Pfad als Shell-Wort: unveraendert, wenn er nichts Besonderes enthaelt, sonst in `'…'`. */
function shellWort(text) {
  return /^[\w@%+=:,./-]+$/.test(text) ? text : ["'", text.replaceAll("'", String.raw`'\''`), "'"].join("");
}

/**
 * Dieselbe Kommandozeile eines Eintrags, die statt ihrer Pfade und Globs nur `tests` faehrt —
 * oder `null`, wenn sich das Kommando nicht teilen laesst (Issue #1980, Plan #1969, E3).
 *
 * Teilbar ist ein Kommando, das `testsVon` als `beurteilbar` erkennt und dessen Tests genau ein
 * Segment mit `node --test`, `vitest` oder `jest` faehrt. Ein npm-Skript, Maven, Gradle und
 * eine Zeile mit zwei Testsegmenten sind es nicht: Dort ist die Dateiliste nicht sicher
 * einzusetzen. Die Positionen des Laeufers fallen weg, `tests` steht relativ zum Ort des
 * Segments hinter seinem letzten Wort; alles uebrige der Zeile bleibt, wie es war. Eine leere
 * Liste oder ein Test, den das Kommando nicht faehrt, ergibt `null` — ohne Datei faehrt ein
 * Laeufer seine ganze Vorgabesuche.
 *
 * @param {string|{ cmd: string, areas?: string[], always?: boolean, stufe?: string }} eintrag
 * @param {string[]} tests repo-relativ
 * @param {{ repoRoot?: string, dateien?: string[] }} [optionen]
 * @returns {string|null}
 */
export function teilzeileBauen(eintrag, tests, { repoRoot = process.cwd(), dateien } = {}) {
  const gelesen = testsVon(eintrag, { repoRoot, dateien });
  if (gelesen.urteil !== URTEIL.beurteilbar || tests.length === 0) return null;
  const gefahren = new Set(gelesen.tests);
  if (!tests.every((test) => gefahren.has(test))) return null;

  const alle = (dateien ?? imArbeitsstand(repoRoot)).map((d) => d.replaceAll("\\", "/")).sort(vergleicheText);
  const gefunden = testsegment(eintrag.cmd, { repoRoot, alle, menge: new Set(alle) });
  if (gefunden === null) return null;
  const { segment, ort } = gefunden;

  const kopf = kopfStelle(segment.map(({ wort }) => wort));
  const laeufer = TEILBAR[pfad.basename(segment[kopf].wort)];
  if (!laeufer) return null;
  const argumente = segment.slice(kopf + 1);
  const { optionen, positionen, stellen } = optionenLesen(argumente.map(({ wort }) => wort), laeufer.lesen);
  if (optionen.some((o) => laeufer.gesperrt.includes(o.name))) return null;
  const weg = new Set(stellen.filter((_, i) => !laeufer.bleibt(positionen[i], i)));
  const relativ = tests.map((test) => relativZu(ort, test));
  if (relativ.includes(null)) return null;

  // Die Dateien hinter das letzte bleibende Wort, jede Position samt dem Leerraum davor heraus.
  const bleibend = [segment[kopf], ...argumente.filter((_, i) => !weg.has(i))];
  const ende = bleibend.at(-1).bis;
  const schnitte = [{ von: ende, bis: ende, text: ` ${relativ.map(shellWort).join(" ")}` }];
  for (const i of weg) {
    const davor = i === 0 ? segment[kopf] : argumente[i - 1];
    schnitte.push({ von: davor.bis, bis: argumente[i].bis, text: "" });
  }
  return schneiden(eintrag.cmd, schnitte);
}

/**
 * Das eine Segment einer Zeile, das Tests faehrt, mit seinem Ort — `null`, wenn es keines oder
 * mehrere gibt oder das Lesen abbricht.
 */
function testsegment(zeile, ctx) {
  let hier = ".";
  const mitTests = [];
  try {
    for (const segment of segmentierenMitStellen(zeile)) {
      const ergebnis = segmentLesen(segment.map(({ wort }) => wort), hier, ctx, {});
      if (ergebnis?.cd !== undefined) hier = ergebnis.cd;
      else if (ergebnis && ergebnis.tests.length > 0) mitTests.push({ segment, ort: hier });
    }
  } catch (error) {
    if (error instanceof NichtBeurteilbar) return null;
    throw error;
  }
  return mitTests.length === 1 ? mitTests[0] : null;
}

/** Die Zeile mit den Schnitten `{ von, bis, text }`, von hinten nach vorn: Die Stellen davor gelten weiter. */
function schneiden(zeile, schnitte) {
  let ergebnis = zeile;
  for (const { von, bis, text } of [...schnitte].sort((a, b) => b.von - a.von || b.bis - a.bis)) {
    ergebnis = ergebnis.slice(0, von) + text + ergebnis.slice(bis);
  }
  return ergebnis;
}
