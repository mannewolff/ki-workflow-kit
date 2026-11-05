// SPDX-License-Identifier: MIT
/**
 * texte/board-sicherheit.mjs — die Texttabelle von board/sicherheit.mjs (Issue #1992). Eigener
 * Teil, damit `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann,
 * ohne die Logik des Moduls aus der Duplikatsmessung zu nehmen.
 *
 * Vertragswerte bleiben ausserhalb: die Ergebnisse `gruen`, `ok`, `kritisch`, `ausfall`, die
 * Schweregrade, die Fundblock-Zeilen der Rolle `sicherheit` und die Zeile `Verursacher:`.
 * Der Kartentitel `Sicherheit: <Angriffsklasse> in <Datei>` ist die Kennung eines Befunds
 * und steht darum in beiden Sprachen gleich.
 */

export const TEXTE = Object.freeze({
  de: Object.freeze({
    fileFehlt: "security-result braucht --file <antwort>",
    baseFehlt: "security-result --cards braucht --base <anker>: Die Verursacher-Karten kommen aus den Commits seit dem Anker",
    antwortLeer: "Die Antwort des Sicherheitspruefers ist leer",
    reviewFileFehlt: "review-result braucht --file <antwort>",
    reviewAntwortLeer: "Die Antwort des Code-Reviewers ist leer",
    antwortUnlesbar: "Die Antwort {datei} ist nicht lesbar: {grund}",
    nichtGeprueft: "nicht geprüft",
    kontextEinleitung: "Die Sicherheitspruefung vor dem Push meldete diesen Befund, im Wortlaut:",
    verursacherKeine: "keine Karte, deren Commits seit {basis} die Fundstelle beruehrt haben",
    verursacherUnbekannt: "nicht bestimmbar ({fehler})",
    sitzungsumfang: "passt — ein Befund in einer Datei, behoben mit einem Test, der den Angriff nachstellt.",
    stufengrund: "Sicherheitsbefund: Die Abwehr muss den Angriff nachstellen und die Vertrauensgrenze halten.",
    aufgabeEinleitung: "Den Befund an der Fundstelle beheben:",
    aufgabeTest: "Zuerst einen Test schreiben, der den Angriff nachstellt, und rot laufen lassen.",
    akzeptanz: "Ein Test stellt den Angriff nach ({angreifer}; {grenze}) und belegt, dass die Folge ausbleibt: {folge}",
    kommentarKopf: "## Sicherheitsbefund erneut gefunden",
    kommentarEinleitung: "Die Sicherheitspruefung vor dem Push fand diesen Befund erneut (Anker {basis}), im Wortlaut:",
    formVerstoss: "Die Karte \"{titel}\" besteht issue check-form nicht, sie wird nicht angelegt: {verstoesse}",
    boardGescheitert: "board.mjs {befehl} scheiterte: {grund}",
  }),
  en: Object.freeze({
    fileFehlt: "security-result needs --file <answer>",
    baseFehlt: "security-result --cards needs --base <anchor>: the causing cards come from the commits since the anchor",
    antwortLeer: "The security reviewer's answer is empty",
    reviewFileFehlt: "review-result needs --file <answer>",
    reviewAntwortLeer: "The code reviewer's answer is empty",
    antwortUnlesbar: "The answer {datei} cannot be read: {grund}",
    nichtGeprueft: "not checked",
    kontextEinleitung: "The security check before the push reported this finding, verbatim:",
    verursacherKeine: "no card whose commits since {basis} touched the location",
    verursacherUnbekannt: "not determinable ({fehler})",
    sitzungsumfang: "fits — one finding in one file, fixed with a test that reproduces the attack.",
    stufengrund: "Security finding: the defence must reproduce the attack and hold the trust boundary.",
    aufgabeEinleitung: "Fix the finding at the location:",
    aufgabeTest: "First write a test that reproduces the attack, and run it red.",
    akzeptanz: "A test reproduces the attack ({angreifer}; {grenze}) and shows that the consequence no longer occurs: {folge}",
    kommentarKopf: "## Security finding found again",
    kommentarEinleitung: "The security check before the push found this finding again (anchor {basis}), verbatim:",
    formVerstoss: "The card \"{titel}\" fails issue check-form and is not created: {verstoesse}",
    boardGescheitert: "board.mjs {befehl} failed: {grund}",
  }),
});
