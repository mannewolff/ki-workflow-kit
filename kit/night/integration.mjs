// SPDX-License-Identifier: MIT
/**
 * night/integration.mjs — der Integrationslauf des Runners (Issue #1984, Plan #1969, E7, E9, E11).
 *
 * Der Runner faehrt `checks.mjs run --integration` in seinem eigenen Prozess, nicht in einer
 * Sitzung: Die Zeitgrenze der Sitzung gilt fuer ihn nicht, nur seine Obergrenze
 * (`INTEGRATION_OBERGRENZE_MS`). Danach wertet er aus:
 *
 *   - gruen: Das Ergebnis steht in `.claude/integration.json`; das schreibt `checks.mjs`.
 *   - rot: die Reparaturkarten legt kit/board/reparatur.mjs an (Issue #2095, Plan #2087, E5),
 *     je rote Pruefung und Plan eine, und eine vorhandene Karte derselben Pruefung bekommt den
 *     neuen Fund als Kommentar. Die Pakete wandern nicht zurueck. Die Plaene der angelegten und
 *     kommentierten Karten kommen als `gesperrtePlaene` zurueck: Der Lauf setzt kein weiteres
 *     Paket davon um.
 *   - ohne Urteil: `offen` (E9), mit `offenInFolge` in `.claude/integration.json`. Der naechste
 *     Lauf holt ihn vor seinem ersten Paket nach (`nachholenNoetig`); beim zweiten `offen` in
 *     Folge entsteht statt eines dritten Laufs die `[Human]`-Karte.
 *
 * Kette und Ready-Lauf rufen dieselbe Funktion `integrationFahren` (E11): keine Kopie. Endet eine
 * Kette mit dem Ziel `push-vorbereitet`, ist der volle Lauf der Vorbereitung der Integrationslauf
 * (E12, Issue #1985): `integrationAusVorbereitung` traegt sein Urteil ein, ohne einen zweiten zu fahren.
 *
 * Board, Lauf und Dateien erreicht der Teil ueber `integrationAbhaengigkeiten`; die Tests setzen
 * Attrappen ein. `NIGHT_INTEGRATION_CMD` ersetzt den Aufruf von `checks.mjs`, wie
 * `NIGHT_CLAUDE_CMD` die Session — allein fuer die Ablauftests.
 *
 * Bewusst ohne eigene KIT_VERSION (Plan #1199, E19): Die Teile kommen im selben
 * Verzeichnis-Blob wie der Einstieg und werden nie einzeln verteilt.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { CHECKS_PATH, NACHBAR_CHECKS, ZUSTAND, board, boardRoh, log } from "./grundlagen.mjs";
import { erkenneMarker, labelName, markerName, markerWerte, prozessSprache, text } from "../board/namen.mjs";
import { ausgabe } from "../board/ausgabe.mjs";
import { reparaturKarten as kartenAusZusammenfassung, summeAusBuildDienst } from "../board/reparatur.mjs";

// Die Texte an den Menschen liegen unter kit/texte/night-integration.mjs.
import { TEXTE } from "../texte/night-integration.mjs";

export { TEXTE };

const t = (schluessel, werte = {}) => text(TEXTE, schluessel, werte);

// Ergebnisdatei und Obergrenze aus checks.mjs (Issue #1982). Abgefangen wie in wartend.mjs: Fehlt
// checks.mjs, wirft der Lauf erst, wenn er gebraucht wird.
const checks = await import(pathToFileURL(NACHBAR_CHECKS).href).catch(() => null);

/** Die Obergrenze des Integrationslaufs (E9) — die Konstante aus checks.mjs, sonst 20 Minuten. */
export const INTEGRATION_OBERGRENZE_MS = checks?.INTEGRATION_OBERGRENZE_MS ?? 20 * 60_000;

// Dieselbe Umgebungsvariable wie in checks.mjs: Ein Test setzt die Obergrenze fuer beide herab.
const OBERGRENZE_ENV = "KIT_CHECKS_INTEGRATION_OBERGRENZE_MS";

// checks.mjs bricht an der Obergrenze selbst ab und schreibt `offen`. Der Runner wartet eine
// Nachfrist laenger, bevor er den Prozess beendet — sonst nahme er ihm das Schreiben weg.
const NACHFRIST_MS = 60_000;

// Ab dem zweiten `offen` in Folge holt der Runner nicht mehr nach (E9).
const OFFEN_GRENZE = 2;

const ZUSAMMENFASSUNG = join(".claude", "checks-summary.json");
const CONFIG = join(".claude", "workflow.config.json");

// Die Pruefung, unter der ein roter Integrationslauf ohne rote Pruefung in der Zusammenfassung
// seine Karte bekommt: der Lauf selbst.
const INTEGRATION_CMD = "node .claude/kit/checks.mjs run --integration";
const PLAN = erkenneMarker("Plan:");

/** Die wirksame Obergrenze: die Konstante, im Test ueber die Umgebung herabgesetzt. */
export function integrationObergrenzeMs(env = process.env) {
  const wert = Number(env[OBERGRENZE_ENV]);
  return Number.isFinite(wert) && wert > 0 ? wert : INTEGRATION_OBERGRENZE_MS;
}

/** Faehrt `checks.mjs run --integration` und beendet es nach `grenzeMs`. `{ status, abgebrochen }`. */
function laufVorgabe({ root, grenzeMs }) {
  return new Promise((fertig) => {
    const ersatz = process.env.NIGHT_INTEGRATION_CMD;
    if (!ersatz && !checks) throw new Error(t("checksFehlt", { pfad: NACHBAR_CHECKS }));
    const [bin, argv] = ersatz ? ["sh", ["-c", ersatz]] : [process.execPath, [CHECKS_PATH, "run", "--integration"]];
    const kind = spawn(bin, argv, { cwd: root, stdio: "ignore" });
    let abgebrochen = false;
    let fertigGemeldet = false;
    const ende = (status) => {
      if (fertigGemeldet) return;
      fertigGemeldet = true;
      clearTimeout(uhr);
      fertig({ status, abgebrochen });
    };
    const uhr = setTimeout(() => {
      abgebrochen = true;
      kind.kill("SIGTERM");
      setTimeout(() => kind.kill("SIGKILL"), 5_000).unref();
    }, grenzeMs);
    kind.on("error", () => ende(null));
    kind.on("close", (status) => ende(status));
  });
}

/** `.claude/checks-summary.json` als Objekt, `null`, wenn sie fehlt oder kaputt ist. */
function zusammenfassungVorgabe(root) {
  try {
    return JSON.parse(readFileSync(join(root, ZUSAMMENFASSUNG), "utf-8"));
  } catch {
    return null;
  }
}

/** Der Code-Host des Projekts unter `root`, fuer das Protokoll des Build-Diensts (Issue #2095). */
async function hostVorgabe(root) {
  const config = ZUSTAND.config ?? JSON.parse(readFileSync(join(root, CONFIG), "utf-8"));
  return (await import("../board/adapter.mjs")).resolveCodeHost(config);
}

const VORGABEN = Object.freeze({
  lauf: laufVorgabe,
  host: hostVorgabe,
  board,
  boardRoh,
  lesen: (root) => checks?.integrationLesen(root) ?? null,
  schreiben: (daten, root) => checks?.integrationSchreiben(daten, root),
  zusammenfassung: zusammenfassungVorgabe,
  jetzt: () => Date.now(),
  ausgabe: (root) => ausgabe({ wurzel: root }),
});
const abh = { ...VORGABEN };

/** Setzt Abhaengigkeiten ein; ohne Argument gelten wieder alle Vorgaben. Nur fuer Tests. */
export function integrationAbhaengigkeiten(neu) {
  if (neu === undefined) {
    Object.assign(abh, VORGABEN);
    return;
  }
  for (const [name, fn] of Object.entries(neu)) {
    if (!Object.hasOwn(VORGABEN, name)) throw new Error(`integrationAbhaengigkeiten kennt keine Abhaengigkeit '${name}'`);
    abh[name] = fn;
  }
}

/** Die Plannummer aus der ganzen Zeile `Plan: Issue #N` eines Bodys, sonst `null`. */
export function planVon(body) {
  for (const rest of markerWerte(String(body ?? ""), PLAN)) {
    const nummer = /^[^\S\n]*Issue[^\S\n]*#(\d+)[^\S\n]*$/.exec(rest)?.[1];
    if (nummer) return nummer;
  }
  return null;
}

/** Wie oft der letzte Integrationslauf in Folge `offen` war; 0, wenn er es nicht war. */
function offenZahl(stand) {
  if (stand?.ergebnis !== "offen") return 0;
  return Number(stand.offenInFolge) > 0 ? Number(stand.offenInFolge) : 1;
}

/**
 * Muss der Lauf vor seinem ersten Paket einen offenen Integrationslauf nachholen (E9)? Ja, wenn
 * der letzte `offen` war und das nicht schon zum zweiten Mal in Folge.
 */
export function nachholenNoetig(root = process.cwd()) {
  const n = offenZahl(abh.lesen(root));
  return n > 0 && n < OFFEN_GRENZE;
}

/**
 * Die Restzeit mit der Reserve des Integrationslaufs (E9): Ein neues Paket beginnt nur, wenn nach
 * seinem Bedarf noch die Obergrenze bleibt. Ohne Laufgrenze (`restMs === null`) unveraendert.
 */
export function mitReserve(zeit, reserveMs = integrationObergrenzeMs()) {
  if (zeit.restMs === null || zeit.restMs === undefined) return zeit;
  const bedarfMs = zeit.bedarfMs + reserveMs;
  return { ...zeit, bedarfMs, reicht: zeit.restMs >= bedarfMs };
}

/** Der Plan eines Pakets, gelesen am Board; ein Lesefehler zaehlt als Paket ohne Plan. */
function planDesPakets(id, root) {
  const res = abh.boardRoh("issue", "get", id, { cwd: root });
  return res?.status === 0 ? planVon(res.json?.body) : null;
}

/**
 * Legt eine Karte an und liefert ihre Nummer. `issue create` verlangt ein Autor-Modell; der Runner
 * selbst laeuft ohne `KIT_AGENT_MODEL` (das setzt er nur seinen Sitzungen), darum geht das Modell des
 * Laufs als `--author-model` mit (Issue #1985). `reparatur` sagt, ob die Karte aus einer Vorbereitung
 * stammt: Dann traegt sie in Pro `kit:repair` (Issue #2135, Plan #2131 E4).
 */
function karteAnlegen(titel, body, art, { plan = null, reparatur = null, modell: vorgabe = null, aufruf = abh.board } = {}) {
  const modell = vorgabe || String(process.env.KIT_AGENT_MODEL ?? "").trim() || ZUSTAND.LAUF?.modell;
  const zusatz = [...(plan ? ["--derived-from", plan] : []), ...(modell ? ["--author-model", modell] : [])];
  const res = aufruf("issue", "create", "--title", titel, "--body", body, "--art", art, ...zusatz);
  const id = String(res.id);
  if (reparatur && abh.ausgabe(reparatur.root) === "pro") aufruf("issue", "label", "add", id, labelName("repair"));
  return id;
}

/**
 * Legt die Reparaturkarten aus der Zusammenfassung `summe` ueber kit/board/reparatur.mjs an (Issue
 * #2095, E5): keine zweite Kopie der Kartenanlage. `reparatur` sagt, ob sie aus einer Vorbereitung
 * stammen; dann tragen neue Karten in Pro `kit:repair` (Issue #2135, Plan #2131, E4). Rueckgabe
 * `{ karten, gesperrtePlaene, handgriffe }` mit den angelegten und den kommentierten Karten.
 * Scheitert das Board, steht der Grund im Protokoll, und es gibt keine Karte.
 */
async function kartenAnlegen(summe, { root, reparatur = false }) {
  const aufruf = boardStreng(root);
  let erg;
  try {
    erg = await kartenAusZusammenfassung(summe, { board: aufruf, autor: ZUSTAND.LAUF?.modell ?? null });
  } catch (e) {
    log(t("reparaturGescheitert", { fehler: e.message }));
    return { karten: [], gesperrtePlaene: [], handgriffe: [] };
  }
  if (reparatur && abh.ausgabe(root) === "pro") {
    for (const k of erg.angelegt) aufruf("issue", "label", "add", k.id, labelName("repair"));
  }
  const karten = [...erg.angelegt, ...erg.kommentiert]
    .map((k) => ({ id: k.id, art: k.plan ? "reparatur" : "ohnePlan", plan: k.plan ?? null, pakete: [] }));
  const gesperrtePlaene = [...new Set(karten.map((k) => k.plan).filter((p) => p !== null))];
  return { karten, gesperrtePlaene, handgriffe: erg.handgriffe };
}

/** Ob `summe` mindestens eine rote Pruefung traegt. */
function hatRote(summe) {
  return (Array.isArray(summe?.laufen) ? summe.laufen : []).some((e) => e?.ergebnis === "rot" && typeof e.cmd === "string");
}

/**
 * Die Reparaturkarten eines roten Integrationslaufs (E7) aus seiner Zusammenfassung. Traegt sie
 * keine rote Pruefung, bekommt der Lauf selbst die Karte, an den Paketen seit dem Nullpunkt.
 */
function reparaturKarten({ stand, root }) {
  const summe = abh.zusammenfassung(root);
  if (hatRote(summe)) return kartenAnlegen(summe, { root });
  const ersatz = {
    laufen: [{ cmd: INTEGRATION_CMD, ergebnis: "rot", fund: t("ohneZusammenfassung") }],
    verursacher: [{ cmd: INTEGRATION_CMD, karten: paketeAus(stand).map((karte) => ({ karte })) }],
  };
  return kartenAnlegen(ersatz, { root });
}

// --- Reparaturkarte je Ursache (Issue #2152, Plan #2145, E9) ---
//
// Die Kartenpruefung legt keine Karte je Plan an, sondern je Ursache: den roten Pruefbefehl aus
// der Zeile `Verursacher (<cmd>): …`, ohne sie den roten Job. Eine offene `kit:repair`-Karte mit
// derselben Zeile `Ursache:` bekommt das neue Ergebnis als Kommentar. Die Karte traegt keine
// Zeile `Plan:` — sie nennt alle Plaene des Buendels und sperrt darum keinen. Jeder Board-Aufruf
// geht ueber `boardRoh` und wirft bei einem Fehler: Der Pruefprozess meldet ihn, statt zu enden.

/** Ein Board-Aufruf im Repo `root`, der bei einem Fehler wirft statt den Prozess zu beenden. */
function boardStreng(root) {
  return (...args) => {
    const res = abh.boardRoh(...args, { cwd: root });
    if (res?.status !== 0) throw new Error(t("boardGescheitert", { aufruf: args.slice(0, 2).join(" "), fehler: res?.text || `Exit ${res?.status}` }));
    return res.json;
  };
}

/** Der Text ohne Geklammertes: Die Commits je Eintrag stehen in Klammern und sind selbst mit ", " getrennt. */
function ohneKlammern(text) {
  let tiefe = 0;
  let rest = "";
  for (const zeichen of text) {
    if (zeichen === "(") tiefe += 1;
    else if (zeichen === ")") tiefe = Math.max(0, tiefe - 1);
    else if (tiefe === 0) rest += zeichen;
  }
  return rest;
}

/**
 * Die verursachende Karte (E9): die eine Karte des Buendels, sonst die eine Karte, die die
 * Fundstelle aus `Verursacher` allein beruehrt. Nennt die Zeile mehrere Eintraege, einen Commit
 * ohne Karte oder nur einen Hinweis, ist die Ursache ungeklaert (`null`).
 */
function anlassVon(karten, text) {
  if (karten.length === 1) return String(karten[0]);
  const eintraege = ohneKlammern(String(text ?? "")).split(",").map((e) => e.trim()).filter(Boolean);
  if (eintraege.length !== 1) return null;
  return /^Issue #(\d+)$/.exec(eintraege[0])?.[1] ?? null;
}

/** Die offene `kit:repair`-Karte mit der Zeile `Ursache: <ursache>`, sonst `null`. */
function offeneKarteDerUrsache(offen, ursache) {
  return offen.find((k) => markerWerte(String(k?.body ?? ""), "ursache").some((w) => w.trim() === ursache)) ?? null;
}

/** Die Zeilen, die Karte und Folgekommentar gemeinsam tragen: Anlass, Buendel, Plaene, Fundstelle, Adresse. */
function ursacheZeilen({ anlass, karten, plaene, text, adresse }) {
  const liste = (werte, form) => (werte.length > 0 ? werte.map(form).join(", ") : t("keine"));
  const zeilen = [anlass ? t("ursacheAnlass", { karte: anlass }) : t("ursacheUngeklaert")];
  zeilen.push(t("ursacheBuendel", { karten: liste(karten, (k) => `#${k}`) }), t("ursachePlaene", { plaene: liste(plaene, (p) => `Issue #${p}`) }));
  if (text) zeilen.push(t("ursacheVerursacher", { text }));
  if (adresse) zeilen.push(t("ursacheAdresse", { adresse }));
  return zeilen;
}

/**
 * Legt je Ursache eine Reparaturkarte an oder schreibt das neue Ergebnis an die offene Karte
 * derselben Ursache (E9). `ursachen` ist `[{ cmd, text }]` mit dem Text der Zeile `Verursacher`
 * (oder `null`), `karten` das Buendel der Pruefung. Rueckgabe je Ursache `{ ursache, karte, neu,
 * anlass }`. Wirft mit dem Grund, wenn das Board scheitert.
 */
export function reparaturkartenJeUrsache({ commit, ursachen, karten = [], adresse = null, modell = null, root = process.cwd() }) {
  const aufruf = boardStreng(root);
  const repair = labelName("repair");
  const liste = aufruf("issue", "list");
  const offen = (Array.isArray(liste) ? liste : []).filter((k) => (k?.labels ?? []).includes(repair) && k?.status !== "done");
  const plaene = [...new Set(karten.map((id) => planDesPakets(id, root)).filter((p) => p !== null))];
  const kurz = String(commit ?? "").slice(0, 12) || "?";
  const ergebnis = [];
  for (const { cmd, text } of ursachen) {
    const anlass = anlassVon(karten, text);
    const zeilen = ursacheZeilen({ anlass, karten, plaene, text, adresse });
    const vorhanden = offeneKarteDerUrsache(offen, cmd);
    if (vorhanden) {
      aufruf("issue", "comment", String(vorhanden.id), "--text", [t("ursacheErneut", { commit: kurz }), "", ...zeilen].join("\n"));
      ergebnis.push({ ursache: cmd, karte: String(vorhanden.id), neu: false, anlass });
      continue;
    }
    const body = [
      t("ursacheKontext", { commit: kurz }), "", `${markerName("ursache", prozessSprache())} ${cmd}`, "", ...zeilen, "",
      t("ursacheAufgabe", { ursache: cmd }), "", t("ursacheAk"), "", t("abhaengigkeitenKeine"),
    ].join("\n");
    const id = karteAnlegen(t("ursacheTitel", { ursache: cmd }), body, "task", { reparatur: { root }, modell, aufruf });
    offen.push({ id, body, labels: [repair] });
    ergebnis.push({ ursache: cmd, karte: id, neu: true, anlass });
  }
  return ergebnis;
}

/**
 * Die `[Human]`-Karte nach dem zweiten `offen` in Folge (E9) — oder, mit `funde`, nach der letzten
 * erfolglosen Nachpruefung der Reparaturschleife (Issue #2138, Plan #2131, A7): Dann nennt sie die
 * Runden, die offenen Funde der letzten Nachpruefung (`funde.pruefungen`, `funde.hinweis`) und die
 * Reparaturkarten, die sie hinterliess (`funde.karten`), und `grenzeMs` bleibt ungenutzt.
 */
export function menschKarte(grenzeMs, { funde = null, runden = 0 } = {}) {
  if (funde) {
    const zeilen = [t("reparaturMenschKontext", { runden }), "", t("reparaturMenschFunde"), ...funde.pruefungen.map((cmd) => `- \`${cmd}\``)];
    if (funde.hinweis) zeilen.push("", t("reparaturMenschHinweis", { hinweis: funde.hinweis }));
    if (funde.karten.length > 0) zeilen.push("", t("reparaturMenschKarten"), ...funde.karten.map((id) => `- Issue #${id}`));
    zeilen.push("", t("reparaturMenschAufgabe"), "", t("reparaturMenschAk"), "", t("abhaengigkeitenKeine"));
    return { id: karteAnlegen(t("reparaturMenschTitel", { runden }), zeilen.join("\n"), "human"), art: "mensch", plan: null, pakete: [] };
  }
  const grenze = Math.round(grenzeMs / 60_000);
  const body = [t("menschKontext", { grenze }), "", t("menschAufgabe"), "", t("menschAk"), "", t("abhaengigkeitenKeine")].join("\n");
  return { id: karteAnlegen(t("menschTitel"), body, "human"), art: "mensch", plan: null, pakete: [] };
}

/** Ob `nachher` von diesem Lauf stammt: neu geschrieben, nicht der Stand von vorher. */
function vonDiesemLauf(vorher, nachher) {
  if (nachher === null) return false;
  if (vorher === null) return true;
  return nachher.zeitpunkt !== vorher.zeitpunkt || nachher.commit !== vorher.commit || nachher.ergebnis !== vorher.ergebnis;
}

/** Schreibt `offen` samt Zaehler nach integration.json und liefert den Zaehler. */
function offenVermerken(vorher, nachher, eigen, startMs, root) {
  const offenInFolge = offenZahl(vorher) + 1;
  const basis = eigen ? nachher : { commit: vorher?.commit ?? null, zeitpunkt: new Date(startMs).toISOString(), verursacher: [] };
  abh.schreiben({ ...basis, ergebnis: "offen", offenInFolge }, root);
  return offenInFolge;
}

/** Die Pakete seit dem Nullpunkt aus integration.json, als Nummern. */
function paketeAus(stand) {
  return (Array.isArray(stand?.pakete) ? stand.pakete : []).map((p) => String(p?.karte ?? p)).filter((p) => p !== "undefined");
}

/**
 * Faehrt einen Integrationslauf und wertet ihn aus (E7, E9). `anlass` ist `ende` (nach dem
 * letzten Paket) oder `nachholen` (vor dem ersten Paket). Rueckgabe:
 * `{ anlass, ergebnis, dauerMs, offenInFolge, pakete, karten, gesperrtePlaene }`.
 */
export async function integrationFahren({ anlass, root = process.cwd() }) {
  const grenzeMs = integrationObergrenzeMs();
  const vorher = abh.lesen(root);
  const startMs = abh.jetzt();
  log(t("startLog", { anlass: t(`anlass_${anlass}`), grenze: Math.round(grenzeMs / 60_000) }));
  const res = await abh.lauf({ root, grenzeMs: grenzeMs + NACHFRIST_MS });
  const dauerMs = Math.max(0, abh.jetzt() - startMs);
  const nachher = abh.lesen(root);
  const eigen = vonDiesemLauf(vorher, nachher);
  let ergebnis = eigen && ["gruen", "rot"].includes(nachher.ergebnis) ? nachher.ergebnis : "offen";
  if (res?.abgebrochen) {
    ergebnis = "offen";
    log(t("abbruchLog", { grenze: Math.round(grenzeMs / 60_000) }));
  }
  const eintrag = { anlass, ergebnis, dauerMs, offenInFolge: 0, pakete: eigen ? paketeAus(nachher) : [], karten: [], gesperrtePlaene: [] };
  if (ergebnis === "rot") {
    Object.assign(eintrag, await reparaturKarten({ stand: nachher, root }));
  } else if (ergebnis === "offen") {
    eintrag.offenInFolge = offenVermerken(vorher, nachher, eigen, startMs, root);
    if (eintrag.offenInFolge === OFFEN_GRENZE) {
      log(t("keinNachholen"));
      eintrag.karten.push(menschKarte(grenzeMs));
    }
  }
  log(t("endeLog", { anlass: t(`anlass_${anlass}`), zeile: integrationZeile(eintrag) }));
  return eintrag;
}

/**
 * Das Urteil einer Vorbereitung als Integrationslauf (E12): `anlass`, `ergebnis`, `commit`, ob
 * es nach integration.json geht und ob Reparaturkarten entstehen. Das Urteil des Build-Diensts
 * geht vor; Rot dort wie auf dem eigenen Rechner bringt Reparaturkarten (Issue #2135, #2095). Prueft die Push-Stufe im
 * Build-Dienst und fehlt sein Urteil, gilt #1827, Kriterium 4: offen, aber nicht vermerkt — der
 * Runner holt ihn nicht nach (Kriterium 14). Nicht vorbereitet ist offen und wird nachgeholt.
 */
function vorbereitungsUrteil(vorbereitung, imBuildDienst) {
  const bd = vorbereitung?.buildDienst;
  if (bd?.ergebnis === "gruen" || bd?.ergebnis === "rot") {
    return { anlass: "buildDienst", ergebnis: bd.ergebnis, commit: bd.commit ?? vorbereitung.commit, schreiben: true, reparatur: bd.ergebnis === "rot" };
  }
  if (vorbereitung?.ergebnis === "rot") return { anlass: "vorbereitung", ergebnis: "rot", commit: vorbereitung.commit, schreiben: true, reparatur: true };
  if (imBuildDienst) return { anlass: "buildDienst", ergebnis: "offen", schreiben: false, reparatur: false };
  if (vorbereitung?.ergebnis === "gruen" || vorbereitung?.ergebnis === "gruen-offen") {
    return { anlass: "vorbereitung", ergebnis: "gruen", commit: vorbereitung.commit, schreiben: true, reparatur: false };
  }
  return { anlass: "vorbereitung", ergebnis: "offen", schreiben: true, reparatur: false };
}

/** Die roten Pruefungen einer Vorbereitung aus ihrem Feld `rot`. */
function roteDerVorbereitung(vorbereitung) {
  const rot = vorbereitung?.rot ?? null;
  return typeof rot?.pruefung === "string" ? rot.pruefung.split(", ").filter(Boolean) : [];
}

/**
 * Die Zusammenfassung aus dem Feld `rot` der Vorbereitung — der Rueckfall, wenn es keine passende
 * gibt: je roter Pruefung ein Eintrag ohne Wortlaut, verursacht durch `rot.karten`, sonst durch
 * die Pakete der Vorbereitung, dazu der Hinweis.
 */
function summeAusRot(vorbereitung, pakete) {
  const rot = vorbereitung?.rot ?? null;
  const karten = (Array.isArray(rot?.karten) ? rot.karten.map(String) : pakete).map((karte) => ({ karte }));
  const rote = roteDerVorbereitung(vorbereitung);
  const hinweis = typeof rot?.hinweis === "string" ? rot.hinweis : null;
  return {
    laufen: rote.map((cmd) => ({ cmd, ergebnis: "rot" })),
    verursacher: rote.flatMap((cmd) => [{ cmd, karten }, ...(hinweis ? [{ cmd, hinweis }] : [])]),
  };
}

/**
 * Die Zusammenfassung des Vorbereitungslaufs auf dem eigenen Rechner (Issue #2095): die Datei,
 * die der Rueckweg aus dem Release-Worktree ersetzt. Sie gilt diesem Lauf, wenn ihre roten
 * Pruefungen genau die aus `rot.pruefung` sind — die Datei traegt keinen Commit. Sonst `null`.
 */
function summeDerVorbereitung(vorbereitung, root) {
  const summe = abh.zusammenfassung(root);
  const rote = roteDerVorbereitung(vorbereitung);
  const inSumme = (Array.isArray(summe?.laufen) ? summe.laufen : []).filter((e) => e?.ergebnis === "rot").map((e) => e.cmd);
  const gleich = rote.length > 0 && rote.length === new Set(inSumme).size && rote.every((cmd) => inSumme.includes(cmd));
  return gleich ? summe : null;
}

/**
 * Die Reparaturkarten einer roten Vorbereitung, in Pro mit `kit:repair` (Issue #2135, #2095): nach
 * rotem Build-Dienst aus dem Protokoll seiner roten Jobs zum geprueften Commit, wie `issue repair
 * --ci <sha>` (A5); auf dem eigenen Rechner aus der Zusammenfassung des Vorbereitungslaufs. Das
 * Feld `rot` der Vorbereitung ist der Rueckfall, wenn beides fehlt.
 */
async function reparaturAusVorbereitung(vorbereitung, urteil, pakete, root) {
  let summe = null;
  if (urteil.anlass === "buildDienst") {
    try {
      summe = await summeAusBuildDienst(urteil.commit, await abh.host(root));
    } catch (e) {
      log(t("protokollUnlesbar", { commit: String(urteil.commit ?? "?").slice(0, 12), fehler: e.message }));
    }
  } else {
    summe = summeDerVorbereitung(vorbereitung, root);
  }
  return kartenAnlegen(summe ?? summeAusRot(vorbereitung, pakete), { root, reparatur: true });
}

/**
 * Der Integrationslauf am Ende einer Kette mit Ziel `push-vorbereitet` (Issue #1985, Plan #1969,
 * E12): Der volle Prueflauf der Vorbereitung ist er, ein zweiter laeuft nicht. Schreibt sein
 * Urteil nach integration.json — auf dem eigenen Rechner die Stufe `push` aus `/push-main
 * prepare`, sonst das Urteil des Build-Diensts — und legt bei Rot Reparaturkarten an, auf dem
 * eigenen Rechner wie im Build-Dienst (Kriterium 3 und 6, Issue #2135, #2095). `imBuildDienst` sagt, ob
 * die Push-Stufe im Build-Dienst prueft. Rueckgabe in der Form von `integrationFahren`.
 */
export async function integrationAusVorbereitung({ vorbereitung, imBuildDienst = false, dauerMs = 0, root = process.cwd() }) {
  const urteil = vorbereitungsUrteil(vorbereitung, imBuildDienst);
  const pakete = (Array.isArray(vorbereitung?.pakete) ? vorbereitung.pakete : []).map((p) => String(p?.karte ?? p));
  const eintrag = { anlass: urteil.anlass, ergebnis: urteil.ergebnis, dauerMs, offenInFolge: 0, pakete, karten: [], gesperrtePlaene: [] };
  if (urteil.schreiben) {
    const vorher = abh.lesen(root);
    const zeitpunkt = new Date(abh.jetzt()).toISOString();
    const quelle = urteil.anlass;
    if (urteil.ergebnis === "offen") {
      eintrag.offenInFolge = offenZahl(vorher) + 1;
      abh.schreiben({ commit: vorher?.commit ?? null, zeitpunkt, ergebnis: "offen", verursacher: [], quelle, offenInFolge: eintrag.offenInFolge }, root);
    } else {
      abh.schreiben({ commit: urteil.commit ?? null, zeitpunkt, ergebnis: urteil.ergebnis, verursacher: [], quelle, pakete: pakete.map((karte) => ({ karte })) }, root);
    }
  }
  if (urteil.reparatur) Object.assign(eintrag, await reparaturAusVorbereitung(vorbereitung, urteil, pakete, root));
  log(t("endeLog", { anlass: t(`anlass_${eintrag.anlass}`), zeile: integrationZeile(eintrag) }));
  return eintrag;
}

/** Eine Karte des Integrationslaufs in der Zeile: Nummer und Art. */
function karteText(k) {
  if (k.art === "reparatur") return t("karteMitPlan", { id: k.id, plan: k.plan });
  if (k.art === "mensch") return t("karteMensch", { id: k.id });
  return t("karteOhnePlan", { id: k.id });
}

/** Ein Integrationslauf als eine Zeile fuer Protokoll, Laufstand und Bericht. */
export function integrationZeile(eintrag) {
  const liste = (werte) => (werte.length > 0 ? werte.join(", ") : t("keine"));
  const werte = {
    ergebnis: t(`ergebnis_${eintrag.ergebnis}`),
    dauer: (Number(eintrag.dauerMs) / 60_000).toFixed(1),
    pakete: liste((eintrag.pakete ?? []).map((p) => `#${p}`)),
    karten: liste((eintrag.karten ?? []).map(karteText)),
  };
  if (eintrag.ergebnis === "offen" && eintrag.offenInFolge > 1) return t("zeileOffenInFolge", { ...werte, n: eintrag.offenInFolge });
  return t("zeile", werte);
}

/**
 * Die Zeile, mit der ein Lauf statt des Integrationslaufs die Vorbereitung der Veroeffentlichung
 * ankuendigt (Plan #2131, A1; Issue #2136), mit den unveroeffentlichten Paketen.
 */
export function vorbereitungStattText(pakete) {
  return t("vorbereitungStatt", { pakete: pakete.map((id) => `#${id}`).join(", ") });
}

/**
 * Die Zeile, mit der ein Lauf in Pro statt Vorbereitung und Integrationslauf die Pruefung je Karte
 * startet (Plan #2145, E1, E14, E15; Issue #2155); `gestartet` sagt, ob der Start gelang.
 */
/** Die Zeile, wenn Pro den offenen Integrationslauf nicht nachholt (Issue #2186). */
export function nachholenEntfaelltText() {
  return t("nachholenEntfaellt");
}

export function kartenpruefungStattText(gestartet) {
  return t(gestartet ? "kartenpruefungStatt" : "kartenpruefungStattNicht");
}

/**
 * Die Zeile in Community (Plan #2131, A2): Die Vorbereitung gehoert zu Pro, der Lauf endet mit
 * dem lokalen Integrationslauf. `meldung` ist die Pro-Meldung in der Projektsprache.
 */
export function vorbereitungProText(meldung) {
  return t("vorbereitungPro", { meldung });
}

/** Die Zeile, mit der der Runner ein Paket eines gesperrten Plans auslaesst. */
export function planGesperrtText(id, plan) {
  return t("planGesperrtLog", { id, plan });
}

/** Der Anlass als Text, fuer den Bericht. */
export function anlassText(anlass) {
  return t(`anlass_${anlass}`);
}
