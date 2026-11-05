// SPDX-License-Identifier: MIT
/**
 * board/strenge.mjs — die Strenge eines Projekts und was sie vorgibt (Issue #2105, Plan #2102
 * A1 bis A4, A11).
 *
 * Jedes Projekt hat eine Strenge `leicht`, `normal` oder `streng` (in der Datei `strictness`
 * mit `light`, `normal`, `strict`). Was sie beim Veroeffentlichen bedeutet, steht allein hier
 * (A2): `strengeVorgaben` liefert die wirksamen Schalter samt der Liste, wo das Projekt von
 * seiner Strenge abweicht. `checks.mjs`, `board.mjs`, die Skills, die Einrichtung und die App
 * lesen diese Ableitung, statt die Strenge selbst auszulegen. Intern heisst die Groesse
 * `strenge`, nie `stufe` — `stufe` ist die Pruefstufe paket/push/merge (A1).
 *
 * Erwartet wird die Config, wie der Bestand sie liest: mit deutschen Schluesseln und Werten
 * (`normalisiereConfig` aus config-namen.mjs).
 *
 * Dieses Modul importiert nur Node-Bordmittel, damit tools/sync-blobs.mjs es in
 * kit/settings.mjs einbetten kann wie config-namen.mjs.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

/** Die Strengen, von der mildesten zur strengsten. */
export const STRENGEN = Object.freeze(["leicht", "normal", "streng"]);

/** Die Strenge eines Projekts ohne Eintrag (Kriterium 9 aus #2100: bestehende Projekte). */
export const STRENGE_VORGABE = "normal";

/**
 * Je Schalter seine Werte, vom schwaechsten zum strengsten; daran misst `strengeVergleich` eine
 * Abschwaechung. `pruefer` (Zahl je Pruefstufe oder `null` fuer unveraendert) und
 * `auslieferungNachholen` (bool) stehen nicht darin, sie vergleicht der Vergleich eigens.
 */
export const SCHALTER_WERTE = Object.freeze({
  pushUmfang: Object.freeze(["bereiche", "voll"]),
  mutation: Object.freeze(["aus", "bericht", "halt"]),
  guete: Object.freeze(["wie-eingerichtet", "pflicht"]),
  sicherheit: Object.freeze(["vor-auslieferung", "vor-push"]),
});

const SCHALTER = ["pushUmfang", "mutation", "guete", "sicherheit", "pruefer", "auslieferungNachholen"];

/** Die Pruefstufen, deren Prueferzahl die Strenge vorgeben kann. */
const PRUEFER_STUFEN = ["fachlich", "plan"];

// SYNC: die Prueferzahlen aus REVIEW_STUFEN_DEFAULT in kit/board/issue-review.mjs — die
// Besetzung eines Projekts ohne eigenen Block reviewStufen.
const REVIEWER_VORGABE = Object.freeze({ fachlich: 2, plan: 2, issue: 1 });

/** Vorgaben je Strenge (A4). `mutation bericht` wirkt nur, wenn ein Mutationstest eingerichtet ist. */
const VORGABEN = Object.freeze({
  leicht: Object.freeze({
    pushUmfang: "bereiche",
    mutation: "aus",
    guete: "wie-eingerichtet",
    sicherheit: "vor-auslieferung",
    pruefer: Object.freeze({ fachlich: 1, plan: 1 }),
    auslieferungNachholen: true,
  }),
  normal: Object.freeze({
    pushUmfang: "voll",
    mutation: "bericht",
    guete: "wie-eingerichtet",
    sicherheit: "vor-push",
    pruefer: null,
    auslieferungNachholen: false,
  }),
  streng: Object.freeze({
    pushUmfang: "voll",
    mutation: "halt",
    guete: "pflicht",
    sicherheit: "vor-push",
    pruefer: null,
    auslieferungNachholen: false,
  }),
});

const istObjekt = (w) => w !== null && typeof w === "object" && !Array.isArray(w);
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const istPrueferzahl = (w) => Number.isInteger(w) && w >= 1;

/** Der Wert eines Uebersteuerungs-Schalters, wenn er gueltig ist; sonst `undefined`. */
function uebersteuert(name, wert, vorgabe) {
  if (name === "auslieferungNachholen") return typeof wert === "boolean" ? wert : undefined;
  if (name === "pruefer") {
    if (!istObjekt(wert)) return undefined;
    const gesetzt = PRUEFER_STUFEN.filter((s) => istPrueferzahl(wert[s]));
    if (gesetzt.length === 0) return undefined;
    return Object.fromEntries(PRUEFER_STUFEN.map((s) => [s, istPrueferzahl(wert[s]) ? wert[s] : vorgabe?.[s] ?? null]));
  }
  return SCHALTER_WERTE[name].includes(wert) ? wert : undefined;
}

/**
 * Die wirksamen Vorgaben der Strenge eines Projekts (A2): `strenge`, `quelle` (`datei` oder
 * `vorgabe`), die Schalter `pushUmfang`, `mutation`, `guete`, `sicherheit`, `pruefer`,
 * `auslieferungNachholen` und `abweichungen` — je Schalter, der von der Vorgabe der Strenge
 * abweicht, `{ schalter, vorgabe, wert, quelle }`. Ein unbekannter Wert gilt als Normal und steht
 * in `unbekannt`.
 *
 * Uebersteuerung nach A3: Ein eigener Block `reviewStufen` laesst die Prueferzahl, wie das
 * Projekt sie besetzt; ein `guete`-Eintrag an einem buildCheck misst, wie er eingerichtet ist,
 * in jeder Strenge. Mutationstest und Sicherheitspruefung schaltet in Leicht allein ein Eintrag
 * in `strengeUebersteuerung` wieder ein, nicht schon ein eingerichteter `mutationCommand`. Ein
 * Eintrag in `strengeUebersteuerung` schlaegt jede andere Quelle; ein ungueltiger wirkt nicht.
 */
export function strengeVorgaben(config) {
  const c = istObjekt(config) ? config : {};
  const roh = c.strenge;
  const bekannt = STRENGEN.includes(roh);
  const strenge = bekannt ? roh : STRENGE_VORGABE;
  const vorgabe = VORGABEN[strenge];
  const wirksam = { ...vorgabe };
  const quellen = {};

  if (vorgabe.pruefer !== null && c.reviewStufen !== undefined && c.reviewStufen !== null) {
    wirksam.pruefer = null;
    quellen.pruefer = "reviewStufen";
  }
  const ueber = istObjekt(c.strengeUebersteuerung) ? c.strengeUebersteuerung : {};
  for (const name of SCHALTER) {
    const wert = uebersteuert(name, ueber[name], vorgabe[name]);
    if (wert === undefined) continue;
    wirksam[name] = wert;
    quellen[name] = "strengeUebersteuerung";
  }

  const abweichungen = SCHALTER.filter((name) => quellen[name] && !gleich(wirksam[name], vorgabe[name])).map((name) =>
    Object.freeze({ schalter: name, vorgabe: vorgabe[name], wert: wirksam[name], quelle: quellen[name] })
  );
  return Object.freeze({
    strenge,
    quelle: bekannt ? "datei" : "vorgabe",
    ...(roh !== undefined && !bekannt ? { unbekannt: roh } : {}),
    ...wirksam,
    pruefer: wirksam.pruefer === null ? null : Object.freeze({ ...wirksam.pruefer }),
    abweichungen: Object.freeze(abweichungen),
  });
}

/** Prueferzahl einer Pruefstufe, wie das Projekt sie ohne die Strenge besetzt. */
function besetzung(config, stufe) {
  const zahl = config.reviewStufen?.[stufe]?.reviewer;
  return Number.isInteger(zahl) ? zahl : REVIEWER_VORGABE[stufe];
}

function kommando(eintrag) {
  if (typeof eintrag === "string") return eintrag;
  return istObjekt(eintrag) ? eintrag.cmd : undefined;
}
const pruefungen = (config) => (Array.isArray(config.buildChecks) ? config.buildChecks : []).filter((e) => typeof kommando(e) === "string");
const marke = (block) => (istObjekt(block) && typeof block.marke === "number" ? block.marke : null);

/** Hat der Stand noch etwas, das vor der Auslieferung nachzuholen waere? */
const nachzuholen = (v) => v.pushUmfang === "bereiche" || v.sicherheit === "vor-auslieferung" || v.mutation === "aus";

function schalterAbschwaechungen(neuC, alt, neu) {
  const liste = [];
  const quelleVon = (name) => neu.abweichungen.find((a) => a.schalter === name)?.quelle ?? "strenge";
  for (const [name, werte] of Object.entries(SCHALTER_WERTE)) {
    if (werte.indexOf(neu[name]) < werte.indexOf(alt[name])) {
      liste.push({ feld: name, alt: alt[name], neu: neu[name], quelle: quelleVon(name) });
    }
  }
  // `null` laesst die Besetzung, wie das Projekt sie im neuen Stand traegt; eine Senkung allein
  // in reviewStufen meldet der Vergleich der Besetzung, nicht dieser Schalter.
  const zahl = (v, s) => v.pruefer?.[s] ?? besetzung(neuC, s);
  if (PRUEFER_STUFEN.some((s) => zahl(neu, s) < zahl(alt, s))) {
    liste.push({ feld: "pruefer", alt: alt.pruefer, neu: neu.pruefer, quelle: quelleVon("pruefer") });
  }
  if (alt.auslieferungNachholen && !neu.auslieferungNachholen && nachzuholen(neu)) {
    liste.push({ feld: "auslieferungNachholen", alt: true, neu: false, quelle: quelleVon("auslieferungNachholen") });
  }
  return liste;
}

function besetzungsAbschwaechungen(altC, neuC) {
  const liste = [];
  for (const stufe of Object.keys(REVIEWER_VORGABE)) {
    const vorher = besetzung(altC, stufe);
    const nachher = besetzung(neuC, stufe);
    if (nachher < vorher) liste.push({ feld: `reviewStufen.${stufe}`, alt: vorher, neu: nachher });
  }
  return liste;
}

function pruefungsAbschwaechungen(altC, neuC) {
  const liste = [];
  const neuePruefungen = new Map(pruefungen(neuC).map((e) => [kommando(e), e]));
  for (const eintrag of pruefungen(altC)) {
    const cmd = kommando(eintrag);
    const nachher = neuePruefungen.get(cmd);
    if (!nachher) {
      liste.push({ feld: "buildChecks", alt: cmd, neu: null });
      continue;
    }
    const vorher = marke(eintrag.guete);
    if (vorher === null) continue;
    const jetzt = marke(nachher.guete);
    if (jetzt === null) liste.push({ feld: "buildChecks[].guete", cmd, alt: vorher, neu: null });
    else if (jetzt < vorher) liste.push({ feld: "buildChecks[].guete.marke", cmd, alt: vorher, neu: jetzt });
  }
  return liste;
}

const hatMutation = (c) => typeof c.mutationCommand === "string" && c.mutationCommand.trim() !== "";

function mutationsAbschwaechungen(altC, neuC) {
  const liste = [];
  const vorher = marke(altC.mutationGuete);
  const jetzt = marke(neuC.mutationGuete);
  if (vorher !== null && jetzt === null) liste.push({ feld: "mutationGuete", alt: vorher, neu: null });
  else if (vorher !== null && jetzt < vorher) liste.push({ feld: "mutationGuete.marke", alt: vorher, neu: jetzt });
  if (hatMutation(altC) && !hatMutation(neuC)) liste.push({ feld: "mutationCommand", alt: altC.mutationCommand, neu: neuC.mutationCommand ?? null });
  return liste;
}

/**
 * Vergleicht zwei Stande der Config (A11): `richtung` (`steigt`, `sinkt` oder `gleich`, nach der
 * Strenge allein) und `abschwaechungen` — je Abschwaechung `{ feld, alt, neu }`, bei einem
 * Schalter dazu `quelle`. Abgeschwaecht sind eine gesunkene Strenge, ein milderer wirksamer
 * Schalter (gleich ob ueber die Strenge oder `strengeUebersteuerung`), weniger Pruefer, eine
 * gesenkte oder entfernte Marke (`buildChecks[].guete`, `mutationGuete`), ein entfernter
 * `mutationCommand` und jede entfernte Pruefung aus `buildChecks`.
 */
export function strengeVergleich(alt, neu) {
  const altC = istObjekt(alt) ? alt : {};
  const neuC = istObjekt(neu) ? neu : {};
  const vorher = strengeVorgaben(altC);
  const nachher = strengeVorgaben(neuC);
  const rang = STRENGEN.indexOf(nachher.strenge) - STRENGEN.indexOf(vorher.strenge);
  let richtung = "gleich";
  if (rang > 0) richtung = "steigt";
  else if (rang < 0) richtung = "sinkt";
  const abschwaechungen = [
    ...(rang < 0 ? [{ feld: "strenge", alt: vorher.strenge, neu: nachher.strenge }] : []),
    ...schalterAbschwaechungen(neuC, vorher, nachher),
    ...besetzungsAbschwaechungen(altC, neuC),
    ...pruefungsAbschwaechungen(altC, neuC),
    ...mutationsAbschwaechungen(altC, neuC),
  ];
  return { richtung, abschwaechungen };
}

/**
 * Eine Abschwaechung aus `strengeVergleich` als Zeile, etwa `strenge: streng -> leicht` oder
 * `buildChecks[].guete.marke (npm test): 80 -> 50`; Hook und Commit-Gate nennen sie so (A11).
 */
export function abschwaechungText({ feld, cmd, alt, neu }) {
  const wert = (w) => (w !== null && typeof w === "object" ? JSON.stringify(w) : String(w));
  const kommando = cmd === undefined ? "" : ` (${cmd})`;
  return `${feld}${kommando}: ${wert(alt)} -> ${wert(neu)}`;
}

// SYNC: WERTE.strenge in kit/board/config-namen.mjs — die Schreibweise der Strenge in der Datei.
const DATEI_WERT = Object.freeze({ leicht: "light", normal: "normal", streng: "strict" });

/**
 * Der Vermerk eines Wechsels fuer die Commit-Nachricht (A10): `Strenge: <alt> -> <neu> (<Urheber>)`,
 * die Strenge in der Schreibweise der Datei. `null`, wenn sich die Strenge nicht aendert und nichts
 * abgeschwaecht wird; eine Abschwaechung bei gleicher Strenge traegt die Zeile ebenfalls, weil das
 * Commit-Gate sie fuer jede Abschwaechung verlangt (A11). Ohne Urheber steht `?` in der Klammer.
 */
export function strengeVermerk(alt, neu, urheber) {
  const { richtung, abschwaechungen } = strengeVergleich(alt, neu);
  if (richtung === "gleich" && abschwaechungen.length === 0) return null;
  const wert = (c) => DATEI_WERT[strengeVorgaben(c).strenge];
  const name = String(urheber ?? "").trim() || "?";
  return `Strenge: ${wert(alt)} -> ${wert(neu)} (${name})`;
}

const ZEILE = Object.freeze({
  de: Object.freeze({ titel: "Strenge", leicht: "Leicht", normal: "Normal", streng: "Streng" }),
  en: Object.freeze({ titel: "Strictness", leicht: "Light", normal: "Normal", streng: "Strict" }),
});

/** Die Anzeigezeile der Strenge, `Strenge: Leicht` oder `Strictness: Light`; sonst Deutsch. */
export function strengeZeile(vorgaben, sprache) {
  const texte = ZEILE[sprache] ?? ZEILE.de;
  return `${texte.titel}: ${texte[vorgaben?.strenge] ?? texte[STRENGE_VORGABE]}`;
}
