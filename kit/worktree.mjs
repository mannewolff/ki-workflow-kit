#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * claude-workflow-kit Worktree fuer die Release-Skills (Issue #929)
 *
 * `/push-main` und `/merge-production` erzeugen Release-Dateien, fahren ihren Prueflauf und
 * committen — bis v3.3.2 im Haupt-Working-Tree. Dort baut unter Variante B aber auch die
 * Umsetzungsstufe des Runners. Am 2026-09-25 riss das in kanban-kit zweimal
 * dieselbe Kette ab: Beide Seiten committeten korrekt nur ihre eigenen Dateien, danach fand
 * der Runner die Release-Dateien als unkommittierte Reste und stoppte hart. Dazu kam, dass
 * fremde, halbfertige Dateien den Release-Prueflauf verfaelscht haetten.
 *
 * Seither laufen beide Skills in einem eigenen Worktree ausserhalb des Repos, und diese
 * Datei ist ihre Tuer dorthin:
 *
 *   node .claude/kit/worktree.mjs create [--prefix release] [--ref <ref>] [--issue <n>] [--pristine]
 *   node .claude/kit/worktree.mjs remove <pfad>
 *   node .claude/kit/worktree.mjs catch-up-check
 *   node .claude/kit/worktree.mjs return <pfad>
 *   node .claude/kit/worktree.mjs record-preparation <pfad> --result <e> [--open "<Text>"]... [--fetch <f>] [--security <s>]
 *   node .claude/kit/worktree.mjs check-preparation [--discard]
 *   node .claude/kit/worktree.mjs attempt --base <sha> --commit <sha> --result <e> [--reason <text>]
 *   node .claude/kit/worktree.mjs clean-check-branch
 *   node .claude/kit/worktree.mjs publish-state
 *   node .claude/kit/worktree.mjs in <pfad> -- <kommando> [argumente]
 *
 * KEIN ZWEITER WEG (Entscheidung des Pakets): Angelegt, gespiegelt und abgeraeumt wird mit
 * denselben Funktionen, die die Kette benutzt — `worktreeAnlegen`,
 * `worktreeEntfernen`, `worktreesAufraeumen` und `befundeZurueck` aus dem Community-Teil
 * `board/arbeitskopie.mjs` (Issue #1858, Plan #1853, E3; bis dahin `night/kitstand.mjs`).
 * Diese Datei traegt darum bewusst eine Nachbar-Abhaengigkeit und ist keine fuer sich portable
 * Einzeldatei wie `effort.mjs` oder `findings.mjs` (Muster #440): Zwei Wege, einen Worktree
 * vorzubereiten, laufen beim ersten Unterschied auseinander — und der Spiegel von
 * `.claude/` ist genau der Teil, den ein Skill nicht nebenbei nachbaut. Einen Pfad unter
 * `night/` importiert sie nicht: `push main` und `merge production` laufen ohne den Runner.
 * Die vorbereitete Veroeffentlichung (`record-preparation`, `check-preparation`) gehoert dem
 * Runner, seit Issue #2012 ein Community-Nachbar (Plan #2008 A1); sie kommt ueber einen
 * abgefangenen `import()` von `night.mjs`. Fehlt er, hat ihn auch niemand vorbereitet:
 * `check-preparation` meldet keine Vorbereitung, und `record-preparation` haelt nichts fest.
 * `clean-check-branch` dagegen
 * braucht den Runner nicht (Plan #1965, E8, E13): Es liest `.claude/pruefzweig-offen.json`
 * ueber `board/arbeitskopie.mjs` und laeuft in Community und Pro. `night.mjs` seinerseits kennt
 * diese Datei nicht; der Runner bleibt ohne sie vollstaendig.
 *
 * AUSGABE: eine Zeile JSON auf stdout, immer als LETZTE Zeile — der Rueckweg kann ihr einen
 * Hinweis des Runners voranstellen (`befundeZurueck` protokolliert ein gescheitertes
 * Anhaengen, statt daran zu scheitern). Bei einem Fehler steht `{"ok":false,"fehler":…}`
 * und der Exitcode ist 1.
 */

import { spawnSync } from "node:child_process";
import { existsSync, copyFileSync, mkdirSync, readFileSync, appendFileSync, realpathSync, statSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Der Normalisierer der Einstellungsnamen aus dem Board-Teil config-namen (Issue #1436, Plan
// #1420 E10): Er bildet eine englisch benannte Config auf die deutschen Namen ab, die dieses
// Modul liest. Dynamisch und abgefangen, denn das Modul laeuft auch allein ohne den Board-Teil;
// fehlt er, bleibt die Config, wie sie gelesen wurde.
const { normalisiereConfig = (roh) => ({ config: roh, hinweise: [] }) } =
  await import(new URL("./board/config-namen.mjs", import.meta.url).href).catch(() => ({}));

import {
  worktreeAnlegen, worktreeEntfernen, worktreesAufraeumen, befundeZurueck, nachziehenPruefen, ohneVorbereitung,
  configVonPlatte, pruefzweigOffenLesen, PRUEFZWEIG_OFFEN_DATEI, gitIm,
} from "./board/arbeitskopie.mjs";
import { TEXTE } from "./texte/worktree.mjs";

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "6.1.0";

// Die Texttabelle liegt im Teil texte/ (Issue #1524); exportiert bleibt sie unter ihrem Namen.
export { TEXTE };

// Der Texthelfer aus dem Board-Teil namen (Plan #1420 E13), abgefangen wie der Normalisierer:
// Fehlt board/namen.mjs neben worktree.mjs, bleiben die Texte deutsch.
const namen = await import(new URL("./board/namen.mjs", import.meta.url).href).catch(() => null);

/** Der Text zu `schluessel` aus `TEXTE` in der Sprache des Prozesses; ohne Register deutsch. */
function t(schluessel, werte = {}) {
  if (namen) return namen.text(TEXTE, schluessel, werte);
  return TEXTE.de[schluessel].replaceAll(/\{([A-Za-z_]\w*)\}/g, (_, name) => String(werte[name]));
}

/** Die Dateien, die der Rueckweg ANHAENGT (Buchhaltung, nie ersetzen). */
const ANGEHAENGT = ".claude/ausfuehrungen.tsv";
/** Die Datei, die der Rueckweg ERSETZT: Sie bezeugt genau einen Stand. */
const ZUSAMMENFASSUNG = ".claude/checks-summary.json";

function pfadIn(root, relativ) {
  return join(root, ...relativ.split("/"));
}

/**
 * Die Hauptkopie des Repos — nicht das aktuelle Verzeichnis.
 *
 * `git rev-parse --show-toplevel` taugt hier nicht: In einem Worktree liefert es DEN
 * WORKTREE, und ein `entfernen` von dort aus zielte auf sich selbst. Der erste Eintrag von
 * `git worktree list --porcelain` ist immer die Hauptkopie — damit darf jedes Kommando auch
 * aus dem Worktree heraus gerufen werden, ohne dass der Skill vorher zuruecklaufen muss.
 */
function repoWurzel() {
  const res = spawnSync("git", ["worktree", "list", "--porcelain"], { encoding: "utf-8" });
  if (res.status !== 0) throw new Error(t("keinRepo", { ausgabe: (res.stderr || res.stdout || "").trim() }));
  const erste = res.stdout.split(/\r?\n/).find((z) => z.startsWith("worktree "));
  if (!erste) throw new Error(t("keineHauptkopie", { ausgabe: res.stdout.trim() }));
  return erste.slice("worktree ".length).trim();
}

/**
 * Die frueheren deutschen Namen der Unterkommandos, Optionen und Werte, je Eintrag deutsch ->
 * englisch (Issue #1564, Plan #1548 E5). Seit Version 5 nimmt worktree.mjs nur die englischen
 * an; diese Tabellen dienen allein der Meldung, die einen deutschen Namen abweist und den
 * englischen nennt — zum Ausfuehren werden sie nie benutzt.
 */
const ALTE_BEFEHLE = Object.freeze({
  anlegen: "create",
  entfernen: "remove",
  im: "in",
  "nachziehen-pruefen": "catch-up-check",
  rueckweg: "return",
  "vorbereitung-festhalten": "record-preparation",
  "vorbereitung-pruefen": "check-preparation",
});
const ALTE_OPTIONEN = Object.freeze({
  "--praefix": "--prefix",
  "--ergebnis": "--result",
  "--offen": "--open",
  "--verwerfen": "--discard",
});
const ALTE_WERTE = Object.freeze({ gruen: "green", "gruen-offen": "green-open", rot: "red", fehlgeschlagen: "failed" });

/**
 * Die getippten Werte von --result und --fetch zum internen Schluessel (E5): Getippt wird
 * englisch, festgehalten wird weiter der Wert, den `vorbereitungFesthalten` und der Leser
 * der Vorbereitungsdatei kennen.
 */
const ERGEBNIS_WERTE = Object.freeze({ green: "gruen", "green-open": "gruen-offen", red: "rot" });
const FETCH_WERTE = Object.freeze({ ok: "ok", failed: "fehlgeschlagen" });
/**
 * Die Werte von --result in `attempt` (Issue #2137, Plan #2131, A12): getippt englisch, in
 * `.claude/veroeffentlichungen.tsv` steht der interne Schluessel, den kit/effort.mjs liest.
 */
const ANLAUF_WERTE = Object.freeze({ green: "gruen", red: "rot", aborted: "abgebrochen", pushed: "veroeffentlicht" });
/** Das Register der Anlaeufe; es bleibt in der Hauptkopie (`bleibtInHauptkopie`, Issue #2132). */
const VEROEFFENTLICHUNGEN = ".claude/veroeffentlichungen.tsv";
/**
 * Die Werte von --security (Plan #1988, E8; Issue #1993): getippt wird das `ergebnis` von
 * `issue-review security-result`, wie es ist, und so steht es auch in der Datei.
 */
const SICHERHEIT_WERTE = Object.freeze(["gruen", "kritisch", "ausfall"]);

/** Wirft die Abweisung, wenn `name` ein frueherer deutscher Name aus `tabelle` ist. */
function altnameAbweisen(tabelle, name) {
  if (typeof name === "string" && Object.hasOwn(tabelle, name)) {
    throw new Error(t("altname", { name, englisch: tabelle[name] }));
  }
}

/** Ein Wert hinter einem Flag; `null`, wenn das Flag fehlt. */
function flagWert(cliArgs, name) {
  const i = cliArgs.indexOf(name);
  return i !== -1 && i + 1 < cliArgs.length ? cliArgs[i + 1] : null;
}

/** Der interne Schluessel zum getippten Wert `wert` der Option `option` aus `tabelle`. */
function internerWert(tabelle, option, wert) {
  altnameAbweisen(ALTE_WERTE, wert);
  if (!Object.hasOwn(tabelle, wert)) {
    throw new Error(t("unbekannterWert", { option, wert, werte: Object.keys(tabelle).join(", ") }));
  }
  return tabelle[wert];
}

/** Der Zeitstempel im Ordnernamen — dieselbe Form wie im Protokollnamen des Runners. */
function stempel() {
  return new Date().toISOString().replaceAll(/[:.]/g, "-");
}

/**
 * Das Installationskommando der Hauptkopie — der Weg zu den Abhaengigkeiten (Issue #964).
 *
 * Gelesen wird NUR die geteilte `workflow.config.json`: Das Feld gilt teamweit, genau wie
 * `formatFixCommand`, und eine persoenliche Datei darf es nicht abweichend setzen. Keine
 * oder unlesbare Config ist ein normaler Zustand und heisst "nichts tun" — dieselbe Regel
 * wie in `configVonPlatte` (night.mjs).
 */
function installKommando(repoRoot) {
  try {
    const { config: cfg } = normalisiereConfig(JSON.parse(readFileSync(join(repoRoot, ".claude", "workflow.config.json"), "utf-8")));
    return (cfg.installCommand || "").trim();
  } catch {
    return "";
  }
}

/**
 * Stellt die Abhaengigkeiten IM Worktree her (Issue #964).
 *
 * Ein frischer Worktree traegt nur Versioniertes plus das gespiegelte `.claude/` — weder
 * `node_modules` noch `.venv` oder `vendor/`. Bis #964 stand nur als Text in zwei Skills,
 * dass sie herzustellen sind; am 2026-09-27 brach darum in einem Worktree ein Test nach
 * 43 ms mit ERR_MODULE_NOT_FOUND ab und die Messung war still zu niedrig. Der Schaden ist
 * nicht der rote Lauf, sondern der falsche Messwert — deshalb steht die Vorgabe jetzt hier
 * und nicht mehr nur im Text.
 *
 * Das Kommando kommt aus der Config und braucht deshalb die Shell der Plattform — derselbe
 * Weg, den `night.mjs` fuer `buildChecks` und `formatFixCommand` nimmt (Issue #199). Seine
 * Ausgabe geht VOR der JSON-Zeile auf stdout: Sie ist bei einem Fehlschlag die Diagnose,
 * und die letzte Zeile bleibt JSON.
 *
 * Ein roter Lauf laesst keinen halbfertigen Worktree zurueck — genau aus dem entstand der
 * stille Fehlmesswert.
 */
function installiereIn(pfad, repoRoot, configWurzel = repoRoot) {
  const kommando = installKommando(configWurzel);
  if (!kommando) return null;

  // PATH-Aufloesung bewusst, wie bei den uebrigen Config-Kommandos (S4036, Issue #183).
  const res = spawnSync(kommando, { cwd: pfad, encoding: "utf-8", shell: true });
  const ausgabe = `${res.stdout || ""}${res.stderr || ""}`;
  if (ausgabe.trim() !== "") process.stdout.write(ausgabe.endsWith("\n") ? ausgabe : `${ausgabe}\n`);
  if (res.status === 0) return kommando;

  worktreeEntfernen(pfad, repoRoot);
  const code = res.status === null ? t("signal", { signal: res.signal }) : t("exitCode", { status: res.status });
  throw new Error(t("installRot", { kommando, code }));
}

/**
 * Setzt jede versionierte Datei im Worktree auf `<ref>` zurueck und raeumt, was der Spiegel
 * unversioniert und nicht ignoriert hinzugelegt hat (Issue #2126). Ignoriertes bleibt — die
 * Werkzeuge und die persoenlichen Dateien unter `.claude/`. Scheitert git, baut die Funktion
 * den Worktree ab und wirft: Ein Hotfix-Worktree mit Dateien der Hauptkopie ist genau der
 * Zustand, den sie verhindert.
 */
function aufRefZuruecksetzen(pfad, repoRoot) {
  for (const befehl of [["reset", "-q", "--hard", "HEAD"], ["clean", "-q", "-f", "-d"]]) {
    const res = spawnSync("git", befehl, { cwd: pfad, encoding: "utf-8" });
    if (res.status === 0) continue;
    worktreeEntfernen(pfad, repoRoot);
    throw new Error(t("unberuehrtRot", { befehl: befehl[0], meldung: (res.stderr || res.stdout || "").trim() }));
  }
}

function anlegen(repoRoot, cliArgs) {
  const praefix = flagWert(cliArgs, "--prefix") ?? "release";
  const ref = flagWert(cliArgs, "--ref") ?? "HEAD";
  const issueId = flagWert(cliArgs, "--issue");
  // `--pristine` (Issue #2126): Der Worktree traegt genau `<ref>`. Der Spiegel von `.claude/`
  // ueberschriebe sonst die versionierte `workflow.config.json` mit der der Hauptkopie, und deren
  // `installCommand` liefe hier, deren `buildChecks` im Prueflauf — Befehle eines Stands, der
  // weder ausgeliefert noch geprueft ist. Der Hotfix liest darum auch das `installCommand` aus
  // dem Worktree, also aus `<ref>`.
  const unberuehrt = cliArgs.includes("--pristine");
  // Erst abraeumen, dann anlegen: Ein harter Abbruch laesst Ordner und Eintrag liegen, und
  // der naechste Lauf legte sonst einen zweiten Worktree neben einen toten. Geraeumt wird
  // NUR der uebergebene Praefix — `kette` und `pruefung` koennen gerade laufen.
  const aufgeraeumt = worktreesAufraeumen(repoRoot, praefix);
  const pfad = worktreeAnlegen({ repoRoot, issueId, stempel: stempel(), praefix, ref });
  if (unberuehrt) aufRefZuruecksetzen(pfad, repoRoot);
  const installation = installiereIn(pfad, repoRoot, unberuehrt ? pfad : repoRoot);
  return { ok: true, pfad, ref, praefix, aufgeraeumt, installation, unberuehrt };
}

function entfernen(repoRoot, cliArgs) {
  const pfad = cliArgs.find((a) => !a.startsWith("--"));
  if (!pfad) throw new Error(t("entfernenPfad"));
  worktreeEntfernen(pfad, repoRoot);
  return { ok: true, entfernt: pfad };
}

/**
 * Holt aus dem Worktree, was in der Hauptkopie weiterzaehlt (Issue #929, Aufgabe 4).
 *
 * Drei Dateien, zwei Arten: Die Zusammenfassung des Prueflaufs bezeugt genau einen Stand
 * und wird darum ERSETZT — sie ist der frischere Nachweis. Ausfuehrungsprotokoll und
 * Befunde sind Buchhaltung und werden ANGEHAENGT; der Spiegel traegt sie gar nicht erst in
 * den Worktree, dort stehen also ausschliesslich die Zeilen dieses Laufs. Fuer die Befunde
 * macht das `befundeZurueck` der Kette — samt Schwellenpruefung am Gesamtstand, deren
 * Ergebnis der Skill in je einen `findings.mjs suggest --kind <a>` uebersetzt.
 */
function rueckweg(repoRoot, cliArgs) {
  const pfad = cliArgs.find((a) => !a.startsWith("--"));
  if (!pfad) throw new Error(t("rueckwegPfad"));

  const quelle = pfadIn(pfad, ZUSAMMENFASSUNG);
  const ziel = pfadIn(repoRoot, ZUSAMMENFASSUNG);
  let zusammenfassung = false;
  if (existsSync(quelle)) {
    mkdirSync(dirname(ziel), { recursive: true });
    copyFileSync(quelle, ziel);
    zusammenfassung = true;
  }

  let ausfuehrungen = 0;
  const protokoll = pfadIn(pfad, ANGEHAENGT);
  if (existsSync(protokoll)) {
    const zeilen = readFileSync(protokoll, "utf-8").split(/\r?\n/).filter((z) => z !== "");
    if (zeilen.length > 0) {
      const protokollZiel = pfadIn(repoRoot, ANGEHAENGT);
      mkdirSync(dirname(protokollZiel), { recursive: true });
      appendFileSync(protokollZiel, zeilen.map((z) => `${z}\n`).join(""), "utf-8");
      ausfuehrungen = zeilen.length;
    }
  }

  return { ok: true, zusammenfassung, ausfuehrungen, befundeArten: befundeZurueck(pfad, repoRoot) };
}

/** Alle Werte eines wiederholbaren Flags, in Reihenfolge. */
function flagWerte(cliArgs, name) {
  const werte = [];
  for (let i = 0; i < cliArgs.length - 1; i += 1) if (cliArgs[i] === name) werte.push(cliArgs[i + 1]);
  return werte;
}

/**
 * Der Runner als Community-Nachbar (Issue #2012, Plan #2008 A1), `null`, wenn `night.mjs` fehlt
 * oder sich nicht laden laesst.
 */
const runnerLaden = () => import(new URL("./night.mjs", import.meta.url)).catch(() => null);

/**
 * Der Pro-Teil `card-check` (Issue #2154, Plan #2145, E12) fuer die Installation unter `repoRoot`,
 * `null` ohne ihn: in Community, wenn kit/night/kartenpruefung.mjs fehlt oder wenn kit/board/pro.mjs
 * neben worktree.mjs fehlt. Ein Fehler beim Laden einer vorhandenen Datei geht weiter: Fehlen ist
 * erlaubt, kaputt sein nicht.
 */
async function kartenpruefungLaden(repoRoot) {
  const pro = await import(new URL("./board/pro.mjs", import.meta.url).href).catch(() => null);
  return pro ? pro.proLaden("card-check", undefined, repoRoot) : null;
}

/**
 * Ruft nur `vorbereitungFesthalten` des Runners auf (Plan #1243, Plan-Review Runde 2, Fund 7).
 * Ohne den Runner (Issue #1858) wird nichts festgehalten — Exitcode 0.
 */
async function vorbereitungFesthaltenAufruf(repoRoot, cliArgs) {
  const pfad = cliArgs[0];
  if (!pfad || pfad.startsWith("--")) throw new Error(t("festhaltenPfad"));
  const getippt = flagWert(cliArgs, "--result");
  if (getippt === null) throw new Error(t("festhaltenErgebnis", { werte: Object.keys(ERGEBNIS_WERTE).join("|") }));
  const ergebnis = internerWert(ERGEBNIS_WERTE, "--result", getippt);
  const fetch = internerWert(FETCH_WERTE, "--fetch", flagWert(cliArgs, "--fetch") ?? "ok");
  const sicherheit = flagWert(cliArgs, "--security");
  if (sicherheit !== null && !SICHERHEIT_WERTE.includes(sicherheit)) {
    throw new Error(t("unbekannterWert", { option: "--security", wert: sicherheit, werte: SICHERHEIT_WERTE.join(", ") }));
  }
  const runner = await runnerLaden();
  if (!runner) return { ok: true, festgehalten: false };
  return { ok: true, ...runner.vorbereitungFesthalten({ repoRoot, pfad, ergebnis, offen: flagWerte(cliArgs, "--open"), fetch, sicherheit }) };
}

/** Ein Feld der TSV-Zeile: Backslash, Tab und Zeilenumbrueche maskiert wie in `.claude/ausfuehrungen.tsv`. */
function tsvFeld(wert) {
  return wert.replaceAll("\\", "\\\\").replaceAll("\t", String.raw`\t`).replaceAll("\n", String.raw`\n`).replaceAll("\r", String.raw`\r`);
}

/**
 * `attempt` (Issue #2137, Plan #2131, A12; Fachplan #2130, Kriterium 6): haelt einen Anlauf von
 * `push main` fest, eine Zeile je Aufruf in `.claude/veroeffentlichungen.tsv` der Hauptkopie —
 * Zeitpunkt, Basis, Kennung, Ausgang, Grund. Die Basis ist der Stand des Hauptzweigs am Server,
 * auf den die Veroeffentlichung zielt; Anlaeufe mit derselben Basis zaehlt kit/effort.mjs zu
 * einer Veroeffentlichung zusammen. Angehaengt, nie ersetzt: Die Datei ist Buchhaltung.
 */
function anlaufFesthalten(repoRoot, cliArgs) {
  const werte = Object.keys(ANLAUF_WERTE).join("|");
  const basis = flagWert(cliArgs, "--base");
  const kennung = flagWert(cliArgs, "--commit");
  const getippt = flagWert(cliArgs, "--result");
  if ([basis, kennung, getippt].some((w) => w === null || w.startsWith("--"))) throw new Error(t("anlaufForm", { werte }));
  const ausgang = internerWert(ANLAUF_WERTE, "--result", getippt);
  const grund = flagWert(cliArgs, "--reason") ?? "";
  const zeitpunkt = new Date().toISOString();
  const datei = pfadIn(repoRoot, VEROEFFENTLICHUNGEN);
  mkdirSync(dirname(datei), { recursive: true });
  appendFileSync(datei, `${[zeitpunkt, basis, kennung, ausgang, grund].map(tsvFeld).join("\t")}\n`, "utf-8");
  return { ok: true, datei: VEROEFFENTLICHUNGEN, zeitpunkt, basis, commit: kennung, ausgang, grund };
}

/**
 * Das Urteil von `vorbereitungPruefen` des Runners, ohne Uebernahme mit `grund` in genau vier
 * Werten (nie-geprueft, stand-geaendert, rot, laeuft) und dem Satz dazu in `detail` (Issue #2134,
 * Plan #2131, E3). Ohne den Runner (Issue #1858) gibt es
 * keine Vorbereitung: dasselbe Urteil wie ohne `.claude/push-vorbereitung.json`, und
 * `--discard` findet weder Datei noch Referenz. Community und Pro urteilen gleich (Issue #2012).
 *
 * Das Feld `buildDienst` ist `null`, in Community wie in Pro (Issue #2154, Plan #2145, E14): In
 * Pro liest `push main` den geprueften Stand aus `publish-state`, das Urteil einer Vorbereitung
 * uebernimmt es nicht mehr. Bis Issue #2154 trug das Feld in Pro das Urteil des Pro-Teils
 * `build-verdict` (Issue #1976, #2017).
 */
async function vorbereitungPruefenAufruf(repoRoot, verwerfen) {
  const runner = await runnerLaden();
  if (verwerfen) {
    return runner ? { ok: true, ...runner.vorbereitungPruefen({ repoRoot, verwerfen }) } : { ok: true, verworfen: { datei: false, referenz: false } };
  }
  const lebt = typeof runner?.laufIdLebt === "function" ? (laufId) => runner.laufIdLebt(repoRoot, laufId) : null;
  const urteil = runner ? runner.vorbereitungPruefen({ repoRoot, lebt }) : ohneVorbereitung();
  return { ok: true, ...urteil, buildDienst: null };
}

// --- publish-state (Issue #2154, Plan #2145, E1, E12, E16, E18) ---
//
// `push main` prueft in Pro mit Build-Dienst nichts mehr selbst: Es liest hier den geprueften Stand
// und schiebt genau den gruen geprueften Commit, oder es nennt den Grund. Der gepruefte Commit
// entsteht in der Pruefung je Karte per cherry-pick auf `origin/<mainBranch>`; "enthalten" heisst
// darum Patch-Gleichheit ueber `git cherry`, nicht Vorfahrenschaft. Die Wahrheit ueber das Urteil
// ist der Pruefstatus am Commit im Build-Dienst; die Statusdatei der Pruefung je Karte nennt den
// Commit, seinen Pruefzweig, den Zeitpunkt des Uebertragens und was die Pruefung daneben fand.

/** Die Werte von `ergebnis`; `nichts`, wenn es nichts zu veroeffentlichen gibt. */
export const PUBLISH_ERGEBNISSE = Object.freeze(["gruen", "rot", "laeuft", "nicht-geprueft", "konflikt", "unvollstaendig", "nichts"]);

const kurz = (commit) => String(commit ?? "").slice(0, 12);

/** git in `repoRoot` mit Exit 0 erwartet; sonst wirft der Aufruf mit der Meldung von git. */
function gitOk(repoRoot, args) {
  const res = gitIm(repoRoot, args);
  if (res.status !== 0) throw new Error(`git ${args.join(" ")}: ${(res.stderr || res.stdout || "").trim()}`);
  return (res.stdout ?? "").trim();
}

const commitDa = (repoRoot, commit) => Boolean(commit) && gitIm(repoRoot, ["cat-file", "-e", `${commit}^{commit}`]).status === 0;

/**
 * Die Commits von `ref`, deren Patch `oben` nicht traegt (`git cherry <oben> <ref>` mit `+`), ohne
 * Release-Commits (E5): `[{ commit, betreff }]`.
 */
function fehlendePatches(repoRoot, teil, oben, ref) {
  const fehlend = [];
  for (const zeile of gitOk(repoRoot, ["cherry", oben, ref]).split("\n")) {
    if (!zeile.startsWith("+")) continue;
    const commit = zeile.slice(1).trim();
    const nachricht = gitOk(repoRoot, ["show", "-s", "--format=%B", commit]);
    if (!teil.istReleaseCommit(nachricht)) fehlend.push({ commit, betreff: nachricht.split(/\r?\n/)[0].trim() });
  }
  return fehlend;
}

const commitListe = (fehlend) => fehlend.map(({ commit, betreff }) => `${kurz(commit)} ${betreff}`).join("; ");

/**
 * Der Kit-Stand, mit dem `push main` arbeitet (E16): im Kit-Repo der lokale `<mainBranch>`, wie in
 * der Pruefung je Karte; in jedem anderen Projekt `null`. `kit` sind `kitStandErmitteln` und
 * `kitStandZeile` des Runners; ohne ihn `null`.
 */
function kitStandMelden(repoRoot, mainBranch, kit) {
  if (typeof kit?.kitStandErmitteln !== "function") return null;
  try {
    const stand = kit.kitStandErmitteln(repoRoot, mainBranch, "card-check");
    return stand ? { commit: stand.commit, ref: stand.ref, zeile: kit.kitStandZeile(stand) } : null;
  } catch (err) {
    return { commit: null, ref: null, zeile: null, fehler: err.message };
  }
}

/** Ein rotes Urteil allein aus abgebrochenen Jobs ist kein Urteil (E18). */
function nurAbgebrochen(jobs) {
  const rote = jobs.filter((j) => j.ergebnis === "rot");
  return rote.length > 0 && rote.every((j) => j.abgebrochen === true);
}

/**
 * Das Urteil des Build-Diensts ueber `commit` (E12, E18), mit den Fristen der Pruefung je Karte
 * nachgerechnet ab dem Uebertragen, ohne festgehaltenes Uebertragen ab der Commit-Zeit: Auch wenn
 * der Pruefprozess nicht mehr lebt, bleibt ein Stand ohne Lauf oder Ergebnis nie `laeuft`.
 * Rueckgabe `{ ergebnis, ursache, jobs, adresse, rot }`.
 */
async function urteilAmCommit({ repoRoot, config, teil, pruefung, commit, u }) {
  const nicht = (ursache, felder = {}) => ({ ergebnis: "nicht-geprueft", ursache, jobs: [], adresse: pruefung.adresse ?? null, rot: [], ...felder });
  let host;
  try {
    host = await u.codeHost(config);
  } catch (err) {
    return nicht(t("psAbfrage", { fehler: err.message.split("\n")[0] }));
  }
  if (typeof host?.getCiStatus !== "function") return nicht(t("psOhneHost", { host: config?.codeHost ?? "?" }));
  let ci;
  try {
    ci = await host.getCiStatus(commit, pruefung.zweig);
  } catch (err) {
    return nicht(t("psAbfrage", { fehler: err.message.split("\n")[0] }));
  }
  const jobs = Array.isArray(ci?.jobs) ? ci.jobs : [];
  const adresse = ci?.adresse ?? pruefung.adresse ?? null;
  const seit = Date.parse(pruefung.gepusht ?? gitOk(repoRoot, ["show", "-s", "--format=%cI", commit]));
  const vergangen = u.jetzt() - seit;
  const minuten = (ms) => Math.round(ms / 60_000);
  const roteJobs = jobs.filter((j) => j.ergebnis === "rot" && j.abgebrochen !== true);
  if (roteJobs.length > 0) {
    const rot = pruefung.commit === commit && pruefung.rot?.length ? pruefung.rot : roteJobs.map((j) => j.name);
    return { ergebnis: "rot", ursache: t("psRot", { rot: rot.join(", ") }), jobs, adresse, rot };
  }
  if (jobs.length === 0) {
    if (vergangen >= teil.FRIST_LAUF_MS) return nicht(t("psKeinLauf", { zweig: pruefung.zweig, minuten: minuten(teil.FRIST_LAUF_MS) }), { adresse });
    return { ergebnis: "laeuft", ursache: t("psWartetAufLauf", { zweig: pruefung.zweig }), jobs, adresse, rot: [] };
  }
  if (jobs.some((j) => j.ergebnis === "laeuft")) {
    if (vergangen >= teil.FRIST_ABSCHLUSS_MS) return nicht(t("psKeinErgebnis", { minuten: minuten(teil.FRIST_ABSCHLUSS_MS) }), { jobs, adresse });
    return { ergebnis: "laeuft", ursache: t("psLaeuft", { commit: kurz(commit) }), jobs, adresse, rot: [] };
  }
  if (nurAbgebrochen(jobs)) return nicht(t("psAbgebrochen"), { jobs, adresse });
  return { ergebnis: "gruen", ursache: null, jobs, adresse, rot: [] };
}

/** Das Urteil einer Pruefung auf diesem Rechner (ohne Build-Dienst, E17) aus der Statusdatei. */
function urteilLokal({ repoRoot, teil, pruefung, u }) {
  const felder = { jobs: [], adresse: null, rot: pruefung.rot ?? [] };
  if (pruefung.ergebnis === "gruen") return { ergebnis: "gruen", ursache: null, ...felder };
  if (pruefung.ergebnis === "rot") return { ergebnis: "rot", ursache: t("psRot", { rot: felder.rot.join(", ") }), ...felder };
  if (teil.pruefungLaeuft(repoRoot, { lebt: u.lebt }).laeuft) return { ergebnis: "laeuft", ursache: t("psLaeuftLokal"), ...felder };
  return { ergebnis: "nicht-geprueft", ursache: pruefung.ursache ?? t("psLokalOhne"), ...felder };
}

/** Der naechste Schritt zu einem Ergebnis; ein Umgebungsfund hat genau einen, den Handgriff (E9). */
function naechsterSchritt({ ergebnis, commit, mainBranch, sicherheit, handgriff, reparatur, kommando }) {
  if (handgriff) return handgriff;
  if (ergebnis === "gruen") {
    const push = t("psSchrittGruen", { commit, haupt: mainBranch });
    return sicherheit?.ergebnis === "gruen" ? push : t("psSchrittOhneSicherheit", { push, sicherheit: sicherheit?.ergebnis ?? t("psKeineSicherheit") });
  }
  if (ergebnis === "rot") {
    if (reparatur?.length) return t("psSchrittReparatur", { karten: reparatur.map((r) => `#${r.karte}`).join(", ") });
    return t("psSchrittRot", { kommando });
  }
  if (ergebnis === "laeuft") return t("psSchrittLaeuft");
  if (ergebnis === "nichts") return t("psSchrittNichts");
  if (ergebnis === "konflikt") return t("psSchrittKonflikt", { kommando });
  return kommando;
}

/**
 * Beurteilt den geprueften Commit, der alle lokalen Commits schon enthaelt (E12): Konflikt, ein
 * Stand, der nie uebertragen wurde, fehlende fremde Koepfe, kein Fast-Forward, sonst das Urteil des
 * Build-Diensts. Rueckgabe `[ergebnis, felder]`.
 */
async function geprueftenCommitBeurteilen({ repoRoot, config, teil, status, commit, fremde, basis, mainBranch, u }) {
  const pruefung = status.pruefung;
  const sicherheit = status.sicherheit?.commit === commit
    ? { ergebnis: status.sicherheit.ergebnis, ursache: status.sicherheit.ursache ?? null, befunde: status.sicherheit.befunde ?? [] }
    : null;
  const kopf = { commit, karten: pruefung.karten ?? [], adresse: pruefung.adresse ?? null, sicherheit, handgriff: pruefung.handgriff ?? null };
  if (pruefung.ergebnis === "konflikt" || pruefung.konflikt?.length) {
    const konflikte = (pruefung.konflikt ?? []).map(({ zweig, dateien }) => t("psKonflikt", { zweig, dateien: (dateien ?? []).join(", ") }));
    return ["konflikt", { ...kopf, ursache: [pruefung.ursache, ...konflikte].filter(Boolean).join("; ") }];
  }
  if (pruefung.ergebnis === "nicht-geprueft" && !pruefung.gepusht) {
    return ["nicht-geprueft", { ...kopf, ursache: pruefung.ursache ?? t("psKeinePruefung") }];
  }
  for (const ref of fremde) {
    const fehlt = fehlendePatches(repoRoot, teil, commit, ref);
    if (fehlt.length > 0) return ["unvollstaendig", { ...kopf, ursache: t("psFremdFehlt", { commit: kurz(commit), zweig: ref, commits: commitListe(fehlt) }) }];
  }
  if (gitIm(repoRoot, ["merge-base", "--is-ancestor", basis, commit]).status !== 0) {
    return ["nicht-geprueft", { ...kopf, ursache: t("psKeinFastForward", { commit: kurz(commit), haupt: mainBranch }) }];
  }
  const urteil = pruefung.zweig
    ? await urteilAmCommit({ repoRoot, config, teil, pruefung, commit, u })
    : urteilLokal({ repoRoot, teil, pruefung, u });
  return [urteil.ergebnis, {
    ...kopf, jobs: urteil.jobs, adresse: urteil.adresse ?? kopf.adresse, ursache: urteil.ursache,
    reparatur: urteil.ergebnis === "rot" ? pruefung.reparatur : null,
  }];
}

/**
 * `publish-state` (E12): fetcht und meldet den Stand, den `push main` veroeffentlichen darf.
 * `gruen` nur, wenn der Build-Dienst den Commit gruen meldet, der Commit jeden lokalen Commit und
 * den Kopf jedes fremden Pruefzweigs als Patch enthaelt (Release-Commits ausgenommen) und ein
 * Fast-Forward von `origin/<mainBranch>` ist. Unveroeffentlichte Commits ohne Pruefung sind
 * `nicht-geprueft` mit dem Weg `--card-check --again` (E1): Ohne eingehaengtes Commit-Gate startet
 * kein Hook eine Pruefung. Prueft nichts selbst und startet nichts.
 *
 * `teil` ist der Pro-Teil `card-check`, `kit` der Runner fuer den Kit-Stand (oder `null`);
 * `umgebung` ersetzt Code-Host, Uhr, Lebenspruefung und Rechner fuer Tests.
 */
export async function veroeffentlichungsStand({ repoRoot, config, teil, kit = null, umgebung = {} }) {
  const u = {
    codeHost: async (cfg) => (await import(new URL("./board/adapter.mjs", import.meta.url).href)).resolveCodeHost(cfg),
    jetzt: Date.now, lebt: undefined, rechner: undefined, ...umgebung,
  };
  const mainBranch = config?.mainBranch || "main";
  const basis = `origin/${mainBranch}`;
  const kommando = teil.ERNEUT_KOMMANDO;
  const kitStand = kitStandMelden(repoRoot, mainBranch, kit);
  // Der eigene Pruefzweig: `push main` loescht nach dem Push nur ihn, mit Lease auf `commit` (Issue #2157).
  const zweig = teil.eigenerPruefzweig(config, u.rechner ? { rechner: u.rechner } : {});
  const melden = (ergebnis, felder = {}) => {
    const stand = {
      ok: true, ergebnis, commit: null, zweig, karten: [], jobs: [], adresse: null, sicherheit: null, kitStand, handgriff: null, ursache: null, ...felder,
    };
    stand.naechsterSchritt = naechsterSchritt({ ...stand, mainBranch, kommando, reparatur: felder.reparatur });
    delete stand.reparatur;
    return stand;
  };

  const abruf = gitIm(repoRoot, ["fetch", "-q", "--prune", "origin"]);
  if (abruf.status !== 0) return melden("nicht-geprueft", { ursache: t("psAbruf", { fehler: (abruf.stderr || "").trim().split("\n").at(-1) }) });
  if (gitIm(repoRoot, ["rev-parse", "--verify", "-q", basis]).status !== 0) return melden("nicht-geprueft", { ursache: t("psBasisFehlt", { haupt: mainBranch }) });

  const fremde = teil.fremdeZweige(repoRoot, config?.pushPruefung?.zweig, zweig)
    .filter((ref) => fehlendePatches(repoRoot, teil, basis, ref).length > 0);
  const eigeneOffen = fehlendePatches(repoRoot, teil, basis, mainBranch);
  if (eigeneOffen.length === 0 && fremde.length === 0) return melden("nichts", { ursache: t("psNichts", { haupt: mainBranch }) });

  const status = teil.statusLesen(repoRoot);
  const pruefung = status.pruefung ?? null;
  const commit = commitDa(repoRoot, pruefung?.commit) ? pruefung.commit : null;
  const eigeneFehlen = commit ? fehlendePatches(repoRoot, teil, commit, mainBranch) : eigeneOffen;
  if (eigeneFehlen.length > 0) {
    const { karten } = teil.buendelErmitteln(repoRoot, { basis, commit: mainBranch });
    const lauf = teil.pruefungLaeuft(repoRoot, { lebt: u.lebt });
    if (lauf.laeuft) return melden("laeuft", { commit, karten, ursache: t("psNachlauf", { pid: lauf.pid, commits: commitListe(eigeneFehlen) }) });
    return melden("nicht-geprueft", { commit, karten, ursache: t("psUngeprueft", { commits: commitListe(eigeneFehlen) }) });
  }

  const [ergebnis, felder] = await geprueftenCommitBeurteilen({ repoRoot, config, teil, status, commit, fremde, basis, mainBranch, u });
  return melden(ergebnis, felder);
}

/**
 * Der Aufruf `publish-state`: laedt den Pro-Teil `card-check` und den Runner fuer den Kit-Stand.
 * In Community gibt es keinen geprueften Stand (`ergebnis: null`), und `push main` prueft selbst.
 * Den Kit-Stand nennt das Kommando zusaetzlich als Zeile vor der JSON-Zeile (E16).
 */
async function veroeffentlichungsStandAufruf(repoRoot) {
  const teil = await kartenpruefungLaden(repoRoot);
  if (!teil) {
    return {
      ok: true, ergebnis: null, commit: null, zweig: null, karten: [], jobs: [], adresse: null, sicherheit: null, kitStand: null, handgriff: null,
      ursache: null, naechsterSchritt: t("psCommunity"),
    };
  }
  const runner = await runnerLaden();
  const stand = await veroeffentlichungsStand({ repoRoot, config: configVonPlatte(repoRoot) ?? {}, teil, kit: runner });
  if (stand.kitStand?.zeile) process.stdout.write(`${stand.kitStand.zeile}\n`);
  return stand;
}

/**
 * `clean-check-branch` (Issue #1973, Plan #1965, E8): holt die Freigabe des Pruefzweigs nach,
 * die dem Runner nicht gelang. Geloescht wird nur mit Lease auf den Commit aus
 * `PRUEFZWEIG_OFFEN_DATEI` — steht am Server ein fremder Stand, laeuft dort womoeglich ein
 * fremder Prueflauf, und der Zweig bleibt unveraendert. Der Stand am Server wird vorher mit
 * `git ls-remote` gelesen, damit die Ausgabe den fremden Stand nennen kann; die Lease beim
 * Loeschen schuetzt auch dann, wenn er sich dazwischen aendert. mainBranch und
 * productionBranch loescht es nie (Exit 1). Ohne Datei ist nichts offen, und es pusht nichts.
 *
 * Rueckgabe: `{ ok, bereinigt, zweig, grund }`. Die Datei verschwindet nur, wenn der Zweig
 * danach frei ist; sonst bleibt die Bereinigung offen und Exitcode 0 — das Urteil steht in
 * `bereinigt`.
 */
async function pruefzweigBereinigen(repoRoot) {
  const offen = pruefzweigOffenLesen(repoRoot);
  if (!offen) return { ok: true, bereinigt: false, zweig: null, grund: t("pruefzweigNichtsOffen") };
  const { zweig, commit } = offen;
  const cfg = configVonPlatte(repoRoot) ?? {};
  if ([cfg.mainBranch || "main", cfg.productionBranch].includes(zweig)) throw new Error(t("pruefzweigGeschuetzt", { zweig }));
  const nichtBereinigt = (grund) => ({ ok: true, bereinigt: false, zweig, grund: t("pruefzweigServer", { zweig, grund }) });
  const frei = (grund) => {
    rmSync(pfadIn(repoRoot, PRUEFZWEIG_OFFEN_DATEI), { force: true });
    return { ok: true, bereinigt: true, zweig, grund };
  };

  const stand = spawnSync("git", ["ls-remote", "origin", `refs/heads/${zweig}`], { cwd: repoRoot, encoding: "utf-8" });
  if (stand.status !== 0) return nichtBereinigt((stand.stderr || stand.error?.message || "").trim());
  const amServer = stand.stdout.trim().split(/\s+/)[0] || null;
  if (!amServer) return frei(t("pruefzweigSchonFrei", { zweig }));
  if (amServer !== commit) {
    return { ok: true, bereinigt: false, zweig, grund: t("pruefzweigFremd", { zweig, fremd: amServer.slice(0, 12), commit: commit.slice(0, 12) }) };
  }

  const { resolveCodeHost } = await import(new URL("./board/adapter.mjs", import.meta.url).href);
  const host = resolveCodeHost(cfg);
  if (typeof host.deleteRef !== "function") return nichtBereinigt(t("pruefzweigOhneHost", { host: cfg.codeHost }));
  // deleteRef pusht im aktuellen Verzeichnis; das Kommando darf auch im Worktree laufen.
  process.chdir(repoRoot);
  try {
    await host.deleteRef(zweig, commit);
  } catch (err) {
    return nichtBereinigt(err.message);
  }
  return frei(t("pruefzweigBereinigt", { zweig, commit: commit.slice(0, 12) }));
}

/**
 * `im <pfad> -- <kommando> [argumente]` (Issue #1372): Die Release-Skills fahren die
 * Schritte aus RELEASING.md im Worktree, ohne `cd`. Claude Code setzt das
 * Arbeitsverzeichnis ausserhalb der erlaubten Verzeichnisse nach jedem Aufruf zurueck, und
 * `cd <pfad> && …` fiele nicht mehr unter `sandbox.excludedCommands`. Gestartet wird ohne
 * Shell — die Argumente gehen woertlich durch —, mit geerbter Ausgabe; der Rueckgabewert
 * ist der Exitcode des Kommandos.
 */
function imWorktree(cliArgs) {
  const [pfad, trenner, programm, ...argumente] = cliArgs;
  if (!pfad || pfad === "--" || trenner !== "--" || !programm) {
    throw new Error(t("imForm"));
  }
  if (!existsSync(pfad) || !statSync(pfad).isDirectory()) throw new Error(t("imKeinVerzeichnis", { pfad }));
  const res = spawnSync(programm, argumente, { cwd: pfad, stdio: "inherit" });
  if (res.error) throw new Error(t("imStart", { programm, grund: res.error.message }));
  return res.status ?? 1;
}

async function fuehreAus(kommando, cliArgs) {
  altnameAbweisen(ALTE_BEFEHLE, kommando);
  for (const arg of cliArgs) altnameAbweisen(ALTE_OPTIONEN, arg);
  if (kommando === "catch-up-check") return { ok: true, ...nachziehenPruefen(repoWurzel()) };
  if (kommando === "create") return anlegen(repoWurzel(), cliArgs);
  if (kommando === "remove") return entfernen(repoWurzel(), cliArgs);
  if (kommando === "return") return rueckweg(repoWurzel(), cliArgs);
  if (kommando === "record-preparation") return vorbereitungFesthaltenAufruf(repoWurzel(), cliArgs);
  // Das Urteil traegt das Feld `mutation` mit (Issue #1673, Plan #1671, E4): `/push-main`
  // nennt bei einer Uebernahme den Mutationstest der Vorbereitung, statt ihn neu zu fahren.
  if (kommando === "check-preparation") return vorbereitungPruefenAufruf(repoWurzel(), cliArgs.includes("--discard"));
  if (kommando === "clean-check-branch") return pruefzweigBereinigen(repoWurzel());
  if (kommando === "attempt") return anlaufFesthalten(repoWurzel(), cliArgs);
  if (kommando === "publish-state") return veroeffentlichungsStandAufruf(repoWurzel());
  throw new Error(t("unbekannt", { kommando }));
}

// Die Hilfe gibt es genau einmal, englisch, in jedem Projekt (Issue #1564, Plan #1548 E7).
function hilfe() {
  return `worktree.mjs (claude-workflow-kit v${KIT_VERSION}) — worktree for the release skills

  create [--prefix <p>] [--ref <ref>] [--issue <n>]     Worktree on <ref> (default HEAD),
      [--pristine]                                      then the installCommand of the config
                                                        --pristine: every versioned file as in
                                                        <ref>, installCommand from <ref>, not
                                                        from the main copy
  remove <path>                                         Tear down the worktree
  catch-up-check                                        May the local main be rebased?
  return <path>                                         Summary, executions, findings back
  record-preparation <path> --result <${Object.keys(ERGEBNIS_WERTE).join("|")}>
      [--open "<text>"]... [--fetch <${Object.keys(FETCH_WERTE).join("|")}>]
      [--security <result>]
                                                        Records the push preparation:
                                                        reference refs/kit/push-vorbereitet on
                                                        HEAD of the worktree, file
                                                        .claude/push-vorbereitung.json;
                                                        --security: the field ergebnis of
                                                        issue-review security-result as it is,
                                                        valid for exactly that commit
  check-preparation [--discard]                         May /push-main take over the prepared
                                                        state? No git fetch of its own.
                                                        Field mutation: the mutation test of
                                                        the preparation run, or null
                                                        Reason sicherheit: no green security
                                                        review for the prepared commit
                                                        --discard deletes file and reference
  attempt --base <sha> --commit <sha>                   Records one attempt of push main in
      --result <${Object.keys(ANLAUF_WERTE).join("|")}>
      [--reason <text>]                                 .claude/veroeffentlichungen.tsv of the
                                                        main copy: time, base, commit, result,
                                                        reason; attempts with the same base
                                                        count as one publication up to the
                                                        first pushed
  clean-check-branch                                    Catches up on the release of the check
                                                        branch from .claude/pruefzweig-offen.json:
                                                        deletes it on origin only with lease on
                                                        the recorded commit, never mainBranch or
                                                        productionBranch; fields bereinigt,
                                                        zweig, grund
  publish-state                                         The checked state for push main (Pro):
                                                        fetches, then JSON with ergebnis,
                                                        commit, zweig, karten, jobs, adresse,
                                                        sicherheit, kitStand, handgriff,
                                                        ursache, naechsterSchritt; checks and
                                                        starts nothing itself
  in <path> -- <command> [arguments]                    Starts <command> with <path> as
                                                        working directory, without a shell; output
                                                        and exit code of the command pass through

The last line of the output is always JSON — except for 'in', which passes the output of
the command through and writes JSON only on an error of its own.
`;
}

async function main() {
  const [kommando, ...cliArgs] = process.argv.slice(2);
  if (!kommando || kommando === "--help" || kommando === "-h") {
    process.stdout.write(hilfe());
    return;
  }
  try {
    if (kommando === "in") {
      process.exitCode = imWorktree(cliArgs);
      return;
    }
    process.stdout.write(`${JSON.stringify(await fuehreAus(kommando, cliArgs))}\n`);
  } catch (err) {
    process.stdout.write(`${JSON.stringify({ ok: false, fehler: err.message })}\n`);
    process.exit(1);
  }
}

// Nur als CLI ausfuehren, nicht beim Import (z. B. durch die node:test-Suite).
// realpathSync statt resolve: Node loest fuer import.meta.url Symlinks auf (macOS:
// /var -> /private/var), ein nur normalisierter argv[1] wuerde dann nie matchen.
let runAsCli = false;
if (process.argv[1]) {
  try {
    runAsCli = realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch { /* argv[1] nicht aufloesbar -> kein CLI-Start */ }
}
if (runAsCli) await main();
