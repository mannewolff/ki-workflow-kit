// SPDX-License-Identifier: MIT
/**
 * checks/abgleich.mjs — gleicht eine eingerichtete Zuordnung der Pruefbereiche ab (Issue #1717,
 * Plan #1713 A10; eigene Datei seit Issue #1859, Plan #1853 E5).
 *
 * Der Vergleich der Pruefbereiche war ein Pro-Teil (#1814, Frage 1) und ist seit Issue #2012
 * wieder Community wie der Vorschlag in `checks/bereiche.mjs` (Plan #2008 A1). `checks.mjs` laedt
 * die Datei dynamisch wie die anderen Teile unter `checks/`. Die gemeinsam genutzten Helfer
 * bleiben in `bereiche.mjs`.
 *
 * Eine reine Funktion ueber Config und Messung wie der Vorschlag: Sie meldet nur und aendert
 * nichts (Kriterium 12).
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { bereicheVorbereiten, vergleicheText } from "../checks.mjs";
import { URTEIL } from "./testauswahl.mjs";
import {
  abschnitt, aufbereiten, bestehendeBereiche, beurteilbare, kommandosJeTest, sortiert, t,
} from "./bereiche.mjs";

export { alsJson } from "./bereiche.mjs";

/** Die Luecken eines Tests nach A10: je getroffenem Bereich, den keines seiner Kommandos nennt. */
function lueckenVon(testdatei, gekoppelt, kommandos, bereiche) {
  const luecken = [];
  for (const datei of sortiert(gekoppelt)) {
    for (const bereich of bereiche.filter((b) => b.regexe.some((regex) => regex.test(datei)))) {
      if (kommandos.some((k) => k.areas.includes(bereich.name))) continue;
      for (const kommando of kommandos) luecken.push({ test: testdatei, datei, bereich: bereich.name, kommando: kommando.cmd });
    }
  }
  return luecken;
}

/** „Zu viel" je Kommando: ein genannter Bereich, dessen Dateien keiner seiner Tests koppelt. */
function zuVielVon(kommando, kopplung, bestehend) {
  const gekoppelt = new Set(kommando.tests.flatMap((testdatei) => [...(kopplung.get(testdatei) ?? [])]));
  return kommando.areas
    .filter((name) => !(bestehend.get(name) ?? []).some((datei) => gekoppelt.has(datei)))
    .map((bereich) => ({ kommando: kommando.cmd, bereich }));
}

/**
 * Der Abgleich der eingerichteten Zuordnung (A10). `nurTests` beschraenkt die Luecken auf diese
 * Tests; „zu viel" gilt immer fuer alle Tests eines Kommandos. Aendert nichts.
 *
 * @param {object} config
 * @param {object} messung wie bei `vorschlagErheben`
 * @param {{ nurTests?: string[] }} [optionen]
 */
export function abgleichErheben(config, messung, { nurTests } = {}) {
  const aufbereitet = aufbereiten(config, messung);
  const bereiche = bereicheVorbereiten(config.checkAreas ?? {});
  const jeTest = kommandosJeTest(aufbereitet.kommandos);
  const auswahl = nurTests ? new Set(nurTests) : null;

  const luecken = [];
  const ohneKommando = [];
  for (const [testdatei, gekoppelt] of [...aufbereitet.kopplung].sort(([a], [b]) => vergleicheText(a, b))) {
    if (auswahl && !auswahl.has(testdatei)) continue;
    const kommandos = jeTest.get(testdatei);
    if (kommandos) luecken.push(...lueckenVon(testdatei, gekoppelt, kommandos, bereiche));
    else ohneKommando.push(testdatei);
  }

  const bestehend = new Map(bestehendeBereiche(config, aufbereitet.dateien).map((b) => [b.name, b.dateien]));
  const mitUrteil = (urteil) => aufbereitet.kommandos.filter((k) => k.urteil === urteil).map(({ cmd, grund }) => ({ cmd, grund }));
  return {
    luecken,
    zuViel: beurteilbare(aufbereitet.kommandos).flatMap((k) => zuVielVon(k, aufbereitet.kopplung, bestehend)),
    nichtBeurteilbar: mitUrteil(URTEIL.nichtBeurteilbar),
    nichtAbgeleitet: mitUrteil(URTEIL.nichtAbgeleitet),
    ohneKommando,
  };
}

/** Der Abgleich als Text in der Projektsprache: Luecken getrennt vom Hinweis „zu viel". */
export function abgleichText(abgleich) {
  const grundZeile = ({ cmd, grund }) => t("kommandoGrund", { cmd, grund });
  return [
    t("abgleichKopf"),
    ...(abgleich.luecken.length > 0
      ? ["", t("lueckenKopf"), ...abgleich.luecken.map((l) => t("luecke", l))]
      : ["", t("keineLuecken")]),
    ...abschnitt(t("zuVielKopf"), abgleich.zuViel.map((z) => t("zuViel", z))),
    ...abschnitt(t("nichtBeurteilbarKopf"), abgleich.nichtBeurteilbar.map(grundZeile)),
    ...abschnitt(t("nichtAbgeleitetKopf"), abgleich.nichtAbgeleitet.map(grundZeile)),
    ...abschnitt(t("ohneKommandoKopf"), abgleich.ohneKommando.map((datei) => `- ${datei}`)),
    "",
  ].join("\n");
}
