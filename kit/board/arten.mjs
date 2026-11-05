// SPDX-License-Identifier: MIT
/**
 * board/arten.mjs — die Mangel-Arten des Pruefauftrags (Issue #1856, Plan #1853 E6, E15). Jeder
 * Fund traegt `Art:`, die Liste gehoert deshalb zum Pruefauftrag selbst und liegt im
 * Community-Teil. kit/findings.mjs importiert sie von hier und exportiert `arten` weiter.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { text } from "./namen.mjs";

// Die Texte an den Menschen liegen unter kit/texte/board-arten.mjs.
import { TEXTE } from "../texte/board-arten.mjs";

export { TEXTE };

const t = (schluessel, werte) => text(TEXTE, schluessel, werte);

/**
 * Die zwoelf Mangel-Arten. Grob statt feinmaschig (Nicht-Ziel des Fachkonzepts): Sie
 * decken die Fragen aller fuenf heutigen Rollen-Prompts ab und lassen sich in einem
 * Satz erklaeren. Die Reihenfolge ist die des Plans und bleibt stabil — die Skills
 * setzen die Liste woertlich in ihre Prompts ein.
 *
 * `vorschlag` sagt, welche Frage `vorschlag --art` an der Schwelle stellt (Issue #1182):
 * `"pruefung"` fragt nach einer maschinellen Pruefung, `"liste"` nach einer Erweiterung
 * der Artenliste, `null` stellt keine. Nach einer Pruefung fragen nur die Arten, deren
 * Merkmal ein Werkzeug am Text oder Code erkennen kann; die uebrigen sind Urteile eines
 * Reviews, und der PO hat die Frage dazu wiederholt abgelehnt. Eine hoehere Schwelle
 * verschoebe dieselbe Karte nur.
 */
export const ARTEN = [
  { name: "bestandsbehauptung", vorschlag: null },
  { name: "unbeobachtbar", vorschlag: null },
  { name: "widerspruch", vorschlag: null },
  { name: "luecke", vorschlag: null },
  { name: "unbestimmt", vorschlag: null },
  { name: "form", vorschlag: "pruefung" },
  { name: "doppelung", vorschlag: null },
  { name: "korrektheit", vorschlag: null },
  { name: "sicherheit", vorschlag: "pruefung" },
  { name: "test", vorschlag: null },
  { name: "konvention", vorschlag: "pruefung" },
  { name: "sonstiges", vorschlag: "liste" },
];

export function arten() {
  return { ok: true, anzahl: ARTEN.length, arten: ARTEN.map((a) => ({ ...a, erklaerung: t(`art_${a.name}`) })) };
}
