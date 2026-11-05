// SPDX-License-Identifier: MIT
/**
 * board/sicherheit.mjs — Auswertung der Sicherheitspruefung vor dem Push (Issue #1992, Plan
 * #1988 E6, E7): `issue-review security-result --file <antwort> --base <anker> [--cards]`.
 *
 * Ob ein Push anhaelt, haengt nicht vom Lesen eines Modells ab (E6): Das Kit liest die
 * Fundbloecke der Antwort selbst, in der Form der Rolle `sicherheit` (kit/rollen/sicherheit.md,
 * Issue #1990). Ein Fund KRITISCH oder WICHTIG ohne Angreifer, Grenze oder Folge wird hier
 * HINWEIS mit der Gegenprobe „nicht geprueft" — Kriterium 2 von #1978 haengt so nicht davon
 * ab, dass der Pruefer seine eigene Regel einhaelt.
 *
 * Daneben `issue-review review-result --file <antwort>` (Issue #2055, Plan #2038 E3): das
 * nachgeholte Review nach einem Hotfix, die Antwort der Rolle `code-review`. Die Zerlegung der
 * Fundbloecke teilt es mit der Sicherheitspruefung; ein Fund KRITISCH haelt an.
 *
 * Mit `--cards` entsteht je Befund KRITISCH oder WICHTIG eine `[Task]`-Karte im Backlog (E7).
 * Derselbe Befund ist derselbe Titel `Sicherheit: <Angriffsklasse> in <Datei>`; Befunde
 * derselben Klasse in derselben Datei sind ein Befund, die Karte sammelt ihre Fundstellen.
 * Liegt die Karte noch offen, bekommt sie einen Kommentar statt einer zweiten. Keine Karte
 * geht nach Ready, und gebucht wird nichts (E10): Die Karte ist die Spur.
 *
 * Das Board erreicht dieses Modul allein ueber die Kommandozeile von board.mjs
 * (`issue list | check-form | create | comment`) — dieselben Gates wie fuer jede Karte, und
 * ein Test setzt die Board-Attrappe ein. Community: `push main` ruft es (E9).
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { BoardError } from "./grundlagen.mjs";
import { markerName, projektSprache, text, ueberschriftName } from "./namen.mjs";
import { kartenGruppen as kartenGruppenAusGit } from "../checks.mjs";

// Die Texte an den Menschen liegen unter kit/texte/board-sicherheit.mjs.
import { TEXTE } from "../texte/board-sicherheit.mjs";

export { TEXTE };

const t = (schluessel, werte) => text(TEXTE, schluessel, werte);

const BOARD = join(dirname(fileURLToPath(import.meta.url)), "..", "board.mjs");

/** Die Spalten, in denen eine Karte als offen gilt; eine Karte in Done ist erledigt. */
const OFFEN = new Set(["backlog", "ready", "in_progress", "in_review"]);

/** Die Pflichtangaben eines Befunds KRITISCH oder WICHTIG (Kriterium 2 von #1978). */
const BELEG = ["angreifer", "grenze", "folge"];

// Die Fundblock-Zeilen der Rolle `sicherheit`. SYNC: kit/rollen/sicherheit.md
const FELDER = Object.freeze({
  Angreifer: "angreifer",
  Grenze: "grenze",
  Folge: "folge",
  Angriffsklasse: "angriffsklasse",
  Fundstelle: "fundstelleRoh",
  Gegenprobe: "gegenprobe",
  Art: "art",
});

// Die fette Kopfzeile eines Fundblocks, auch als Listenpunkt oder Ueberschrift: erst die
// Einleitung abtrennen, dann den Schweregrad lesen — in einem Ausdruck waere er zu verschachtelt.
const EINLEITUNG = /^\s*(?:[-*]\s+)?(?:#{1,6}\s+)?/;
const KOPF = /^\*\*\s*\[?(KRITISCH|WICHTIG|HINWEIS)\]?(.*)$/;
/** Die Zeile `<Feld>: <Wert>` eines Fundblocks, fuer die Felder einer Rolle. */
const feldMuster = (felder) => new RegExp(String.raw`^\s*(?:[-*]\s+)?(${Object.keys(felder).join("|")})\s*:\s*(.*?)\s*$`);
const FELD = feldMuster(FELDER);

// Die Fundblock-Zeilen der Rolle `code-review`. SYNC: kit/rollen/code-review.md
const REVIEW_FELDER = Object.freeze({ Gegenprobe: "gegenprobe", Art: "art" });
const REVIEW_FELD = feldMuster(REVIEW_FELDER);
// Ein Abschnitt der Antwort beendet den Block davor.
const ABSCHNITT = /^\s{0,3}#{1,6}\s/;
// `<datei>[:<zeile>]` am Anfang der Fundstelle, auch in Backticks.
const FUNDSTELLE = /^`?([^`,\s]+?)(:\d+(?:-\d+)?)?`?(?=[,\s]|$)/;
// Dieselbe Fundstelle als Markdown-Link `[<datei>[:<zeile>]](<ziel>)`, wie Codex sie schreibt;
// ein Satzpunkt danach entfaellt. Den Pfad liefert das Ziel, sofern es in einer Wurzel liegt —
// der Text nennt oft nur den Dateinamen, und den erkennt I7 nicht als Pfad (Issue #2213).
const FUNDSTELLE_LINK = /^\[`?([^`\]\s]+?)(:\d+(?:-\d+)?)?`?\]\(([^)]*)\)(?=[.,\s]|$)/;
// Die Zeilenangabe am Ende eines Linkziels: `:58`, `:58:3`, `:58-60`, `#L58` oder `#L58-L60`.
const ZIEL_ZEILE = /(?::\d+(?:[:-]\d+)?|#L[\dL-]+)$/;
// Der Puffer fuer die Antwort von board.mjs: `issue list` eines grossen Boards uebersteigt die
// Vorgabe von 1 MiB, und spawnSync bricht dann mit ENOBUFS ab (Issue #2086).
const BOARD_PUFFER = 64 * 1024 * 1024;

/** Die Kopfzeile ohne Schweregrad und ohne die schliessenden Sterne. */
function titelAus(rest) {
  return rest.replaceAll("**", "").replace(/^[\s:—-]+/, "").trim();
}

/**
 * Der Pfad eines absoluten Linkziels relativ zur ersten Wurzel, in der es liegt, ohne seine
 * Zeilenangabe; `null` fuer ein relatives Ziel oder eines ausserhalb jeder Wurzel.
 */
function pfadAusZiel(ziel, wurzeln) {
  const pfad = ziel.trim().replaceAll(/^<|>$/g, "").replace(/^file:\/\//, "").replace(ZIEL_ZEILE, "");
  if (!isAbsolute(pfad)) return null;
  for (const wurzel of wurzeln) {
    const rel = relative(wurzel, pfad);
    if (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) return rel.split(sep).join("/");
  }
  return null;
}

/** Ein gelesener Block als Befund: Felder, Fundstelle, und die Herabstufung ohne Beleg. */
function befundAus(block, wurzeln) {
  const befund = { ...blockBefund(block, FELDER, FELD), herabgestuft: false };
  const roh = befund.fundstelleRoh ?? "";
  const link = FUNDSTELLE_LINK.exec(roh);
  const stelle = link ?? FUNDSTELLE.exec(roh);
  const datei = (link && pfadAusZiel(link[3], wurzeln)) ?? stelle?.[1];
  befund.datei = stelle ? datei : null;
  befund.fundstelle = stelle ? `${datei}${stelle[2] ?? ""}` : null;
  befund.angriffsklasse = befund.angriffsklasse?.replaceAll("`", "").trim() || null;
  const unbelegt = BELEG.some((feld) => !befund[feld]);
  if (befund.schweregrad !== "HINWEIS" && unbelegt) {
    befund.urspruenglich = befund.schweregrad;
    befund.schweregrad = "HINWEIS";
    befund.herabgestuft = true;
    befund.gegenprobe = t("nichtGeprueft");
  }
  return befund;
}

/** Schweregrad, Titel, Wortlaut und die Felder eines Blocks — beiden Rollen gemeinsam. */
function blockBefund(block, felder, feld) {
  const befund = { schweregrad: block.schweregrad, titel: block.titel, wortlaut: block.zeilen.join("\n").trim() };
  for (const zeile of block.zeilen) {
    const m = feld.exec(zeile);
    if (m && befund[felder[m[1]]] === undefined) befund[felder[m[1]]] = m[2];
  }
  return befund;
}

/** Die Fundbloecke einer Antwort, in ihrer Reihenfolge. */
function bloeckeLesen(antwort) {
  const bloecke = [];
  let offen = null;
  for (const zeile of antwort.split(/\r?\n/)) {
    const kopf = KOPF.exec(zeile.replace(EINLEITUNG, ""));
    if (kopf) {
      offen = { schweregrad: kopf[1], titel: titelAus(kopf[2]), zeilen: [zeile] };
      bloecke.push(offen);
    } else if (ABSCHNITT.test(zeile)) {
      offen = null;
    } else if (offen) {
      offen.zeilen.push(zeile);
    }
  }
  return bloecke;
}

/**
 * Urteil und Befunde einer Prueferantwort: `kritisch`, wenn ein Fund KRITISCH bleibt;
 * `ausfall` bei leerer Antwort; sonst `gruen`, auch mit Funden WICHTIG und HINWEIS.
 * Eine Antwort ohne Fundblock ist "nichts gefunden" — die Rolle verlangt, das hinzuschreiben.
 * `wurzeln` sind die Verzeichnisse, gegen die ein absolutes Linkziel relativ wird (Issue #2213).
 */
export function sicherheitAuswerten(antwort, { wurzeln = [] } = {}) {
  if (typeof antwort !== "string" || antwort.trim() === "") {
    return { ergebnis: "ausfall", grund: t("antwortLeer"), befunde: [] };
  }
  const befunde = bloeckeLesen(antwort).map((block) => befundAus(block, wurzeln));
  const ergebnis = befunde.some((b) => b.schweregrad === "KRITISCH") ? "kritisch" : "gruen";
  return { ergebnis, befunde };
}

/**
 * Urteil und Befunde einer Antwort der Rolle `code-review` (Issue #2055, Plan #2038 E3): das
 * nachgeholte Review nach einem Hotfix. `kritisch`, wenn ein Fund KRITISCH ist; `ausfall` bei
 * leerer Antwort; sonst `ok` mit allen Befunden. Die Rolle kennt weder Angreifer noch Grenze
 * noch Folge, darum stuft hier nichts herab.
 */
export function reviewAuswerten(antwort) {
  if (typeof antwort !== "string" || antwort.trim() === "") {
    return { ergebnis: "ausfall", grund: t("reviewAntwortLeer"), befunde: [] };
  }
  const befunde = bloeckeLesen(antwort).map((block) => blockBefund(block, REVIEW_FELDER, REVIEW_FELD));
  const ergebnis = befunde.some((b) => b.schweregrad === "KRITISCH") ? "kritisch" : "ok";
  return { ergebnis, befunde };
}

/** Der Kartentitel eines Befunds ohne Praefix — zugleich seine Kennung (E7). */
export function befundTitel(befund) {
  return `Sicherheit: ${befund.angriffsklasse ?? "?"} in ${befund.datei ?? "?"}`;
}

/** Befunde KRITISCH und WICHTIG, je Titel eine Gruppe, in der Reihenfolge der Antwort. */
function befundGruppen(befunde) {
  const gruppen = new Map();
  for (const befund of befunde) {
    if (befund.schweregrad === "HINWEIS") continue;
    const titel = befundTitel(befund);
    if (!gruppen.has(titel)) gruppen.set(titel, { titel, befunde: [] });
    gruppen.get(titel).befunde.push(befund);
  }
  return [...gruppen.values()];
}

/** Ob `night.stufen` aktiv ist: eine Stufe mit Modell oder Kommando. SYNC: stufenEinstellung in kit/night/session.mjs */
function stufenAktiv(config) {
  const roh = config?.night?.stufen;
  if (!roh || typeof roh !== "object") return false;
  const belegt = (wert) => typeof wert === "string" && wert.trim() !== "";
  return ["leicht", "mittel", "schwer"].some((stufe) => belegt(roh[stufe]?.modell) || belegt(roh[stufe]?.kommando));
}

/** `Autor-Modell:` aus `reviewModel`, sonst die Kommandozeile aus `reviewCommand` (E7). */
function autorModell(config, env) {
  return [config?.reviewModel, config?.reviewCommand, env.KIT_AGENT_MODEL]
    .find((wert) => typeof wert === "string" && wert.trim() !== "")?.trim() ?? "unbekannt";
}

/**
 * Die Zeilen nach `Autor-Modell:` im Kontext: Sitzungsumfang, dazu bei aktivem `night.tiers`
 * die Aufgabenstufe `schwer` mit Grund, sonst `Empfohlenes Modell:` nach der Regel aus
 * `/issues` — der erste Eintrag von `night.models` fuer Sicherheitslogik, ohne Liste keine Zeile.
 */
function steuerZeilen(config, sprache) {
  const zeilen = [`${markerName("sitzungsumfang", sprache)} ${t("sitzungsumfang")}`];
  if (stufenAktiv(config)) {
    zeilen.push(`${markerName("aufgabenstufe", sprache)} schwer`, `Stufengrund: ${t("stufengrund")}`);
    return zeilen;
  }
  const modelle = config?.night?.modelle;
  const erstes = Array.isArray(modelle) ? modelle.find((m) => typeof m === "string" && m.trim() !== "") : undefined;
  if (erstes) zeilen.push(`${markerName("empfohlenesModell", sprache)} ${erstes.trim()}`);
  return zeilen;
}

/** `Verursacher:` — die Karten, deren Commits seit dem Anker die Datei beruehrt haben. */
function verursacherZeile(datei, basis, ermittelt) {
  if (ermittelt.fehler !== undefined) return `Verursacher: ${t("verursacherUnbekannt", { fehler: ermittelt.fehler })}`;
  const karten = [...new Set(ermittelt.gruppen
    .filter((g) => g.karte !== null && g.dateien.has(datei))
    .map((g) => g.karte))];
  if (karten.length === 0) return `Verursacher: ${t("verursacherKeine", { basis })}`;
  const liste = karten.map((k) => "Issue #" + k).join(", ");
  return `Verursacher: ${liste}`;
}

/** Der Body der Karte in den vier Abschnitten eines Arbeitspakets. */
function kartenBody(gruppe, { verursacher, config, env, sprache }) {
  const h = (sache) => `## ${ueberschriftName(sache, sprache)}`;
  const stellen = gruppe.befunde.map((b) => `- \`${b.fundstelle ?? b.datei ?? "?"}\` — ${b.titel}`);
  const kriterien = gruppe.befunde.map((b) => `- ${t("akzeptanz", { angreifer: b.angreifer, grenze: b.grenze, folge: b.folge })}`);
  return [
    h("kontext"),
    t("kontextEinleitung"),
    "",
    ...gruppe.befunde.flatMap((b) => [b.wortlaut, ""]),
    verursacher,
    // Ein Fund KRITISCH haelt das Veroeffentlichen an und zaehlt darum als Reparatur (Issue #2093, A6).
    ...(gruppe.befunde.some((b) => b.schweregrad === "KRITISCH") ? [`${markerName("reparatur", sprache)} sicherheit`] : []),
    `${markerName("autorModell", sprache)} ${autorModell(config, env)}`,
    ...steuerZeilen(config, sprache),
    "",
    h("aufgabe"),
    t("aufgabeTest"),
    t("aufgabeEinleitung"),
    ...stellen,
    "",
    h("akzeptanzkriterium"),
    ...kriterien,
    "",
    h("abhaengigkeiten"),
    "Keine.",
    "",
  ].join("\n");
}

/** Der Kommentar an die offene Karte desselben Befunds. */
function kommentarText(gruppe, basis, verursacher) {
  return [
    t("kommentarKopf"),
    "",
    t("kommentarEinleitung", { basis }),
    "",
    ...gruppe.befunde.flatMap((b) => [b.wortlaut, ""]),
    verursacher,
  ].join("\n");
}

/** Ein Titel ohne Praefix der Art (`[Task] …`), zum Vergleich mit der Kennung. */
const ohnePraefix = (titel) => String(titel ?? "").replace(/^\[[^\]]+\]\s*/, "");

/**
 * Legt je Befund KRITISCH oder WICHTIG eine Karte an oder kommentiert die offene Karte mit
 * demselben Titel. Liefert je Gruppe `{ aktion: "angelegt" | "kommentiert", id, titel }`.
 * Eine Karte, die `issue check-form` nicht besteht oder am Board scheitert, wird nicht
 * angelegt und steht als `{ aktion: "nicht angelegt", titel, grund }` da; die naechste Gruppe
 * laeuft weiter (Issue #2213). Scheitert schon das Lesen des Boards, wirft der Aufruf.
 */
export function sicherheitKarten(befunde, {
  basis,
  board = boardAufruf,
  kartenGruppen = kartenGruppenAusGit,
  config = {},
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const gruppen = befundGruppen(befunde);
  if (gruppen.length === 0) return [];
  const sprache = projektSprache(config);
  const ermittelt = kartenGruppen(basis, { cwd });
  const offen = board("issue", "list").filter((k) => OFFEN.has(k.status));
  const ergebnis = [];
  const dir = mkdtempSync(join(tmpdir(), "sicherheit-karte-"));
  try {
    for (const gruppe of gruppen) {
      const datei = join(dir, `karte-${ergebnis.length + 1}.md`);
      try {
        ergebnis.push(gruppeBuchen(gruppe, { basis, board, ermittelt, offen, config, env, sprache, datei }));
      } catch (err) {
        if (!(err instanceof BoardError)) throw err;
        ergebnis.push({ aktion: "nicht angelegt", titel: gruppe.titel, grund: err.message });
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return ergebnis;
}

/** Eine Gruppe am Board: Kommentar an die offene Karte oder eine neue Karte nach check-form. */
function gruppeBuchen(gruppe, { basis, board, ermittelt, offen, config, env, sprache, datei }) {
  const verursacher = verursacherZeile(gruppe.befunde[0].datei, basis, ermittelt);
  const vorhanden = offen.find((k) => ohnePraefix(k.title) === gruppe.titel);
  if (vorhanden) {
    board("issue", "comment", String(vorhanden.id), "--text", kommentarText(gruppe, basis, verursacher));
    return { aktion: "kommentiert", id: String(vorhanden.id), titel: gruppe.titel };
  }
  writeFileSync(datei, kartenBody(gruppe, { verursacher, config, env, sprache }));
  const form = board("issue", "check-form", "--body-file", datei, "--title", gruppe.titel, "--art", "task");
  if (!form?.ok) {
    const verstoesse = (form?.verstoesse ?? []).map((v) => (typeof v === "string" ? v : `${v.gate ?? ""} ${v.meldung ?? v.text ?? ""}`.trim())).join("; ");
    throw new BoardError(t("formVerstoss", { titel: gruppe.titel, verstoesse: verstoesse || form?.fehler || "?" }));
  }
  const neu = board("issue", "create", "--title", gruppe.titel, "--art", "task", "--body-file", datei);
  return { aktion: "angelegt", id: String(neu.id), titel: gruppe.titel };
}

/**
 * Die Wurzeln, gegen die ein Linkziel relativ wird: die des Arbeitsbaums unter `cwd` und die
 * der Hauptkopie, falls `cwd` ein Worktree ist — der Pruefer kann in der Hauptkopie laufen,
 * die Auswertung laeuft im Worktree (Issue #2213). Ausserhalb eines Repositories keine.
 */
function repoWurzeln(cwd) {
  const git = (...args) => {
    const res = spawnSync("git", args, { cwd, encoding: "utf-8" });
    return res.status === 0 ? res.stdout.trim() : "";
  };
  const oben = git("rev-parse", "--show-toplevel");
  const gemeinsam = git("rev-parse", "--path-format=absolute", "--git-common-dir");
  return [...new Set([oben, gemeinsam && dirname(gemeinsam)].filter(Boolean))];
}

/**
 * board.mjs als Kindprozess im Arbeitsverzeichnis des Aufrufs, die Antwort als Objekt. Endet
 * er ungleich 0, gilt eine JSON-Antwort mit `ok: false` als Antwort (so meldet `check-form`
 * einen Verstoss), alles andere wirft.
 */
function boardAufruf(...args) {
  const res = spawnSync(process.execPath, [BOARD, ...args], { encoding: "utf-8", cwd: process.cwd(), maxBuffer: BOARD_PUFFER });
  let antwort;
  try {
    antwort = JSON.parse(res.stdout);
  } catch {
    antwort = undefined;
  }
  if (res.status === 0 && antwort !== undefined) return antwort;
  if (antwort?.ok === false) return antwort;
  const grund = (res.stderr || res.stdout || res.error?.message || `exit ${res.status}`).trim();
  throw new BoardError(t("boardGescheitert", { befehl: args.slice(0, 2).join(" "), grund }));
}

/**
 * `issue-review security-result --file <antwort> --base <anker> [--cards]`: Ergebnis und
 * Befunde als Objekt, mit `--cards` dazu `karten` und `nichtAngelegt` (je Karte Titel und
 * Grund). Ein Aufruffehler wirft; eine leere oder unlesbare Antwort ist das Ergebnis
 * `ausfall` und legt keine Karte an. Eine gescheiterte Kartenanlage aendert das Urteil nicht
 * (Issue #2213).
 */
export function securityResult(args, abhaengigkeiten = {}) {
  if (typeof args.file !== "string" || args.file === "") throw new BoardError(t("fileFehlt"));
  const mitKarten = args.cards === true;
  if (mitKarten && (typeof args.base !== "string" || args.base === "")) throw new BoardError(t("baseFehlt"));
  let antwort;
  try {
    antwort = readFileSync(args.file, "utf-8");
  } catch (e) {
    return { ergebnis: "ausfall", grund: t("antwortUnlesbar", { datei: args.file, grund: e.code || e.message }), befunde: [] };
  }
  const wurzeln = abhaengigkeiten.wurzeln ?? repoWurzeln(abhaengigkeiten.cwd ?? process.cwd());
  const auswertung = sicherheitAuswerten(antwort, { wurzeln });
  if (!mitKarten || auswertung.ergebnis === "ausfall") return auswertung;
  let gebucht;
  try {
    gebucht = sicherheitKarten(auswertung.befunde, { basis: args.base, ...abhaengigkeiten });
  } catch (err) {
    if (!(err instanceof BoardError)) throw err;
    gebucht = befundGruppen(auswertung.befunde).map(({ titel }) => ({ aktion: "nicht angelegt", titel, grund: err.message }));
  }
  const nichtAngelegt = gebucht.filter((k) => k.aktion === "nicht angelegt").map(({ titel, grund }) => ({ titel, grund }));
  return { ...auswertung, karten: gebucht.filter((k) => k.aktion !== "nicht angelegt"), nichtAngelegt };
}

/**
 * `issue-review review-result --file <antwort>`: Ergebnis und Befunde des nachgeholten Reviews
 * als Objekt. Ein Aufruffehler wirft; eine leere oder unlesbare Antwort ist `ausfall`.
 */
export function reviewResult(args) {
  if (typeof args.file !== "string" || args.file === "") throw new BoardError(t("reviewFileFehlt"));
  let antwort;
  try {
    antwort = readFileSync(args.file, "utf-8");
  } catch (e) {
    return { ergebnis: "ausfall", grund: t("antwortUnlesbar", { datei: args.file, grund: e.code || e.message }), befunde: [] };
  }
  return reviewAuswerten(antwort);
}
