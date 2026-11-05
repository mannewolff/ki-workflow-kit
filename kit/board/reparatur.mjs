// SPDX-License-Identifier: MIT
/**
 * board/reparatur.mjs — Reparaturkarten aus einem roten Prueflauf (Issue #2092, Plan #2087, A4,
 * A6, A7, A8, E2, E4, E5): `issue repair --summary <datei>`, fuer den Build-Dienst
 * `issue repair --ci <sha>` (Issue #2094, A5).
 *
 * Die eine Stelle, an der alle Laufarten (Integrationslauf des Runners, Build-Dienst,
 * interaktiver Lauf) ihre Reparaturkarten anlegen (A4). Die Eingabe sind die roten Eintraege
 * aus `laufen[]` der Zusammenfassung von checks.mjs mit `fund`, `abdruck`, `art`, `handgriff`
 * und `beschreibung` (Issue #2090, #2091), dazu `verursacher[]`.
 *
 *   - Je Pruefung (`cmd`) und Plan eine Karte (A7): Der Plan eines Verursacher-Pakets kommt aus
 *     seiner Zeile `Plan:`; Pakete ohne Plan, und eine Pruefung ohne Paket, ergeben eine Karte
 *     ohne Plan. Mehrere Funde derselben Pruefung stehen in derselben Karte.
 *   - Ein Eintrag mit `art: "umgebung"` wird keine Karte, sondern ein Handgriff.
 *   - Doppelpruefung (A8): Traegt eine Karte dieselbe Zeile `Reparatur: <cmd>` und denselben
 *     Plan, bekommt sie in Backlog, Ready und In progress einen Kommentar mit dem neuen Fund, in
 *     In review dazu den Zug zurueck nach Backlog (neues GO); erst eine Karte in Done oder keine
 *     ergibt eine neue.
 *   - Aus dem Build-Dienst (A5): Die roten Eintraege liest `getFunde(id, adresse)` des Hosts aus
 *     dem Protokoll jedes roten Laufs, den `getCiStatus(sha)` nennt; ein roter Job ohne jede
 *     Kit-Zeile ist ein Fund an der Umgebung. Die Karten legt an, wer das Urteil liest, nicht
 *     der Build-Job: Ein Board-Zugang dort waere ein Geheimnis an einem fremden Ort.
 *
 * Das Board erreicht dieses Modul allein ueber die Kommandozeile von board.mjs (`issue list |
 * get | create | comment | move`) — dieselben Gates wie fuer jede Karte, und ein Test setzt
 * eine eigene Board-Funktion ein. Die Antwort darf ein Promise sein.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BoardError } from "./grundlagen.mjs";
import { markerName, markerWerte, prozessSprache, text, ueberschriftName } from "./namen.mjs";

// Die Texte an den Menschen liegen unter kit/texte/board-reparatur.mjs.
import { TEXTE } from "../texte/board-reparatur.mjs";

export { TEXTE };

const t = (schluessel, werte) => text(TEXTE, schluessel, werte);

const BOARD = join(dirname(fileURLToPath(import.meta.url)), "..", "board.mjs");

// Der Puffer fuer die Antwort von board.mjs: `issue list` eines grossen Boards uebersteigt die
// Vorgabe von 1 MiB, und spawnSync bricht dann mit ENOBUFS ab (Issue #2086).
const BOARD_PUFFER = 64 * 1024 * 1024;

/** Die Spalten, in denen eine vorhandene Karte nur einen Kommentar bekommt (A8). */
const OFFEN = new Set(["backlog", "ready", "in_progress"]);

/**
 * board.mjs als Kindprozess im Arbeitsverzeichnis `cwd` mit der Umgebung `env`, die Antwort als
 * Objekt; ein Fehler wirft.
 */
export function boardAufruf(cwd, env = process.env) {
  return (...args) => {
    const res = spawnSync(process.execPath, [BOARD, ...args], { encoding: "utf-8", cwd, env, maxBuffer: BOARD_PUFFER });
    if (res.status === 0) {
      try {
        return JSON.parse(res.stdout);
      } catch {
        // faellt in den Fehler darunter
      }
    }
    const grund = (res.stderr || res.stdout || res.error?.message || `exit ${res.status}`).trim();
    throw new BoardError(t("boardGescheitert", { befehl: args.slice(0, 2).join(" "), grund }));
  };
}

/** Die Plannummer aus der ganzen Zeile `Plan: Issue #N` eines Bodys, sonst `null`. */
function planAus(body) {
  for (const rest of markerWerte(body, "plan")) {
    const nummer = /^[^\S\n]*Issue[^\S\n]*#(\d+)[^\S\n]*$/.exec(rest)?.[1];
    if (nummer) return nummer;
  }
  return null;
}

/** Die Pruefung aus der Zeile `Reparatur: <cmd>` eines Bodys, sonst `null`. */
function pruefungAus(body) {
  const wert = markerWerte(body, "reparatur")[0];
  return wert === undefined ? null : wert.trim();
}

/** Ein Codezaun, laenger als jede Folge von Backticks im Text. */
function zaun(inhalt) {
  const laengste = Math.max(2, ...[...String(inhalt).matchAll(/`+/g)].map((m) => m[0].length));
  return "`".repeat(laengste + 1);
}

/** Der Fund im Wortlaut als Codeblock. */
function fundBlock(fund) {
  const z = zaun(fund);
  let inhalt = String(fund);
  while (inhalt.endsWith("\n")) inhalt = inhalt.slice(0, -1);
  return [z, inhalt, z];
}

/** Der Fund eines Eintrags: `fund`, sonst der Abdruck, sonst das Kommando. */
const fundVon = (eintrag) => eintrag.fund || eintrag.abdruck || eintrag.fehler || eintrag.cmd;

/** Die Kartennummern der Verursacher einer Pruefung, ohne Commits ohne Karte. */
function paketeVon(verursacher, cmd) {
  const nummern = verursacher.filter((v) => v?.cmd === cmd)
    .flatMap((v) => (Array.isArray(v.karten) ? v.karten : []).map((k) => k?.karte))
    .filter((k) => k !== null && k !== undefined).map(String);
  return [...new Set(nummern)];
}

/** Die Hinweise der Verursacher einer Pruefung, etwa „keine Karte beruehrt diese Pruefung". */
function hinweiseVon(verursacher, cmd) {
  return [...new Set(verursacher.filter((v) => v?.cmd === cmd && typeof v.hinweis === "string").map((v) => v.hinweis))];
}

/**
 * Die Gruppen der Karten (A7): je Pruefung und Plan eine, mit allen Funden, Paketen und
 * Protokollen der Pruefung. `planVon(id)` liefert den Plan eines Pakets oder `null`.
 */
async function gruppenBilden(rote, verursacher, planVon) {
  const gruppen = new Map();
  const gruppe = (cmd, plan, eintrag) => {
    const schluessel = JSON.stringify([cmd, plan]);
    if (!gruppen.has(schluessel)) {
      gruppen.set(schluessel, { cmd, plan, beschreibung: null, funde: [], pakete: [], protokolle: [], hinweise: hinweiseVon(verursacher, cmd) });
    }
    const g = gruppen.get(schluessel);
    g.beschreibung ??= eintrag.beschreibung || null;
    g.funde.push(fundVon(eintrag));
    if (eintrag.protokoll && !g.protokolle.includes(eintrag.protokoll)) g.protokolle.push(eintrag.protokoll);
    return g;
  };
  for (const eintrag of rote) {
    const pakete = paketeVon(verursacher, eintrag.cmd);
    const nachPlan = new Map();
    for (const id of pakete) {
      const plan = await planVon(id);  // eslint-disable-line no-await-in-loop -- NOSONAR S9382: teilt den Plan-Cache, parallel holte ein geteilter Plan doppelt
      nachPlan.set(plan, [...(nachPlan.get(plan) ?? []), id]);
    }
    if (nachPlan.size === 0) nachPlan.set(null, []);
    for (const [plan, ids] of nachPlan) {
      const g = gruppe(eintrag.cmd, plan, eintrag);
      for (const id of ids) if (!g.pakete.includes(id)) g.pakete.push(id);
    }
  }
  return [...gruppen.values()];
}

/** Die Zeilen, die Karte und Kommentar gemeinsam tragen: Funde, Verursacher, Hinweise, Protokolle. */
function fundZeilen(g) {
  const zeilen = [t("fundKopf"), ""];
  for (const fund of g.funde) zeilen.push(...fundBlock(fund), "");
  zeilen.push(g.pakete.length > 0
    ? t("verursacher", { pakete: g.pakete.map((id) => `Issue #${id}`).join(", ") })
    : t("verursacherKeine"));
  for (const hinweis of g.hinweise) zeilen.push(t("hinweis", { hinweis }));
  for (const pfad of g.protokolle) zeilen.push(t("protokoll", { pfad }));
  return zeilen;
}

/** Der Titel der Karte (A7): die Beschreibung der Pruefung, sonst ihr Kommando. */
function titelVon(g) {
  const was = g.beschreibung || g.cmd;
  return g.plan ? t("titel", { was, plan: g.plan }) : t("titelOhnePlan", { was });
}

/** Der Body der Karte in den vier Abschnitten eines Arbeitspakets. */
function kartenBody(g, sprache) {
  const h = (sache) => `## ${ueberschriftName(sache, sprache)}`;
  return [
    h("kontext"),
    t("kontextEinleitung", { was: g.beschreibung || `\`${g.cmd}\`` }),
    "",
    `${markerName("reparatur", sprache)} ${g.cmd}`,
    ...(g.plan ? [`${markerName("plan", sprache)} Issue #${g.plan}`] : []),
    "",
    ...fundZeilen(g),
    "",
    h("aufgabe"),
    t("aufgabe", { cmd: g.cmd }),
    "",
    h("akzeptanzkriterium"),
    `- ${t("akzeptanz", { cmd: g.cmd })}`,
    "",
    h("abhaengigkeiten"),
    t("keine"),
    "",
  ].join("\n");
}

/** Der Kommentar an die vorhandene Karte derselben Pruefung und desselben Plans. */
function kommentarText(g, zurueck) {
  return [
    t("kommentarKopf"),
    "",
    t("kommentarEinleitung", { cmd: g.cmd }),
    ...(zurueck ? ["", t("kommentarZurueck")] : []),
    "",
    ...fundZeilen(g),
  ].join("\n");
}

/** Das Autor-Modell der Karte: `KIT_AGENT_MODEL`, sonst das uebergebene, sonst `unbekannt`. */
function autorModell(env, vorgabe) {
  return [env.KIT_AGENT_MODEL, vorgabe].find((w) => typeof w === "string" && w.trim() !== "")?.trim() ?? "unbekannt";
}

/**
 * Die Karte am Board, die zu Pruefung und Plan der Gruppe gehoert, und ihre Spalte: zuerst
 * eine nicht erledigte, sonst `null`. Ein Tracker ohne Spalte in der Liste (GitHub liefert nur
 * offene Karten) fragt die Spalte In review eigens ab.
 */
function vorhandeneKarte(karten, g, imReview) {
  const treffer = karten.filter((k) => pruefungAus(k.body) === g.cmd && planAus(k.body) === g.plan);
  for (const k of treffer) {
    const spalte = k.status ?? (imReview().has(String(k.id)) ? "in_review" : "backlog");
    if (spalte !== "done") return { id: String(k.id), spalte };
  }
  return null;
}

/** Die Handgriffe der Funde an der Umgebung, je Pruefung und Handgriff einmal. */
export function handgriffeVon(rot) {
  const handgriffe = [];
  for (const e of rot.filter((x) => x.art === "umgebung")) {
    const handgriff = e.handgriff ?? "";
    if (!handgriffe.some((h) => h.cmd === e.cmd && h.handgriff === handgriff)) handgriffe.push({ cmd: e.cmd, handgriff });
  }
  return handgriffe;
}

/**
 * Die Nummern der Karten in In review, als Funktion fuer `vorhandeneKarte`. Nur ein Tracker,
 * der in der Liste keine Spalte nennt, kostet dafuer einen zweiten Aufruf.
 */
export async function spalteInReview(board, karten) {
  const ohneSpalte = karten.some((k) => k.status === null || k.status === undefined);
  const liste = ohneSpalte ? (await board("issue", "list", "--status", "in_review")) ?? [] : [];
  const ids = new Set(liste.map((k) => String(k.id)));
  return () => ids;
}

/**
 * Legt aus der Zusammenfassung `summe` die Reparaturkarten an oder kommentiert die vorhandenen.
 * Rueckgabe `{ angelegt, kommentiert, zurueck, handgriffe }`; `angelegt` je Karte `{ id, titel,
 * cmd, plan }`, `kommentiert` und `zurueck` je Karte `{ id, cmd, plan }`, `handgriffe` je Fund
 * an der Umgebung `{ cmd, handgriff }`. Ein Fehler des Boards wirft.
 */
export async function reparaturKarten(summe, { board = boardAufruf(process.cwd()), env = process.env, autor = null, sprache = prozessSprache() } = {}) {
  const laufen = Array.isArray(summe?.laufen) ? summe.laufen : [];
  const verursacher = Array.isArray(summe?.verursacher) ? summe.verursacher : [];
  const rot = laufen.filter((e) => e?.ergebnis === "rot" && typeof e.cmd === "string");
  const ergebnis = { angelegt: [], kommentiert: [], zurueck: [], handgriffe: handgriffeVon(rot) };
  const projekt = rot.filter((e) => e.art !== "umgebung");
  if (projekt.length === 0) return ergebnis;

  const plaene = new Map();
  const planVon = async (id) => {
    if (!plaene.has(id)) {
      let plan = null;
      try {
        plan = planAus((await board("issue", "get", id))?.body);
      } catch {
        // Ein Paket, das sich nicht lesen laesst, zaehlt als Paket ohne Plan.
      }
      plaene.set(id, plan);
    }
    return plaene.get(id);
  };
  const gruppen = await gruppenBilden(projekt, verursacher, planVon);
  const karten = (await board("issue", "list")) ?? [];
  const imReview = await spalteInReview(board, karten);
  const modell = autorModell(env, autor);

  for (const g of gruppen) {
    const vorhanden = vorhandeneKarte(karten, g, imReview);
    if (vorhanden && (OFFEN.has(vorhanden.spalte) || vorhanden.spalte === "in_review")) {
      const zurueck = vorhanden.spalte === "in_review";
      await board("issue", "comment", vorhanden.id, "--text", kommentarText(g, zurueck));  // eslint-disable-line no-await-in-loop -- NOSONAR S9382: Kommentar vor dem Zug, Board-Schreibzugriffe in fester Reihenfolge
      ergebnis.kommentiert.push({ id: vorhanden.id, cmd: g.cmd, plan: g.plan });
      if (zurueck) {
        await board("issue", "move", vorhanden.id, "backlog");  // eslint-disable-line no-await-in-loop -- NOSONAR S9382: Kommentar vor dem Zug, Board-Schreibzugriffe in fester Reihenfolge
        ergebnis.zurueck.push({ id: vorhanden.id, cmd: g.cmd, plan: g.plan });
      }
      continue;
    }
    const titel = titelVon(g);
    const body = kartenBody(g, sprache);
    const zusatz = [...(g.plan ? ["--derived-from", g.plan] : []), "--author-model", modell];
    const neu = await board("issue", "create", "--title", titel, "--body", body, "--art", "task", ...zusatz);  // eslint-disable-line no-await-in-loop -- NOSONAR S9382: die naechste Gruppe prueft die eben angelegte Karte als vorhanden
    const id = String(neu.id);
    karten.push({ id, body, status: "backlog" });
    ergebnis.angelegt.push({ id, titel, cmd: g.cmd, plan: g.plan });
  }
  return ergebnis;
}

/**
 * Die Zusammenfassung aus dem Build-Dienst (Issue #2094, A5): `laufen` sind die Eintraege, die
 * `host.getFunde` aus dem Protokoll jedes roten Laufs liest, je Pruefung und Wortlaut einmal;
 * `verursacher` folgt aus ihren Paketen und Hinweisen. Ein roter Job, dessen Protokoll keine
 * Kit-Zeile traegt, wird ein Fund an der Umgebung. Laeuft der Dienst noch, bricht sie ab.
 */
export async function summeAusBuildDienst(sha, host) {
  const ci = await host.getCiStatus(sha);
  if (ci?.status === "laeuft") throw new BoardError(t("ciLaeuft", { sha }));
  const roteJobs = (Array.isArray(ci?.jobs) ? ci.jobs : []).filter((j) => j?.ergebnis === "rot");
  const laufen = [];
  const gelesen = new Map();
  for (const job of roteJobs) {
    if (!gelesen.has(job.id)) gelesen.set(job.id, job.id === null || job.id === undefined ? [] : await host.getFunde(job.id, ci.adresse ?? null));  // eslint-disable-line no-await-in-loop -- NOSONAR S9382: gh und glab lesen das Protokoll synchron, parallel gewinnt nichts
    const funde = gelesen.get(job.id);
    if (funde.length === 0) {
      const handgriff = t("handgriffOhneZeile", { job: job.name, adresse: ci.adresse ?? t("keineAdresse") });
      laufen.push({ cmd: job.name, ergebnis: "rot", fund: handgriff, art: "umgebung", handgriff });
    }
    for (const e of funde) if (!laufen.some((l) => l.cmd === e.cmd && l.fund === e.fund)) laufen.push(e);
  }
  const verursacher = laufen.map((e) => (typeof e.hinweis === "string"
    ? { cmd: e.cmd, hinweis: e.hinweis }
    : { cmd: e.cmd, karten: (e.pakete ?? []).map((karte) => ({ karte, shas: [] })) }));
  return { laufen, verursacher };
}

/** Die Zusammenfassung aus der Datei `--summary`. */
function summeAusDatei(datei) {
  try {
    return JSON.parse(readFileSync(datei, "utf-8"));
  } catch (e) {
    throw new BoardError(t("summaryUnlesbar", { datei, grund: e.code || e.message }));
  }
}

/**
 * `issue repair --summary <datei> | --ci <sha> [--author-model <modell>]`: die Zusammenfassung
 * lesen oder aus dem Build-Dienst holen, Karten anlegen. `--ci` braucht `abhaengigkeiten.host`.
 */
export async function issueRepair(args, abhaengigkeiten = {}) {
  const { host, ...rest } = abhaengigkeiten;
  const summary = typeof args.summary === "string" && args.summary !== "";
  const ci = typeof args.ci === "string" && args.ci !== "";
  if (args.summary !== undefined && args.ci !== undefined) throw new BoardError(t("summaryUndCi"));
  if (!summary && !ci) throw new BoardError(t("summaryFehlt"));
  const summe = ci ? await summeAusBuildDienst(args.ci, host) : summeAusDatei(args.summary);
  const autor = typeof args["author-model"] === "string" ? args["author-model"] : null;
  return reparaturKarten(summe, { autor, ...rest });
}
