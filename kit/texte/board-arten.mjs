// SPDX-License-Identifier: MIT
/**
 * texte/board-arten.mjs — die Texttabelle von board/arten.mjs (Issue #1856). Eigener Teil, damit
 * `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann. Das Modul
 * importiert die Tabelle und exportiert sie unter demselben Namen weiter.
 */

/** Die Erklaerungen der Mangel-Arten in beiden Sprachen; die Artnamen bleiben unuebersetzt. */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    art_bestandsbehauptung: "Der geprueste Text behauptet etwas ueber den Bestand — eine Datei, eine Zeile, ein Verhalten —, das dort nicht so steht.",
    art_unbeobachtbar: "Eine Zusage ist so formuliert, dass sich nicht beobachten laesst, ob sie erfuellt ist.",
    art_widerspruch: "Zwei Stellen desselben Texts oder der Text und eine bindende Quelle sagen Verschiedenes.",
    art_luecke: "Ein fuer das Ziel noetiger Fall, Schritt oder Bereich fehlt ganz.",
    art_unbestimmt: "Eine Angabe laesst mehrere Auslegungen zu, und die Wahl aendert das Ergebnis.",
    art_form: "Der Text verletzt eine vorgeschriebene Form — ein Abschnitt, ein Feld, eine Reihenfolge, ein Format.",
    art_doppelung: "Dieselbe Aussage steht an zwei Orten, die auseinanderdriften koennen.",
    art_korrektheit: "Der beschriebene oder geschriebene Weg fuehrt zu einem falschen Ergebnis.",
    art_sicherheit: "Die Aenderung oeffnet einen Zugang, verraet ein Geheimnis oder umgeht eine Schranke.",
    art_test: "Ein Beleg fehlt, prueft am Gegenstand vorbei oder kann gar nicht fehlschlagen.",
    art_konvention: "Die Stelle weicht ohne Grund von einem im Projekt eingefuehrten Muster ab.",
    art_sonstiges: "Auffang-Art fuer einen Fund, der in keine der elf anderen passt; ein Projekt ergaenzt keine eigenen Arten.",
  }),
  en: Object.freeze({
    art_bestandsbehauptung: "The checked text claims something about the existing state — a file, a line, a behaviour — that is not so there.",
    art_unbeobachtbar: "A commitment is worded so that one cannot observe whether it is met.",
    art_widerspruch: "Two places of the same text, or the text and a binding source, say different things.",
    art_luecke: "A case, step or area needed for the goal is missing entirely.",
    art_unbestimmt: "A statement allows several readings, and the choice changes the result.",
    art_form: "The text violates a prescribed form — a section, a field, an order, a format.",
    art_doppelung: "The same statement stands in two places that can drift apart.",
    art_korrektheit: "The described or written way leads to a wrong result.",
    art_sicherheit: "The change opens an access, reveals a secret or bypasses a barrier.",
    art_test: "Evidence is missing, checks past the subject or cannot fail at all.",
    art_konvention: "The place deviates without reason from a pattern established in the project.",
    art_sonstiges: "Catch-all kind for a finding that fits none of the other eleven; a project adds no kinds of its own.",
  }),
});
