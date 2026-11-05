// SPDX-License-Identifier: MIT
/**
 * board/fassung.mjs — der Bezugsstand „zuletzt veroeffentlichte Fassung“ an einer Stelle
 * (Issue #1842, Plan #1830 E1, E2, E4): `doctor`, `update check`, `update run`, `update all` und
 * der Installer lesen ihn gleich.
 *
 * Dieser Teil importiert nur `node:*`. Der Installer laedt ihn ueber `ladeTeil` als `data:`-URL,
 * ohne Nachbarn; ein relativer Import liefe dort ins Leere. Meldungen liefert er darum als
 * Rueckgabewerte, die Texte stehen beim Aufrufer.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Das private Repository, aus dem Pro bezogen wird (Plan #1918 E6). */
export const PRO_REPO = "mannewolff/claude-workflow-kit-pro";

/**
 * Die veroeffentlichten Ausgaben des Kits und wo ihr Installer liegt (E1). Pro liegt auf dem
 * Zweig `production` von `PRO_REPO` und ist nur mit Zugang abrufbar (Plan #1918 E7).
 */
export const AUSGABEN = Object.freeze({
  community: "https://docs.mwolff.org/install.mjs",
  pro: `https://api.github.com/repos/${PRO_REPO}/contents/install.mjs?ref=production`,
});

/**
 * Die erste Fassung, die Community und Pro getrennt ausliefert (Plan #1918 E8). Eine aeltere Kopie
 * traegt `pro` als Vorgabe, ohne dass jemand gewaehlt hat; ihr Update holt Community.
 */
export const ERSTE_GETRENNTE_FASSUNG = "6.0.0";

/**
 * Die Release-Beschreibung, an deren Assets Pakete und Manifest `app.json` der Desktop-App liegen
 * (Plan #1918 E16). Nur mit Zugang abrufbar, wie `AUSGABEN.pro`.
 */
export const APP_RELEASE = `https://api.github.com/repos/${PRO_REPO}/releases/latest`;

/** Von der Antwort werden hoechstens so viele Bytes gelesen (E2). */
export const LESEGRENZE = 64 * 1024;

/**
 * Die Kennung der Skripte im Projektordner (#1794). Ein Skript ohne sie gehoert dem Projekt.
 *
 * SYNC: SKRIPT_KENNUNG in install.mjs.
 */
export const SKRIPT_KENNUNG = "# claude-workflow-kit script";

/**
 * Die Ausgabe dieser Kopie (Issue #1867, Plan #1866 E1). Das Werkzeug, das den Stand ohne
 * Pro-Teile bereitstellt (#1814), setzt sie auf "community"; Installation und Update schreiben
 * diese Datei jedes Mal neu. Ob eine Installation Community ist, entscheidet allein diese
 * Angabe, nicht das Vorhandensein von Pro-Teilen.
 */
export const KIT_AUSGABE = "community";

const ZEITLIMIT_MS = 10_000;

/** Antworten, deren `location` der Abruf selbst folgt, und wie oft hoechstens. */
const UMLEITUNG = new Set([301, 302, 303, 307, 308]);
const UMLEITUNGEN_HOECHSTENS = 5;

/** Die Antworten, mit denen GitHub einen fehlenden oder unzureichenden Zugang meldet (E7). */
const VERWEIGERT = new Set([401, 403, 404]);

/** Liest eine Datei oder liefert null. */
function lies(pfad, liesDatei) {
  try {
    return liesDatei(pfad);
  } catch {
    return null;
  }
}

const liesUtf8 = (pfad) => readFileSync(pfad, "utf-8");

/** Ein Umgebungswert ohne Ruecksicht auf Gross- und Kleinschreibung des Namens (Windows). */
function umgebung(env, name) {
  let wert;
  for (const [schluessel, w] of Object.entries(env || {})) {
    if (schluessel.toUpperCase() === name) wert = w;
  }
  return wert;
}

/**
 * Vergleicht zwei Versionen `a.b.c`: negativ, wenn `a` aelter ist, 0 bei Gleichheit.
 *
 * SYNC: vergleicheVersion in kit/settings.mjs. Die Datei wird nicht installiert, darum steht
 * der Vergleich hier ein zweites Mal.
 */
export function vergleicheVersion(a, b) {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}

/** Der Anfang der Antwort, hoechstens LESEGRENZE Bytes; den Rest bricht der Leser ab. */
async function anfangLesen(antwort) {
  if (!antwort.body) return "";
  const leser = antwort.body.getReader();
  const teile = [];
  let laenge = 0;
  try {
    while (laenge < LESEGRENZE) {
      const { done, value } = await leser.read();  // eslint-disable-line no-await-in-loop -- NOSONAR S9382: ein Strom liefert seine Teile nacheinander
      if (done) break;
      teile.push(value);
      laenge += value.length;
    }
  } finally {
    await leser.cancel().catch(() => {});
  }
  return Buffer.concat(teile).subarray(0, LESEGRENZE).toString("utf-8");
}

/**
 * Die Host-Regel (Plan #1918 E7): Der `Authorization`-Header geht nur an `https://api.github.com`
 * mit einem Pfad unter `/repos/<PRO_REPO>/`, an keinen anderen Host.
 */
function darfZugangTragen(adresse) {
  let ziel;
  try {
    ziel = new URL(adresse);
  } catch {
    return false;
  }
  return ziel.protocol === "https:" && ziel.host === "api.github.com" && ziel.pathname.startsWith(`/repos/${PRO_REPO}/`);
}

const istZugang = (name) => name.toLowerCase() === "authorization";

/** Die Kopfzeilen fuer einen Abruf von `adresse`: ohne `Authorization`, wo die Host-Regel ihn verbietet. */
function kopfFuer(adresse, headers, zugang) {
  return zugang && darfZugangTragen(adresse) ? { ...headers } : Object.fromEntries(Object.entries(headers).filter(([name]) => !istZugang(name)));
}

/**
 * Die zuletzt veroeffentlichte Fassung einer Ausgabe, gelesen an `const VERSION = "x.y.z";` am
 * Kopf ihres Installers (E2). `KIT_DOCTOR_INSTALL_URL` lenkt den Abruf um (Plan #1767 E23).
 * `headers` gehen mit dem Abruf, `Authorization` nur nach der Host-Regel (Plan #1918 E7).
 * Wirft nie; das Ergebnis ist eines von
 * `{ zustand: "ok", url, version }`, `{ zustand: "ohneVersion", url }`,
 * `{ zustand: "netzfehler", url, grund }`, `{ zustand: "zeitlimit", url, grund }` und fuer Pro
 * `{ zustand: "nichtPruefbar", url, ursache: "ohneZugang"|"verweigert", grund? }`.
 */
export async function veroeffentlichteFassung({ ausgabe = "community", fetch = globalThis.fetch, env = process.env, zeitlimitMs = ZEITLIMIT_MS, headers = {} } = {}) {
  const fassung = await abrufen({ ausgabe, fetch, env, zeitlimitMs, headers, lesen: anfangLesen });
  delete fassung.inhalt;
  return fassung;
}

/** Folgt Umleitungen selbst, damit der `Authorization`-Header je Adresse neu entschieden wird. */
async function folgen(fetch, start, { signal, headers, zugang }) {
  let adresse = start;
  for (let schritt = 0; ; schritt++) {
    const antwort = await fetch(adresse, { signal, redirect: "manual", headers: kopfFuer(adresse, headers, zugang) });  // eslint-disable-line no-await-in-loop -- NOSONAR S9382: jede Umleitung braucht die Adresse der vorigen
    const ziel = UMLEITUNG.has(antwort.status) ? antwort.headers.get("location") : null;
    if (!ziel || schritt >= UMLEITUNGEN_HOECHSTENS) return antwort;
    await antwort.body?.cancel().catch(() => {});  // eslint-disable-line no-await-in-loop -- NOSONAR S9382: jede Umleitung braucht die Adresse der vorigen
    adresse = new URL(ziel, adresse).href;
  }
}

/**
 * Holt den Installer der Ausgabe und liest seine Version; `lesen` bestimmt, wie viel der Antwort
 * gelesen wird. Pro ohne `Authorization` (und ohne Umlenkung) fragt gar nicht erst. Wirft nie.
 */
async function abrufen({ ausgabe, fetch, env, zeitlimitMs, lesen, headers = {} }) {
  const umgelenkt = umgebung(env, "KIT_DOCTOR_INSTALL_URL");
  const url = umgelenkt || AUSGABEN[ausgabe];
  const zugang = !umgelenkt && Object.keys(headers).some(istZugang);
  const pro = ausgabe === "pro" && !umgelenkt;
  if (pro && !zugang) return { zustand: "nichtPruefbar", url, ursache: "ohneZugang" };
  try {
    const antwort = await folgen(fetch, url, { signal: AbortSignal.timeout(zeitlimitMs), headers, zugang });
    if (!antwort.ok) {
      await antwort.body?.cancel().catch(() => {});
      const grund = `HTTP ${antwort.status}`;
      return pro && VERWEIGERT.has(antwort.status) ? { zustand: "nichtPruefbar", url, ursache: "verweigert", grund } : { zustand: "netzfehler", url, grund };
    }
    const inhalt = await lesen(antwort);
    const version = /const VERSION = "(\d+\.\d+\.\d+)";/.exec(inhalt)?.[1];
    return version ? { zustand: "ok", url, version, inhalt } : { zustand: "ohneVersion", url };
  } catch (e) {
    const grund = e?.cause?.message ?? e?.message ?? String(e);
    return { zustand: e?.name === "TimeoutError" ? "zeitlimit" : "netzfehler", url, grund };
  }
}

/**
 * Der ganze veroeffentlichte Installer fuer `update run` (Issue #1850, E5), ohne Lesegrenze.
 * Wirft nie; das Ergebnis ist `{ zustand: "ok", url, version, inhalt }` oder einer der
 * Zustaende von `veroeffentlichteFassung`.
 */
export function veroeffentlichterInstaller({ ausgabe = "community", fetch = globalThis.fetch, env = process.env, zeitlimitMs = 60_000, headers = {} } = {}) {
  return abrufen({ ausgabe, fetch, env, zeitlimitMs, headers, lesen: (antwort) => antwort.text() });
}

/**
 * Holt `adresse` aus `PRO_REPO` ganz, mit `headers`; `Authorization` nur nach der Host-Regel, auch
 * nach einer Umleitung (Plan #1918 E7). Wirft nie; das Ergebnis ist `{ zustand: "ok", url, inhalt }`,
 * `{ zustand: "nichtPruefbar", url, ursache: "ohneZugang"|"verweigert", grund? }`,
 * `{ zustand: "netzfehler", url, grund }` oder `{ zustand: "zeitlimit", url, grund }`.
 */
export async function proInhalt({ adresse, fetch = globalThis.fetch, zeitlimitMs = ZEITLIMIT_MS, headers = {} }) {
  const zugang = Object.keys(headers).some(istZugang);
  if (!zugang) return { zustand: "nichtPruefbar", url: adresse, ursache: "ohneZugang" };
  try {
    const antwort = await folgen(fetch, adresse, { signal: AbortSignal.timeout(zeitlimitMs), headers, zugang });
    if (!antwort.ok) {
      await antwort.body?.cancel().catch(() => {});
      const grund = `HTTP ${antwort.status}`;
      return VERWEIGERT.has(antwort.status) ? { zustand: "nichtPruefbar", url: adresse, ursache: "verweigert", grund } : { zustand: "netzfehler", url: adresse, grund };
    }
    return { zustand: "ok", url: adresse, inhalt: await antwort.text() };
  } catch (e) {
    const grund = e?.cause?.message ?? e?.message ?? String(e);
    return { zustand: e?.name === "TimeoutError" ? "zeitlimit" : "netzfehler", url: adresse, grund };
  }
}

/** Ein gescheiterter Abruf als Antwort von `veroeffentlichteAppFassung`. */
function appFehlschlag(abruf) {
  if (abruf.zustand === "nichtPruefbar") return { ok: false, grund: "nicht-pruefbar", ursache: abruf.ursache, ...(abruf.grund ? { fehler: abruf.grund } : {}) };
  return { ok: false, grund: abruf.zustand === "zeitlimit" ? "zeitlimit" : "netzfehler", ...(abruf.grund ? { fehler: abruf.grund } : {}) };
}

/** JSON aus `text` oder undefined. */
function json(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Die veroeffentlichte Fassung der Desktop-App (Issue #1903, #1928, Plan #1918 E16), gelesen aus
 * dem Asset `app.json` des juengsten Releases von `PRO_REPO`: `{ version, pakete: { darwin, win32, linux } }`.
 * Zwei Abrufe ueber `abruf({ adresse, accept })`, das Ergebnis in der Form von `proInhalt`: erst die
 * Release-Beschreibung als JSON, daraus die Adresse des Assets, dann das Asset. Ohne `abruf` gibt
 * es keinen Zugang und keinen Netzabruf.
 * Wirft nie; das Ergebnis ist `{ ok: true, version, url }` mit der Paketadresse fuer `plattform`
 * oder `{ ok: false, grund }` mit `grund` nicht-pruefbar (ohne Zugang, verweigert oder, mit
 * `ursache` "imBau", ohne Asset `app.json`), netzfehler, zeitlimit, manifest-ungueltig oder paket-fehlt.
 */
export async function veroeffentlichteAppFassung({ plattform = process.platform, abruf } = {}) {
  if (!abruf) return { ok: false, grund: "nicht-pruefbar", ursache: "ohneZugang" };
  const release = await abruf({ adresse: APP_RELEASE, accept: "application/vnd.github+json" });
  if (release.zustand !== "ok") return appFehlschlag(release);
  const asset = json(release.inhalt)?.assets?.find?.((a) => a?.name === "app.json");
  if (typeof asset?.url !== "string") return { ok: false, grund: "nicht-pruefbar", ursache: "imBau" };
  const manifest = asset.url;
  const abgeholt = await abruf({ adresse: manifest, accept: "application/octet-stream" });
  if (abgeholt.zustand !== "ok") return { ...appFehlschlag(abgeholt), manifest };
  const daten = json(abgeholt.inhalt);
  if (!/^\d+\.\d+\.\d+$/.test(String(daten?.version))) return { ok: false, grund: "manifest-ungueltig", manifest };
  const url = daten.pakete?.[plattform];
  if (typeof url !== "string" || url === "") return { ok: false, grund: "paket-fehlt", manifest, plattform };
  return { ok: true, version: daten.version, url };
}

/** `KIT_VERSION` der installierten Kopie unter `<wurzel>/.claude/kit/board.mjs` oder null. */
export function installierteVersion(wurzel, liesDatei = liesUtf8) {
  const inhalt = lies(join(wurzel, ".claude", "kit", "board.mjs"), liesDatei);
  return /const KIT_VERSION = "(\d+\.\d+\.\d+)";/.exec(inhalt ?? "")?.[1] ?? null;
}

/**
 * `KIT_AUSGABE` der installierten Kopie unter `<wurzel>/.claude/kit/board/fassung.mjs`. Fehlt die
 * Datei oder die Konstante (Kopie aelter als Plan #1866), gilt `pro`.
 *
 * SYNC: ausgabe in kit/board/ausgabe.mjs.
 */
export function installierteAusgabe(wurzel, liesDatei = liesUtf8) {
  const inhalt = lies(join(wurzel, ".claude", "kit", "board", "fassung.mjs"), liesDatei);
  return /^export const KIT_AUSGABE = "community";$/m.test(inhalt ?? "") ? "community" : "pro";
}

/**
 * Die Ausgabe, die ein Update fuer das Projekt unter `wurzel` holt (Plan #1918 E8): die installierte,
 * ausser die Kopie ist aelter als `ERSTE_GETRENNTE_FASSUNG` oder nicht lesbar — dann Community.
 */
export function ausgabeFuerUpdate(wurzel, liesDatei = liesUtf8) {
  const version = installierteVersion(wurzel, liesDatei);
  if (!version || vergleicheVersion(version, ERSTE_GETRENNTE_FASSUNG) < 0) return "community";
  return installierteAusgabe(wurzel, liesDatei);
}

/** Das Kit-Repository traegt `kit/board.mjs` und `tools/sync-blobs.mjs` in der Wurzel (E4). */
export const istKitRepo = (wurzel, liesDatei = liesUtf8) =>
  ["kit/board.mjs", "tools/sync-blobs.mjs"].every((d) => lies(join(wurzel, d), liesDatei) !== null);
