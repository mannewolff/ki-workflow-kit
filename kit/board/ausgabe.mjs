// SPDX-License-Identifier: MIT
/**
 * board/ausgabe.mjs — die Grenze zwischen Community und Pro an einer Stelle (Issue #1867,
 * Plan #1866 E1 bis E4, E9, E14): welche Ausgabe eine Installation ist, die Pro-Meldung, die
 * Liste der Pro-Einstellungen und die Zeile der uebergangenen Einstellungen.
 *
 * Jede Verzweigung der Aufrufer greift nur bei `community`; fehlt die Angabe, gilt `pro`
 * (Kriterium 7). Aufrufer im Kit lesen diese Logik ueber kit/board/pro.mjs, das sie
 * weiterreicht und die Meldungen in der Projektsprache bildet.
 *
 * Dieser Teil importiert nur `node:*`. Der Installer laedt ihn ueber `ladeTeil` als `data:`-URL,
 * ohne Nachbarn; ein relativer Import liefe dort ins Leere. Meldungen liefert er darum als
 * Schluessel und Werte, die Texte stehen in kit/texte/board-pro.mjs. Englische Namen der
 * Einstellungen kennt er nur, wenn der Aufrufer die Config zuvor durch `mitEnglischenNamen`
 * aus kit/board/config-namen.mjs gereicht hat.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Die Seite zu Pro je Sprache (E14). */
const PRO_SEITE = Object.freeze({ de: "https://docs.mwolff.org/pro", en: "https://docs.mwolff.org/en/pro" });

/**
 * Die Pro-Funktionen, vor die ein Skript `edition gate` stellt (E4). Runner, Kette, Prueflauf,
 * die Vorbereitung von `push main` und der Vergleich der Pruefbereiche sind seit Issue #2012
 * Community (Plan #2008 A7) und haben kein Tor mehr; `doctor` und das eigene Aktualisieren
 * `update` sind seit Issue #2014 Pro, das gleichzeitige Umsetzen `parallel` seit Issue #2015, die
 * Pruefplaetze je Rechner `check-slots` seit Issue #2016, die Uebernahme des Urteils des
 * Build-Diensts in `push main` `build-verdict` seit Issue #2017, `hotfix` und das Zurueckkehren
 * `rollback` seit Issue #2053 (Plan #2038 A5).
 */
export const PRO_FUNKTIONEN = Object.freeze(["app", "doctor", "update", "parallel", "check-slots", "build-verdict", "hotfix", "rollback"]);

/**
 * Die Pro-Einstellungen (E3) mit englischem Namen, als Pfad in der Config oder als Name einer
 * Umgebungsvariable. Paarungen, Pruefstufen, die uebrigen `night.*`, `checkRun` und
 * `KIT_PLAN_REVIEWER` sind seit Issue #2012 Community; `night.concurrentPackages` gehoert seit
 * Issue #2015 zum Pro-Teil `parallel`, `KIT_FULL_CHECKS_MAX` und `KIT_FULL_CHECKS_DIR` seit Issue
 * #2016 zum Pro-Teil `check-slots`, `hotfixMinutes` und `runsInstance` seit Issue #2050 zu Hotfix und
 * Zurueckkehren. Weitere Namen, die eine Pro-Erweiterung uebergeht, reicht der
 * Aufrufer als `zusaetzlich`.
 */
export const PRO_EINSTELLUNGEN = Object.freeze(["night.concurrentPackages", "KIT_FULL_CHECKS_MAX", "KIT_FULL_CHECKS_DIR", "hotfixMinutes", "runsInstance"]);

/**
 * Die Pro-Teile (E1), Pfade relativ zum Repo des Kits. `dateien` sind feste Dateien, die erste
 * ist die Hauptdatei, an der `proVorhanden` den Teil erkennt; `muster` sind Verzeichnisse
 * (mit `/` am Ende) und Dateimuster mit `*`.
 * `installiert: false` kennzeichnet einen Teil ohne installierte Datei: Er kommt als Download
 * (`STAMPED_DOWNLOADS` in tools/sync-blobs.mjs), `proVorhanden` gilt fuer ihn nicht.
 *
 * Runner, die Auswertungen `effort`, `effectiveness` und `findings` und der Vergleich der
 * Pruefbereiche sind seit Issue #2012 Community (Plan #2008 A1); die Auswertungen startet
 * `pro run` weiter ueber die Liste `AUSWERTUNGEN` in kit/board/pro.mjs (E3). `doctor` und das
 * eigene Aktualisieren samt Projektliste sind seit Issue #2014 Pro (Plan #2008 A2), das
 * gleichzeitige Umsetzen mehrerer Pakete in eigenen Arbeitskopien seit Issue #2015 (A3), die
 * Plaetze fuer volle Prueflaeufe je Rechner seit Issue #2016 (A3, E1), das Urteil des
 * Build-Diensts ueber den vorbereiteten Stand seit Issue #2017 (A2, A3, E2), der Produktionsstand
 * fuer Hotfix und Zurueckkehren seit Issue #2052 (Plan #2038 A5), die Pruefung je Karte seit Issue
 * #2149 (Plan #2145).
 */
export const PRO_TEILE = Object.freeze({
  settings: Object.freeze({
    dateien: Object.freeze(["kit/settings.mjs"]),
    muster: Object.freeze([]),
    installiert: false,
  }),
  deployment: Object.freeze({
    dateien: Object.freeze(["kit/deployment.mjs"]),
    muster: Object.freeze([]),
    installiert: false,
  }),
  // Die Achse `app` fuer die Desktop-App (Issue #1898, Plan #1895 A11), installiert mit Pro.
  app: Object.freeze({
    dateien: Object.freeze(["kit/board/app.mjs", "kit/texte/board-app.mjs"]),
    muster: Object.freeze([]),
  }),
  // Die Achse `doctor` (Issue #2014, Plan #2008 A2).
  doctor: Object.freeze({
    dateien: Object.freeze(["kit/board/doctor.mjs", "kit/texte/board-doctor.mjs"]),
    muster: Object.freeze([]),
  }),
  // Die Achse `update`: Projekt, alle Projekte und die Projektliste (Issue #2014, Plan #2008 A2).
  update: Object.freeze({
    dateien: Object.freeze(["kit/board/update.mjs", "kit/board/projektliste.mjs", "kit/texte/board-update.mjs"]),
    muster: Object.freeze([]),
  }),
  // Die Achse `parallel`: das gleichzeitige Umsetzen im Runner (Issue #2015, Plan #2008 A3).
  parallel: Object.freeze({
    dateien: Object.freeze(["kit/night/gleichzeitig.mjs", "kit/texte/night-gleichzeitig.mjs"]),
    muster: Object.freeze([]),
  }),
  // Die Achse `check-slots`: die Plaetze fuer volle Prueflaeufe je Rechner (Issue #2016, Plan #2008 A3, E1).
  "check-slots": Object.freeze({
    dateien: Object.freeze(["kit/checks/pruefplaetze.mjs"]),
    muster: Object.freeze([]),
  }),
  // Die Achse `build-verdict`: das Urteil des Build-Diensts in `push main` (Issue #2017, Plan #2008 A2, A3, E2).
  "build-verdict": Object.freeze({
    dateien: Object.freeze(["kit/board/build-dienst.mjs"]),
    muster: Object.freeze([]),
  }),
  // Die Achse `card-check`: die Pruefung je fertiger Karte (Issue #2149, Plan #2145 E2 bis E5), geladen
  // ueber `proLaden` wie `build-verdict`.
  "card-check": Object.freeze({
    dateien: Object.freeze(["kit/night/kartenpruefung.mjs", "kit/texte/night-kartenpruefung.mjs"]),
    muster: Object.freeze([]),
  }),
  // Der Produktionsstand fuer Hotfix und Zurueckkehren in `refs/kit/produktion` (Issue #2052, Plan #2038 A3, A5).
  production: Object.freeze({
    dateien: Object.freeze(["kit/board/produktion.mjs", "kit/texte/board-produktion.mjs"]),
    muster: Object.freeze([]),
  }),
});

/** Die Beigaben, die allein Pro ausliefert: der Lizenztext von Pro (Plan #1918, E11). */
export const PRO_BEIGABEN = Object.freeze(["LICENSE-PRO"]);

const liesUtf8 = (pfad) => readFileSync(pfad, "utf-8");

/**
 * Die Ausgabe der Installation unter `wurzel`: `community` oder `pro`, gelesen an `KIT_AUSGABE` in
 * `<wurzel>/.claude/kit/board/fassung.mjs`. Fehlt Datei oder Konstante, gilt `pro`.
 *
 * SYNC: installierteAusgabe in kit/board/fassung.mjs.
 */
export function ausgabe({ wurzel, liesDatei = liesUtf8 } = {}) {
  let inhalt = "";
  try {
    inhalt = liesDatei(join(wurzel, ".claude", "kit", "board", "fassung.mjs"));
  } catch {
    // keine installierte Kopie: Vorgabe
  }
  return /^export const KIT_AUSGABE = "community";$/m.test(inhalt ?? "") ? "community" : "pro";
}

/** Die Adresse der Seite zu Pro in der Projektsprache, ohne Sprache deutsch. */
export function proSeite(sprache = "de") {
  return PRO_SEITE[sprache] ?? PRO_SEITE.de;
}

/**
 * Die Pro-Meldung zu einer Funktion (E14) als Textschluessel, Schluessel des Funktionsnamens und
 * Adresse in der Projektsprache. Eine unbekannte Funktion wirft.
 */
export function proMeldung(funktion, { sprache = "de" } = {}) {
  if (!PRO_FUNKTIONEN.includes(funktion)) {
    throw new Error(`ausgabe: keine Pro-Funktion "${funktion}" (bekannt: ${PRO_FUNKTIONEN.join(", ")})`);
  }
  return { schluessel: "proMeldung", funktion: `funktion_${funktion}`, url: proSeite(sprache) };
}

const istObjekt = (wert) => typeof wert === "object" && wert !== null && !Array.isArray(wert);

/** Stellt der Wert etwas ein? Fehlend, `null` und leere Bloecke tun es nicht. */
function eingestellt(wert) {
  if (wert === undefined || wert === null || wert === "") return false;
  if (Array.isArray(wert)) return wert.length > 0;
  if (istObjekt(wert)) return Object.keys(wert).length > 0;
  return true;
}

/** Ein Name aus `PRO_EINSTELLUNGEN`, der eine Umgebungsvariable ist und kein Pfad in der Config. */
const UMGEBUNGS_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * Die Pro-Einstellungen, die in `config` (englische Namen) oder in `env` (die Umgebung) stehen,
 * in der Reihenfolge von `PRO_EINSTELLUNGEN`, danach `zusaetzlich`. Ob sie uebergangen werden,
 * sagt die Ausgabe; diese Funktion fragt sie nicht.
 */
export function uebergangeneEinstellungen(config, { env = process.env, zusaetzlich = [] } = {}) {
  const wertAn = (pfad) => pfad.split(".").reduce((wert, teil) => (istObjekt(wert) ? wert[teil] : undefined), config);
  const ausUmgebung = (name) => (typeof env?.[name] === "string" ? env[name].trim() : undefined);
  const wert = (name) => (UMGEBUNGS_NAME.test(name) ? ausUmgebung(name) : wertAn(name));
  return [...PRO_EINSTELLUNGEN.filter((name) => eingestellt(wert(name))), ...zusaetzlich];
}

/** Die Zeile der uebergangenen Einstellungen (E9): ohne Namen keine, sonst Schluessel und Namen. */
export function uebergangenZeile(namen) {
  if (!Array.isArray(namen) || namen.length === 0) return null;
  return { schluessel: "uebergangen", namen: namen.join(", ") };
}
