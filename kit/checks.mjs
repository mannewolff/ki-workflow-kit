#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * claude-workflow-kit Pruef-Auswahl und -Ausfuehrung (Issues #423, #424)
 *
 * `plan` entscheidet, welche Pruefungen nach einem Arbeitspaket laufen muessen —
 * und gibt die Entscheidung als Daten zurueck, ohne sie auszufuehren. `run` fuehrt
 * genau diese Auswahl aus und hinterlaesst das Ergebnis als Zusammenfassung, aus
 * der der Runner liest.
 *
 * Die Zusammenfassung BEGLEITET den Lauf (Issue #857): geschrieben vor dem ersten
 * Kommando, erneut vor jedem weiteren, ein letztes Mal am Ende — und nur diese
 * letzte Fassung traegt `abgeschlossen: true`. Daraus folgt, was ein Abbruch
 * hinterlaesst: einen Stand, in dem das Kommando, waehrend dessen der Lauf starb,
 * noch `nicht gestartet` ist. Der Lauf ist dann nie ganz gruen, und das ist dieselbe
 * sichere Richtung wie ueberall hier — ein gestorbener Pruefer gilt als
 * beanstandend, nicht als ungemessen.
 *
 * Warum ein Kommando und keine Regel im Skilltext: Die Sessions dieses Projekts
 * haben dreimal belegt, dass eine Regel im Prompt nicht wirkt, wenn sie unter
 * Druck steht (Issue #267, 2026-08-12, Issue #410). Eine Auswahl, die falsch
 * ausfaellt, nimmt Pruefung weg — der Fehler geht in die unsichere Richtung und
 * faellt niemandem auf.
 *
 * Deshalb irrt dieses Kommando nur in eine Richtung: mehr pruefen. Drei Ausgaenge
 * setzen das durch:
 *   - Eine geaenderte Datei, die kein Muster trifft -> `vollerUmfang: true`,
 *     alles laeuft. Nicht abschaltbar.
 *   - Ein Anker, der sich nicht aufloesen laesst -> ebenso voller Umfang. Ein
 *     LEERER `--since`-Wert zaehlt dabei wie ein nicht aufloesbarer, nie wie ein
 *     fehlender: Er entsteht, wenn bei einem Aufruf von Hand oder aus einem Skill
 *     (`/push-main`, ein Prueflauf vor dem Veroeffentlichen) die
 *     merge-base-Substitution fehlschlaegt. Als "nicht angegeben" gelesen griffe
 *     der Default HEAD, und auf sauberem Tree liefe keine einzige Pruefung.
 *   - Eine fehlende Config -> Abbruch mit Exit ungleich 0. Ein Kommando, das
 *     ohne Config stillschweigend "nichts zu pruefen" meldet, zeigt genau dorthin,
 *     wo der Fehler niemandem auffaellt.
 *
 * `run` UEBERNIMMT sein eigenes Ergebnis, wenn sich der Stand seit dem letzten Lauf
 * nicht geaendert hat (Issue #863): gleicher Anker, gleiche Stufe, dieselbe
 * Dateiliste mit denselben Blob-Hashes, dieselbe Config — und eine abgeschlossene
 * Zusammenfassung. Dann laeuft kein Kommando, und `run` schreibt denselben Befund
 * mit frischem Zeitpunkt erneut, damit das Commit-Gate seinen Nachweis behaelt.
 * `--fresh` erzwingt den echten Lauf. Das ist keine Bequemlichkeit, sondern
 * dieselbe Erfahrung wie oben: Die Regel „Ausgabe einmal in eine Datei, daraus
 * lesen" (Issue #835) steht seit Langem im Skilltext, und die Sessions starteten
 * denselben gruenen Lauf trotzdem drei- bis neunmal je Paket. Ein Ergebnis
 * wiederzuverwenden nimmt dabei keine Pruefung weg: Derselbe Inhalt liefert
 * dasselbe Urteil, und schon ein einziges abweichendes Byte faellt zurueck in den
 * vollen Weg.
 *
 * In dieselbe Richtung irrt die MERKMAL-PRUEFUNG von `run` (Issue #858): Es liest
 * nicht nur den Rueckgabewert, sondern prueft die Ausgabe jedes Kommandos auf eine
 * feste Liste allgemeiner Fehlermerkmale (`FEHLERMERKMALE`). Ein
 * Treffer laesst die Pruefung fehlschlagen, auch bei Rueckgabewert 0 — und ein
 * falsches Rot ist hier die sichere Richtung: Es kostet eine Nachfrage, waehrend
 * ein falsches Gruen ein gescheitertes Paket nach In review traegt.
 *
 * Neben den Bereichen waehlt das Kommando nach einer STUFE aus (Issue #758):
 * `--stage package|push|merge` sagt, welcher Zeitpunkt gefahren wird. Die Stufen
 * sind kumulativ — `push` faehrt `paket` mit —, ein Eintrag
 * ohne `stufe` gilt als Paketstufe, und damit bleibt jede bestehende Config
 * unveraendert. Die beiden Achsen beantworten Verschiedenes: `areas`/`always`
 * sagen, OB eine Pruefung betroffen ist, `stufe` sagt, WANN sie an der Reihe ist.
 *
 * An der PUSH-STUFE faellt die erste Achse weg: Dort laeuft jede faellige Pruefung,
 * auch bei leerem Paket und unberuehrten Bereichen (Plan #843, E9). Gemessen wird der
 * Stand, der hinausgeht — und der besteht aus mehr als dem letzten Arbeitspaket.
 *
 * Die FREIGABESTUFE `merge` prueft nur, was `push main` nicht geprueft hat (Issue
 * #1000): `merge production` gibt es nie ohne vorheriges `push main`. Es laufen die
 * Pruefungen der Stufe `merge` und die der Paketstufe nach Bereichen ueber die Dateien
 * seit dem Anker; die Stufe `push` bleibt mit Grund aus.
 *
 * `--area <name>` faehrt die Pruefgruppen genau eines `checkAreas`-Bereichs
 * (Issue #922, Plan #917, E3). Es ist der vorgesehene Weg, wenn fuer die
 * geaenderte Datei nur die vollstaendige Gruppe existiert — dann ist der
 * Gruppenlauf kein Verstoss gegen die Zehn-Minuten-Marke, sondern der Fall, fuer
 * den das Flag da ist. Ohne es waere derselbe Lauf von Hand am Kommando vorbei
 * gefahren, und aus den Daten liesse sich Notwendigkeit nicht von Umgehung
 * trennen.
 *
 * Die vierte Achse ist `nichtBeimAbschluss` (Issue #946, Plan #944): Sie sagt, dass
 * eine Pruefung den Abschluss eines einzelnen Arbeitspakets nicht tragen muss, weil
 * sie nur das Zusammenspiel prueft (`zusammenspiel`) oder ihren Befund aus der
 * vollstaendigen Testmenge gewinnt (`volleTestmenge`). Gewirkt wird sie allein durch
 * `--finish [n]`, den Schalter, den der Abschluss genau einer Karte setzt — dort
 * bleibt sie aus, samt Guetemessung, und vor dem Veroeffentlichen laeuft beides wieder.
 * Nennt der Eintrag dazu `abschlussBereiche` (Issue #1531, Plan #1529), laeuft er beim
 * Abschluss doch, sobald das Paket einen dieser Bereiche direkt beruehrt — ueber ein Muster
 * oder die Ableitung aus den Importeuren, nicht ueber die abhaengigen Bereiche.
 *
 * Haelt der Lauf an der PUSH-STUFE an, nennt er zu jeder roten Pruefung die Karten, die
 * sie beruehrt haben (Issue #947, AK 4 des Fachplans #938) — gelesen aus den Commits
 * `<basis>..HEAD`, mit der Kartennummer aus der Commit-Botschaft und ohne Board und ohne
 * Netz (E6). Der Anker ist der `--since`-Wert des Laufs, den `/push-main` schon heute als
 * `git merge-base HEAD origin/<mainBranch>` uebergibt (E5). Nur an dieser Stufe: An der
 * Freigabe ist die Basis `HEAD` selbst, und `<basis>..HEAD` waere leer. Die Suche ist
 * Buchhaltung ueber einen bereits gefallenen Befund — ihr eigenes Scheitern steht als
 * Grund an der Stelle der Karten und aendert am Ausgang des Laufs nichts.
 *
 * Faehrt der Lauf mit `--finish` oder `--retry`, wird eine rote Pruefung genau
 * EINMAL auf demselben Stand wiederholt (Issue #1396, Plan #1395, E2–E8): unmittelbar im
 * selben Ablaufplatz, bevor der Rest der Phase ueber Abbruch oder Weiterlauf entscheidet.
 * Rot und Gruen ist ein Wackler — der Eintrag bleibt `gruen` und traegt `gewackelt`, die
 * Ausgabe des ersten Laufs liegt mit dem Zusatz `-erstlauf` in der Ablage. Rot und Rot
 * bleibt `rot` und traegt `wiederholt: true`. Einen dritten Ergebniswert gibt es nicht:
 * Gate und Runner lesen allein `ergebnis !== "gruen"`. Die Stufe allein loest nichts aus —
 * der Job des Build-Dienstes faehrt `--stage push` ohne den Schalter und wiederholt nicht,
 * und jeder Lauf waehrend der Umsetzung laeuft wie bisher genau einmal.
 *
 * Der HOTFIX (Issue #2051, Plan #2038, E1, E2) faehrt `run --stage push --hotfix`: Jede
 * Pruefung mit `deferOnHotfix: true` bleibt mit dem Grund „nach der Auslieferung" aus, das Feld
 * `hotfix` der Zusammenfassung nennt gelaufene und verschobene, und der Platzhalter `{files:}`
 * im `mutationCommand` traegt die Dateien seit `--since`. Der Mutationstest bleibt berichtet.
 *
 * Die STRENGE (Issue #2107, Plan #2102, A5, A7, A8, A9) bestimmt den Umfang von `--stage push`:
 * Mit `pushUmfang bereiche` (Leicht) waehlt sie nach den Bereichen der Dateien seit `--since`,
 * auch fuer die Pruefungen der Stufe `push`, und `mutation aus` laesst den Mutationstest weg.
 * Ist die Strenge gegenueber dem Stand an `--since` gestiegen, oder steht `--catch-up` da,
 * laeuft der volle Umfang samt Mutationstest. `--hotfix` liest die Strenge nicht.
 *
 * Auch hier ist die Richtung einseitig: Wer `--finish` VERGISST, prueft mehr. Darum
 * bleibt jeder Commit von Hand und jeder Prueflauf von Hand ohne Karte unveraendert, und
 * darum haengt das Gate des Abschlusses (mindestens ein Paketstufen-Eintrag, der weder
 * `nichtBeimAbschluss` noch `guete` traegt) am Schalter statt an jedem Aufruf.
 *
 * Aufruf im Projekt-Root:  node .claude/kit/checks.mjs plan [--since <ref>] [--stage <s>] [--area <name>] [--finish [n]] [--hotfix] [--part <i>/<n>] [--in <pfad>]
 *                          node .claude/kit/checks.mjs run  [--since <ref>] [--stage <s>] [--area <name>] [--finish [n]] [--retry] [--fresh] [--hotfix] [--catch-up] [--part <i>/<n>] [--summary-file <pfad>] [--in <pfad>]
 *                          node .claude/kit/checks.mjs areas
 *
 * `bereiche` (Issue #1004, Plan #1001) rechnet keine Auswahl, sondern den Zuschnitt: je
 * Bereich, in wie vielen Pruefkommandos er steht, und das Inventar der versionierten
 * Dateien ohne Bereich — ueber dieselbe Zuordnung, die jede Auswahl trifft.
 *
 * Die Ausgabe von `plan` ist immer JSON, es gibt kein --json-Flag: `board.mjs
 * issue get` liefert ebenfalls JSON ohne Flag, und eine zweite Ausgabeform waere
 * zweite Pflege. `run` schreibt fuer Menschen und legt seine maschinenlesbare
 * Fassung in der Zusammenfassung ab.
 *
 * Keine Laufzeitabhaengigkeit ausserhalb der Node-Standardbibliothek — das Kit
 * liefert seine Werkzeuge als eigenstaendig portable Einzeldateien aus. Deshalb
 * traegt die Datei auch ihre eigene Minimal-Glob-Fassung statt eines Pakets.
 */

import { lstatSync, statSync, existsSync, readFileSync, readdirSync, writeFileSync, appendFileSync, mkdirSync, realpathSync, unlinkSync } from "node:fs";
import { join, dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

// Der Normalisierer der Einstellungsnamen aus dem Board-Teil config-namen (Issue #1436, Plan
// #1420 E10): Er bildet eine englisch benannte Config auf die deutschen Namen ab, die dieses
// Modul liest. Dynamisch und abgefangen, denn das Modul laeuft auch allein ohne den Board-Teil;
// fehlt er, bleibt die Config, wie sie gelesen wurde.
const { normalisiereConfig = (roh) => ({ config: roh, hinweise: [] }), WERTE: CONFIG_WERTE = {} } =
  await import(new URL("./board/config-namen.mjs", import.meta.url).href).catch(() => ({}));

// Der Texthelfer aus dem Board-Teil namen (Plan #1420 E13), abgefangen wie der Normalisierer:
// Fehlt board/namen.mjs neben checks.mjs, bleiben die Texte deutsch.
const namen = await import(new URL("./board/namen.mjs", import.meta.url).href).catch(() => null);

// Die Ableitung der Strenge aus dem Board-Teil strenge (Issue #2107, Plan #2102, A2), abgefangen
// wie der Normalisierer: Fehlt board/strenge.mjs, liest die Push-Stufe keine Strenge und prueft
// wie bisher den vollen Umfang.
const strengeModul = await import(new URL("./board/strenge.mjs", import.meta.url).href).catch(() => null);

/** Der Text zu `schluessel` aus `TEXTE` in der Sprache des Prozesses; ohne Register deutsch. */
function t(schluessel, werte = {}) {
  if (namen) return namen.text(TEXTE, schluessel, werte);
  return TEXTE.de[schluessel].replaceAll(/\{([A-Za-z_]\w*)\}/g, (_, name) => String(werte[name]));
}

/** Die Sprache des Prozesses; ohne Register Deutsch. */
const spracheJetzt = () => (namen ? namen.prozessSprache() : "de");

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "6.1.0";

// Die Variablen, die der Runner seinen Sessions setzt (Issue #1282), aus dem Blatt-Modul
// neben session.mjs. Fehlt der Nachbar, bleibt die Umgebung, wie sie ist.
const { ohneLaufVariablen = (env) => ({ ...env }) } = await import("./night/laufvariablen.mjs").catch(() => ({}));

// --- Aufrufumgebung ----------------------------------------------------------

/**
 * Die Umgebung des laufenden Aufrufs (Issue #1212, Plan #1199 E6). Als CLI ist sie leer,
 * und jeder Zugriff unten faellt auf den Prozess zurueck. `aufrufen` setzt sie fuer die
 * Dauer eines Aufrufs im selben Prozess: Arbeitsverzeichnis, Umgebungsvariablen,
 * Kommandozeile, Ausgabe und der Start von git. So treffen die Tests `plan` und `run`,
 * ohne fuer jeden Aufruf einen Node-Prozess zu starten.
 */
let umgebung = {};

const wurzel = () => umgebung.cwd ?? process.cwd();
const umgebungsVariablen = () => umgebung.env ?? process.env;
const aufStdout = (text) => (umgebung.stdout ? umgebung.stdout(text) : process.stdout.write(text));
const aufStderr = (text) => (umgebung.stderr ? umgebung.stderr(text) : process.stderr.write(text));

// Ort der Zusammenfassung, die `run` hinterlaesst (Issue #424, Entscheidung A4 des
// Plans #421): derselbe Ort wie das Protokoll des Runners (`LOG_FILE` in night.mjs) — im
// Projekt, aber hinter der Ignore-Regel `.claude/*`. Damit bleibt der Working Tree
// sauber und der harte Stopp auf dirty (Issue #152) greift nicht.
//
// Fester Dateiname, kein Zeitstempel: Der Runner loescht die Datei vor jeder
// Session (Issue #428), es zaehlt also immer nur der Lauf der laufenden Session —
// und innerhalb einer Session der letzte. Eine Session darf `run` mehrfach fahren
// (rot, Fix, erneut), daraus entsteht bewusst keine Historie.
const SUMMARY_DATEI = ".claude/checks-summary.json";

// Das Ausfuehrungsprotokoll (Issue #785, Plan #782, E17) — die Zaehleinheit, die der
// Zusammenfassung daneben fehlt.
//
// Die Zusammenfassung traegt bewusst keine Historie (Kommentar zu SUMMARY_DATEI): Der
// Runner loescht sie vor jeder Session, und innerhalb einer Session ueberschreibt
// jeder `run` den vorigen. Die Wirksamkeits-Auswertung fragt aber, wie oft eine Pruefung
// lief und wie oft sie beanstandet hat — und genau diese Zahl verliert die
// Zusammenfassung: Eine Pruefung, die rot anschlaegt, worauf die Session den Mangel
// behebt und erneut prueft, hinterliesse dort einen gruenen Endstand. Sie erschiene als
// "nie beanstandet" und loeste damit genau den Befund aus, der zu ihrer Abschaffung
// einlaedt — die Kennzahl truege systematisch das falsche Vorzeichen.
//
// Deshalb eine eigene Datei, angehaengt und nie geleert, nach dem Muster der Wegmarken
// (board-9). Derselbe Ort wie die Zusammenfassung: im Projekt, aber hinter der
// Ignore-Regel `.claude/*`.
//
// MESSGRENZE (E17): Die Salvage-Pruefungen des Runners rufen die Kommandos roh
// ueber spawnSync auf und laufen an checks.mjs vorbei; ihre Ausfuehrungen stehen hier
// nicht. Der Salvage ist ein Rettungsversuch am Rand eines gescheiterten Pakets, keine
// Pruefung eines Arbeitspakets — ihn mitzuzaehlen mischte zwei Zaehleinheiten.
//
// SYNC: kit/night.mjs nimmt denselben Pfad im Rest-Guard aus (`:(exclude)` in gitReste,
// dazu der Worktree-Spiegel), kit/effectiveness.mjs liest die Datei. Die Kit-Werkzeuge sind
// bewusst eigenstaendige Single-File-Tools ohne gemeinsames Modul (#440), geteilte
// Konstanten werden dupliziert und hier markiert.
const AUSFUEHRUNGEN_DATEI = ".claude/ausfuehrungen.tsv";

// Die Ausgabe jedes nicht gruenen Kommandos des letzten echten Laufs (Issue #1196). Die
// Werkzeugausgabe einer Session kappt die Mitte, und ohne die Datei fuhr sie nach einem
// Rot die ganze Suite mit --fresh erneut, nur um sie umzuleiten. Wie die Zusammenfassung
// ohne Historie: Jeder echte Lauf leert den Ordner, ein uebernommener laesst ihn stehen.
// SYNC: kit/night.mjs nimmt den Ordner im Rest-Guard aus (gitReste).
const PROTOKOLL_ORDNER = ".claude/checks-protokolle";

// Altlast aus SDD, Rueckbau mit dem uebernaechsten Major (Plan #825, A5): Bis zum
// Rueckbau von Spec-Driven Development legte `/techplan` wartende Vorhaben-Notizen hier
// ab. Heute entsteht keine mehr, aber in Zielprojekten kann noch eine liegen — kein
// Code-Zustand, also keine geaenderte Datei eines Arbeitspakets.
//
// Der Ausschluss steht ausdruecklich im Code, obwohl `.gitignore` den Pfad meist
// schon deckt: Der Installer laesst eine vorhandene eigene `.claude`-Regel
// unangetastet, also gibt es Projekte ohne den Block. Dort waere die Notiz sonst
// sichtbar und wuerde eine Pruefung ausloesen, zu der sie nicht gehoert.
//
// Praefix, kein Teilstring: Genau diese Menge nimmt `:(exclude).claude/vorhaben-wartend-*`
// in `gitClean()` von night.mjs aus. Ein Teilstring-Match traefe zusaetzlich
// `sub/.claude/vorhaben-wartend-x.md` in einem Unterprojekt — die Datei waere hier
// unsichtbar und im Rest-Guard ein Rest.
const WARTEND_PRAEFIX = ".claude/vorhaben-wartend-";

/**
 * Der Pfad der Zusammenfassung. Exportiert, damit night.mjs ihn importieren kann,
 * statt ihn ein zweites Mal auszurechnen (Issue #428) — derselbe Grund, aus dem
 * `run` seine Auswahl von `plan` bezieht und nicht neu berechnet.
 */
export function zusammenfassungPfad(root = wurzel()) {
  return join(root, ...SUMMARY_DATEI.split("/"));
}

/**
 * Der Vergleich fuer Textlisten: derselbe, den `sort` ohne Argument nimmt.
 *
 * Ausgeschrieben statt weggelassen, damit an jeder Fundstelle steht, dass die
 * Reihenfolge Absicht ist (S2871). Bewusst **nicht** `localeCompare`: Dessen
 * Reihenfolge haengt an der Locale der Maschine, und zwei Laeufe muessen
 * ueberall dieselbe Liste ergeben — Dateiliste und Bereichsnamen stehen im
 * Bericht und in der Zusammenfassung.
 *
 * SYNC: dieselbe Funktion steckt in kit/findings.mjs, kit/night.mjs,
 * kit/effectiveness.mjs und kit/board/issue-review.mjs — Aenderungen dort nachziehen. Die Kit-Werkzeuge sind bewusst eigenstaendige
 * Single-File-Tools ohne gemeinsames Modul (#440); geteilte Logik wird dupliziert
 * und hier markiert.
 *
 * Exportiert, damit der Locale-Test sie direkt pruefen kann (Issue #493).
 */
export function vergleicheText(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

// Rangfolge der Pruefzeitpunkte (Issue #758). Die Reihenfolge IST die Regel: Eine
// Pruefung ist faellig, sobald der Index ihrer Stufe den der gefahrenen nicht
// uebersteigt — daraus folgt die Kumulation, ohne sie zweitens aufzuschreiben.
const STUFEN = ["paket", "push", "merge"];

/** Der getippte Wert von `--stage` zu einer Stufe der Config (Issue #1564, Plan #1548 E5). */
const stufeGetippt = (stufe) => (stufe === "paket" ? "package" : stufe);

// Die Werte der vierten Achse `nichtBeimAbschluss` (Issue #946, Plan #944). Sie ist
// keine zweite Stufe: Die Stufe sagt, WANN eine Pruefung faellig ist, diese Achse sagt,
// WARUM sie den Abschluss eines einzelnen Arbeitspakets nicht tragen muss — weil sie nur
// das Zusammenspiel prueft oder ihren Befund aus der vollstaendigen Testmenge gewinnt.
// Eine geschlossene Werteliste und kein Freitext: Der Wert steht im Auslassungsgrund und
// wird damit gelesen; ein Freitext waere an jeder Stelle anders formuliert, und die
// Auswertung koennte die Gruppen nicht zaehlen.
const NICHT_BEIM_ABSCHLUSS = ["zusammenspiel", "volleTestmenge"];

// Die Werte des Felds `art` (Issue #1155, Plan #1150, E11). Ein Eintrag der Art `hinweis`
// meldet und haelt nie an: Er endet immer `gruen`, seine Zeilen `Hinweis: …` gehen in den
// Bericht. Kein dritter Ergebniswert (E12) — Gate, Runner und Befunde lesen jedes
// `ergebnis !== "gruen"` als Abweisung, und ein neuer Wert braeuchte an jeder dieser
// Stellen eine zweite Bahn. Hier oben, weil die Hilfe die Werte nennt.
const ARTEN = ["hinweis"];

// Die Zeilenform, in der eine Hinweis-Pruefung ihre Funde meldet (Issue #1155).
const HINWEIS_ZEILE = /^Hinweis: (.+)$/;

// Ab diesem Rueckgabewert gilt ein Hinweis-Werkzeug als gescheitert statt fuendig: Exit 1
// ist bei Pruefwerkzeugen ueblicherweise "Fund", Exit 2 und mehr "eigener Fehler".
const HINWEIS_ABSTURZ_AB = 2;

/**
 * Die allgemeinen Fehlermerkmale (Issue #858, Fachplan #769, AK 2): Merkmale, an
 * denen eine Ausgabe ihr Scheitern selbst ausweist, auch wenn der Rueckgabewert 0
 * ist. Genau der Fall kommt vor — eine Maven-Kette, deren letztes Glied den
 * Rueckgabewert verschluckt, meldet `BUILD FAILURE` in der Ausgabe und endet mit 0.
 *
 * Die Liste ist FEST und hat kein Config-Feld (Plan #810, E3). Ein Feld waere die
 * Einladung, sie in dem Projekt zu leeren, in dem sie gerade stoert — also an genau
 * der Stelle, an der sie gebraucht wird. Ein Projekt, dessen gruene Ausgabe legitim
 * eines der Merkmale traegt, filtert es in seinem `cmd` selbst heraus (die Doku
 * nennt den Weg): eine Entscheidung, die im Projekt sichtbar bleibt, statt die
 * Pruefung fuer alle abzuschalten.
 *
 * Steht hier oben und nicht bei `fehlermerkmal`, weil die Hilfe die Liste nennt — ein
 * `const` weiter unten waere dort noch nicht initialisiert.
 */
const FEHLERMERKMALE = ["[ERROR]", "BUILD FAILURE"];

// Die Obergrenze der Dauer EINER Pruefung (Issue #1003, Plan #1001, E3, E4). Bewusst
// kein Config-Feld: Die Grenze ist eine Aussage des Kits darueber, wie lange eine
// Pruefung im Abschluss eines Pakets dauern darf, und keine Vorliebe des Projekts. Sie
// vermerkt nur und faerbt nie rot — eine langsame, aber gruene Pruefung ist ein
// Zuschnittsproblem der Konfiguration und kein Fehler der Karte.
export const PRUEFDAUER_OBERGRENZE_MS = 30_000;

// Allein fuer Tests: Ein Test, der dreissig Sekunden schlaeft, um die Grenze zu
// reissen, verlaengerte die Suite, deren Laufzeit die Grenze gerade begrenzen soll.
export const OBERGRENZE_ENV = "KIT_CHECKS_PRUEFDAUER_OBERGRENZE_MS";

// Die Abbruchgrenze einer haengenden Pruefung (Issue #1077). Anders als die Obergrenze
// darueber, die nur vermerkt, bricht diese ab: Am 30.09.2026 hing ein Test
// 30 Minuten, bis das Werkzeug der Session aufgab. Die Grenze soll nur einen echten
// Haenger treffen, nie einen langsamen, aber normalen Lauf — darum das Fuenffache des
// Medians der gruenen Laeufe desselben Kommandos, mindestens drei Minuten, ohne Historie
// 15 Minuten. Kein Config-Feld aus demselben Grund wie bei der Obergrenze.
//
// Ohne Historie zaehlt zusaetzlich das Fuenffache der laengsten Pruefung, die im selben Lauf
// schon gruen endete (Issue #1822): Im Build-Dienst gibt es nie eine Historie, und dort riss
// `node tools/frischer-checkout.mjs` die 15 Minuten, ohne zu haengen — die ganze Suite in
// einem Aufruf auf vier Kernen. Die laengste Pruefung desselben Laufs misst die Maschine.
//
// Im Build-Dienst (Umgebungsvariable `CI` gesetzt) ist die Vorgabe ohne Historie 120 Minuten,
// gleich der Frist, mit der `/push-main` auf ihn wartet (Issue #1828): Am 2026-10-20 riss dort
// die Gruppe `test/ablauf-night-*.test.mjs` die 15 Minuten, ohne zu haengen — sie lief frueh im
// Lauf, und vor ihr war noch keine lange Pruefung gruen geworden. Lokal bleibt es bei 15 Minuten.
export const HAENGEN_FAKTOR = 5;
export const HAENGEN_MINDEST_MS = 3 * 60_000;
export const HAENGEN_VORGABE_MS = 15 * 60_000;
export const HAENGEN_VORGABE_BUILDDIENST_MS = 120 * 60_000;
// Zwischen SIGTERM an die Prozessgruppe und SIGKILL.
export const HAENGEN_FRIST_MS = 5_000;
// So viele gruene Laeufe je Kommando gehen hoechstens in den Median — die juengsten.
const HAENGEN_HISTORIE = 10;
// Allein fuer Tests, wie OBERGRENZE_ENV: niemand soll Minuten schlafen muessen.
const HAENGEN_MINDEST_ENV = "KIT_CHECKS_HAENGEN_MINDEST_MS";
const HAENGEN_VORGABE_ENV = "KIT_CHECKS_HAENGEN_VORGABE_MS";
const HAENGEN_FRIST_ENV = "KIT_CHECKS_HAENGEN_FRIST_MS";

// Die Obergrenze des ganzen Integrationslaufs (Issue #1982, Plan #1969, E8): die Vorgabe aus
// #1799 fuer Laeufe vor dem Veroeffentlichen. Danach bricht er ab, sein Ergebnis ist `offen`.
// Wird #1799 gebaut, ersetzt dessen Einstellung die Konstante. Die Umgebungsvariable dient
// allein den Tests, wie OBERGRENZE_ENV.
export const INTEGRATION_OBERGRENZE_MS = 20 * 60_000;
const INTEGRATION_OBERGRENZE_ENV = "KIT_CHECKS_INTEGRATION_OBERGRENZE_MS";

// Das Ergebnis des letzten Integrationslaufs (Issue #1982, Plan #1969, E5, E6): Commit,
// Zeitpunkt, Ergebnis (`gruen`, `rot`, `offen`), Verursacher und unter `gruen` der letzte
// gruene Lauf — er ist der Nullpunkt des naechsten. Hinter der Ignore-Regel `.claude/*`.
// SYNC: kit/board/arbeitskopie.mjs nimmt die Datei im Rest-Guard aus.
const INTEGRATION_DATEI = ".claude/integration.json";

// Wie viele gekennzeichnete Pruefungen hoechstens gleichzeitig laufen (Issue #1071, Plan
// #1066, A5, E3). Kein Config-Feld aus demselben Grund wie die Obergrenze: Die Zahl sagt
// etwas ueber die Maschine, nicht ueber das Projekt. Die Umgebungsvariable uebersteuert
// sie — `1` faehrt die gekennzeichneten nacheinander.
//
// Die Vorgabe ist 2, gemessen (Issue #1178, Idee #1119): Die grossen Testgruppen fahren
// ihre Dateien ihrerseits parallel, und vier davon auf einmal machten jede fuenf- bis
// sechsmal langsamer — Zeittests und die Haenger-Grenze rissen. Auf derselben Maschine
// brauchte der volle Lauf mit 4 737–751 s und war zweimal rot, mit 1 929 s, mit 2 684 s
// und war als einziger Wert stabil gruen.
export const GLEICHZEITIG_ENV = "KIT_CHECKS_GLEICHZEITIG";
const GLEICHZEITIG_VORGABE = 2;

// Ab wie vielen bereichsgebundenen Kommandos die Hervorhebung eines Bereichs greift
// (Issue #1004, Plan #1001, E8). Bei zwei Kommandos waere jeder Bereich "in allen bis
// auf eines" — die Regel sagte dann nichts mehr. Hier oben, weil die Hilfe sie nennt.
const HERVORHEBUNG_AB_KOMMANDOS = 3;

// Nach so vielen gleich gescheiterten Laeufen derselben Pruefung gilt eine Sitzung als
// festgefahren (Issue #1388, Plan #1386, E11) — Rueckfall, wenn `night.festgefahrenNach`
// fehlt oder kein gueltiger Wert ist. Hier oben, weil die Hilfe sie nennt.
// SYNC: die Vorgabe von night.festgefahrenNach in templates/workflow.config.schema.json.
const FESTGEFAHREN_VORGABE = 3;
const FESTGEFAHREN_MINDEST = 2;

/**
 * Die Marke, mit der ein gebremster Lauf beginnt (Issue #1388, Plan #1386, E6). Als
 * Konstante, weil zwei Leser sie suchen: der Beobachter in der Sitzung und der Runner.
 */
export const FESTGEFAHREN_MARKE = "Pruefung festgefahren:";

/**
 * Was in der Zeile nach der Marke auf die Zahl der Versuche folgt — Vertrag (E14) in jeder
 * Sprache: `festgefahrenLesen` in kit/night/session.mjs liest `<n>-mal gleich gescheitert`.
 */
const VERSUCHE_MARKE = "-mal gleich gescheitert";

/**
 * Die Texte des Pruefkommandos an den Menschen (Issue #1494, Plan #1420 E13). Vertragswerte
 * (E14) stehen nicht hier: die Feldnamen der JSON-Ausgaben, die Ergebniswerte, die Stufen- und
 * Achsenwerte der Config und die Marke `FESTGEFAHREN_MARKE`.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    keineZusammenfassung: "keine abgeschlossene Zusammenfassung im Worktree",
    fehler: "Fehler",
    unerwarteterFehler: "Unerwarteter Fehler",
    aufrufenLaeuft: "checks.mjs: aufrufen laeuft schon — zwei Aufrufe zugleich gehen nicht",
    keineConfig: "Keine .claude/workflow.config.json unter {wurzel} — bitte im Projekt-Root starten.",
    configKeinJson: ".claude/workflow.config.json ist kein gueltiges JSON: {grund}",
    unbekannterWertAbschluss: "Unbekannter Wert {wert} fuer nichtBeimAbschluss bei Pruefung '{cmd}'. Erwartet: {erwartet}.",
    unbekannterWertArt: "Unbekannter Wert {wert} fuer art bei Pruefung '{cmd}'. Erwartet: {erwartet}.",
    unbekannterWertVorab: "Unbekannter Wert {wert} fuer vorab bei Pruefung '{cmd}'. Erwartet: true, false.",
    vorabUndGleichzeitig: "Die Pruefung '{cmd}' traegt vorab und gleichzeitig — sie laeuft entweder vor der gleichzeitigen Phase oder in ihr.",
    unbekannterWertDeferOnHotfix: "Unbekannter Wert {wert} fuer deferOnHotfix bei Pruefung '{cmd}'. Erwartet: true, false.",
    unbekannterWertGewicht: "Unbekannter Wert {wert} fuer weight bei Pruefung '{cmd}'. Erwartet: eine ganze Zahl ab 1.",
    teilUngueltig: "Ungueltiger Wert '{wert}' fuer --part. Erwartet: <i>/<n> aus ganzen Zahlen mit 1 <= i <= n, etwa 2/4.",
    keineBereiche: "keine",
    unbekannterBereich: "Unbekannter Bereich '{name}' bei Pruefung '{cmd}'. Bekannt aus checkAreas: {liste}.",
    abschlussBereicheForm: "abschlussBereiche bei Pruefung '{cmd}' ist keine nicht leere Liste von Bereichsnamen: {wert}.",
    abschlussBereicheOhneAchse: "Die Pruefung '{cmd}' traegt abschlussBereiche ohne nichtBeimAbschluss — ohne die Achse laeuft sie beim Abschluss ohnehin, das Feld bewirkt nichts.",
    abschlussBereicheUnbekannt: "Unbekannter Bereich '{name}' in abschlussBereiche bei Pruefung '{cmd}'. Bekannt aus checkAreas: {liste}.",
    abschlussBereicheAusserhalb: "Der Bereich '{name}' in abschlussBereiche bei Pruefung '{cmd}' steht nicht in ihren areas ({areas}) — seine Beruehrung waehlte sie nie aus.",
    mehrereGuete: "Mehr als eine Guetemessung: {liste} tragen alle 'guete' — hoechstens ein Eintrag darf messen.",
    gueteMerge: "Die Guetemessung '{cmd}' traegt stufe 'merge' — eine Messung erst vor der Freigabe kaeme zu spaet. Zulaessig: {erlaubt}.",
    abschlussAchseStufe: "Die Pruefung '{cmd}' traegt nichtBeimAbschluss und stufe '{stufe}' — dort laeuft sie beim Abschluss ohnehin nicht. Die Achse gilt fuer die Stufe '{paket}'.",
    abschlussOhneGate: "Kein Eintrag der Stufe '{paket}' laeuft beim Abschluss: jeder traegt nichtBeimAbschluss oder einen guete-Block. Damit hat der Abschluss eines Arbeitspakets kein Gate.",
    nichtImportiert: "von keiner Datei importiert",
    nichtMitMusterImportiert: "von keiner Datei mit Muster importiert",
    abhaengig: "Bereich {bereich} beruehrt ueber Import von {ueber}",
    importeUnbekannt: "voller Umfang: die Importe liessen sich nicht erheben",
    ableitungOhnePruefung: "ohne Pruefung: {pfad} — {grund}",
    ableitung: "abgeleitet: {pfad} ueber {ueber} → {bereiche}",
    ohneMusterWeitere: "{genannt} und {weitere} weitere",
    ohneMusterEine: "voller Umfang: {liste} trifft kein Muster",
    ohneMusterMehrere: "voller Umfang: {liste} treffen kein Muster",
    nurBlobs: "{dateien}: nur Blobs und Stempel",
    gitDiffGescheitert: "git diff gegen '{basis}' schlug fehl: {grund}",
    gitStatusGescheitert: "git status schlug fehl: {grund}",
    bereichEiner: "Bereich {namen}",
    bereichMehrere: "Bereiche {namen}",
    immerLaufend: "als immer laufend festgelegt",
    nichtZugeordnet: "nicht zugeordnet",
    beruehrt: "{bereiche} beruehrt",
    unberuehrt: "{bereiche} unberuehrt{blobs}",
    grundGueteVeroeffentlichung: "Guetemessung: laeuft vor dem Veroeffentlichen immer",
    grundGueteAbschluss: "Abschlusslauf: Guetemessung braucht die vollstaendige Testmenge",
    grundStufeSpaeter: "Stufe {stufe}, gefahren wird {gefahren}",
    grundNichtBeimAbschluss: "Abschlusslauf: {achse}, laeuft beim Veroeffentlichen",
    grundNichtDirektBeruehrt: "Abschlusslauf: {achse}, keiner der Bereiche aus abschlussBereiche ({bereiche}) direkt beruehrt, laeuft beim Veroeffentlichen",
    grundDirektBeruehrt: "Abschlusslauf: {bereiche} direkt beruehrt",
    grundTestsBetroffen: "Abschlusslauf: {n} von {m} Tests betroffen",
    grundWartetIntegration: "wartet auf den Integrationslauf",
    grundKeineDateiDesPakets: "keine Datei des Pakets",
    pushPruefungUngueltig: "Ungueltiger Wert {genannt} fuer pushPruefung. Erwartet: \"lokal\" oder { \"ort\": \"buildDienst\", \"zweig\": \"<name>\" }, wahlweise mit \"machine\": \"<rechner>\" aus [a-z0-9-].",
    pushPruefungZweig: "pushPruefung: Der Pruefzweig '{zweig}' ist {feld}. Der Pruefzweig muss ein eigener Zweig sein.",
    releaseKommandosUngueltig: "Ungueltiger Wert {genannt} fuer release.commands. Erwartet: eine Liste von Befehlszeilen.",
    releasePublishKommandosUngueltig: "Ungueltiger Wert {genannt} fuer release.publishCommands. Erwartet: eine Liste von Befehlszeilen.",
    unbekannterBereichWahl: "Unbekannter Bereich '{name}'. Konfiguriert in checkAreas: {liste}.",
    keinerBereich: "keiner",
    grundAnkerUnbekannt: "voller Umfang: Anker '{ref}' laesst sich nicht aufloesen",
    grundBereichslauf: "Bereichslauf {bereich}: {grund}",
    grundVeroeffentlichung: "Veroeffentlichungsstufe: voller Umfang",
    grundLeeresPaket: "leeres Paket: keine Aenderung seit {basis}",
    grundFreigabe: "Freigabestufe: laeuft vor jeder Freigabe",
    grundPushGeprueft: "Stufe push, geprueft beim push main",
    zuschnittHinweis: "{cmd} ist jedem Bereich zugeordnet und laeuft bei jeder Aenderung — Zuschnitt pruefen (checks.mjs areas)",
    gitLsFilesGescheitert: "git ls-files schlug fehl: {grund}",
    bremseVersuche: "{versuche}{marke}; es laeuft keine Pruefung mehr (Exit 3).",
    zusammenfassung: "Zusammenfassung: {pfad}",
    letzterVersuch: "Letzter erlaubter Versuch: {cmd} ist {versuche}-mal gleich gescheitert ({fehler}) — der naechste Aufruf faehrt nichts und endet mit Exit 3.",
    festgefahrenHinweis: "Hinweis: festgefahren an {cmd} — {versuche}-mal gleich gescheitert ({fehler})",
    standUnlesbar: "Der Stand von '{pfad}' liess sich nicht lesen: {grund}",
    hashObjectGescheitert: "git hash-object schlug fehl: {grund}",
    hashObjectAnzahl: "git hash-object lieferte {hashes} Hashes fuer {pfade} Pfade.",
    gueteOhneErgebnis: "Guete: kein auswertbares Ergebnis ({grund})",
    gueteErgebnis: "Guete: {anteil} % erreicht, Marke {marke} % — {grund}",
    gueteNichtGestartet: "nicht gestartet: ein frueheres Kommando war rot",
    gueteAusgelassen: "ausgelassen: {grund}",
    nichtProtokolliert: "Hinweis: Ausfuehrung nicht protokolliert ({pfad}): {grund}",
    dauerNichtGemessen: "Dauer nicht gemessen",
    obergrenze: " — Obergrenze {grenze} s um {ueber} s ueberschritten",
    haengend: "haengend: nach {grenze} s Grenze abgebrochen",
    // Teil 3 (#1496): ab `berichtszeilen`.
    // Der Vermerk hinter der Dauer einer gleichzeitig gelaufenen Pruefung (Issue #1071).
    nebenMarke: "neben anderen gemessen",
    berichtKopf: "Fuer den Abschlussbericht:",
    berichtGelaufen: "gelaufen: {cmd} → {ergebnis}, {dauer}{zusatz} — {grund}",
    berichtAusgelassen: "ausgelassen: {cmd} → {grund}",
    berichtTeilweise: "teilweise: {cmd} → {n} von {m} Tests",
    berichtHinweis: "hinweis: {text}",
    keinePruefung: "keine Pruefung, weil nichts veraendert wurde",
    gewackelt: "Gewackelt: {cmd} → erst rot, dann gruen{erstlauf}",
    gewackeltFrueher: "Gewackelt: {cmd} → erst rot, dann gruen (früherer Lauf vom {zeitpunkt})",
    ausgabeErstlauf: " — Ausgabe des ersten Laufs: {pfad}",
    ausgabe: " — Ausgabe: {pfad}",
    rotWiederholt: "rot, auch bei der Wiederholung",
    berichtZustand: "zustand: {cmd} → {zustand} — {grund}",
    zustandBestanden: "bestanden",
    zustandRot: "mit Funden",
    zustandOhneErgebnis: "ohne auswertbares Ergebnis",
    zustandNichtGelaufen: "nicht gelaufen",
    gewackeltAusgang: "gewackelt (erst rot, dann gruen)",
    protokolleNichtGeleert: "Hinweis: {ordner} nicht geleert: {grund}",
    ausgabeNichtAbgelegt: "Hinweis: Ausgabe nicht abgelegt ({pfad}): {grund}",
    wartezeit: "Wartezeit: {dauer}",
    wartezeitKarte: "{lauf}, zusammen {summe} in {laeufe} Laeufen fuer Karte #{karte}",
    zusammenfassungNichtGeschrieben: "Zusammenfassung konnte nicht geschrieben werden ({pfad}): {grund}",
    dauerTabelleNichtGeschrieben: "Warnung: --summary-file '{pfad}': Tabelle der Dauern nicht geschrieben: {grund}",
    dauerTabellePfadLeer: "leerer Pfad",
    dauerTabelleKopf: "Dauern je Pruefung — Stufe {stufe}",
    dauerTabelleTeil: ", Teil {teil}",
    dauerTabelleSpalten: "| Pruefung | Ergebnis | Dauer |",
    dauerTabelleSumme: "Summe",
    teillauf: "Teillauf: nur die zuletzt roten Pruefungen",
    teilLeer: "Teil {teil}: leer, keine Pruefung in diesem Teil",
    mutationInTeil: "Mutationstest: {cmd} → in Teil {teil}",
    standUnveraendert: "Stand unveraendert seit {zeitpunkt}: {marke} ({befund}). Neu pruefen mit --fresh.",
    merkmalRot: "Fehlermerkmal in der Ausgabe: '{merkmal}' — der Lauf gilt als rot",
    gueteKommandoRot: "kein Anteil erhoben — das Kommando selbst war rot",
    gueteMerkmal: "kein Anteil erhoben — Fehlermerkmal '{merkmal}' in der Ausgabe",
    ohneRueckgabewert: "ohne Rueckgabewert",
    hinweisGescheitert: "Hinweis-Pruefung gescheitert: {cmd} ({wie})",
    rueckgabewert: "Rueckgabewert {status}",
    gitLogGescheitert: "git log {basis}..HEAD schlug fehl: {grund}",
    gitShowGescheitert: "git show {sha} schlug fehl: {grund}",
    verursacherAnker: "Verursacher nicht bestimmbar: Anker '{basis}' laesst sich nicht aufloesen",
    verursacherFehler: "Verursacher nicht bestimmbar: {fehler}",
    verursacherKeine: "Keine abgeschlossene Karte seit {basis} beruehrt diese Pruefung.",
    commitOhneKarte: "Commit ohne Karte {shas}",
    verursacherZeile: "Verursacher ({cmd}): {text}",
    fundZeile: "Fund ({cmd}): {text}",
    umgebungZeile: "Umgebung ({cmd}): {text}",
    keineWeitere: "keine weitere Pruefung",
    stufeZusaetzlich: "Stufe {stufe}: zusaetzlich zur Paketstufe laeuft {liste}",
    ausgelassenVorab: "ausgelassen: {cmd} — {grund}",
    ausgabeAbgelegt: "Ausgabe abgelegt: {pfad}",
    erstlaufAbgelegt: "Ausgabe des ersten Laufs abgelegt: {pfad}",
    wiederholung: "Wiederholung: {cmd} war rot — einmal auf demselben Stand wiederholt",
    teillaufGruen: "Teillauf gruen — es folgt der volle Lauf als Nachweis",
    formatFixStart: "Format-Fix: Lauf rot — {cmd} laeuft einmal, danach ein neuer Durchgang",
    formatFixAusgefuehrt: "Format-Fix: {cmd} → ausgefuehrt",
    formatFixNichtGereicht: "Format-Fix lief und hat nicht gereicht",
    formatFixArbeitsbaum: "Der Arbeitsbaum ist veraendert — die vom Format-Fix geaenderten Dateien (git status) gehoeren in den Commit",
    mutationAngekuendigt: "danach einmal der Mutationstest {cmd}, nur berichtet",
    mutationStart: "Mutationstest — laeuft einmal, nur berichtet, haelt nicht an",
    mutationZeile: "Mutationstest: {cmd} → {ergebnis} ({wie}), {dauer} — nur berichtet, haelt nicht an",
    mutationAusgelassen: "Mutationstest: ausgelassen, die Pruefung ist rot",
    mutationOhneDatei: "Mutationstest: {cmd} → ausgelassen, keine geaenderte Datei unter dem Platzhalter",
    mutationAngekuendigtHalt: "danach einmal der Mutationstest {cmd}, haelt unter der Marke {marke} %",
    mutationStartHalt: "Mutationstest — laeuft einmal, haelt unter der Marke {marke} %",
    mutationZeileWert: "Mutationstest: {cmd} → {ergebnis} ({wie}), {dauer} — {wert}: {folge}",
    mutationWert: "Anteil {anteil} %, Marke {marke} %",
    mutationWertUnter: "Anteil {anteil} % unter der Marke {marke} %",
    mutationOhneWert: "Ausfall, kein auswertbarer Wert: {grund}; Marke {marke} %",
    mutationAusfall: "das Kommando endete mit {wie}",
    mutationFolgeBericht: "nur berichtet, haelt nicht an",
    mutationFolgeGenuegt: "genuegt",
    mutationFolgeHalt: "haelt an",
    strengeLuecke: "Luecke ({zeile}): {fehlt} — haelt nicht an",
    lueckeOhneMutation: "kein mutationCommand",
    lueckeOhneMarke: "kein mutationQuality",
    lueckeOhneGuete: "keine Guetemessung (quality)",
    keineKartennummer: "'{wert}' ist keine Kartennummer fuer --finish. Erwartet: eine Nummer oder nichts.",
    abschlussMitStufe: "--finish und --stage '{stufe}' zusammen: Der Abschluss einer Karte faehrt die Stufe '{paket}'. Vor dem Veroeffentlichen laeuft der volle Umfang ohne --finish.",
    abschlussMitBereich: "--finish und --area zusammen: zwei Eingrenzungen in einem Lauf. Der Bereichslauf gehoert in die Arbeit, --finish an ihr Ende.",
    unbekannteStufe: "Unbekannte Stufe '{wert}'. Erwartet: {liste}.",
    unbekanntesArgument: "Unbekanntes Argument: '{arg}'",
    releaseOnlyOhnePro: "release-only gehört zum Pro-Teil card-check; kit/checks/release.mjs fehlt in dieser Installation.",
    releaseOnlyOhneStufe: "--release-only verlangt --release-stage <minor|major> und --since <basis>.",
    releaseStufeOhneReleaseOnly: "--release-stage gilt nur zusammen mit --release-only.",
    releaseOnlyMitEingrenzung: "--release-only und {schalter} zusammen: Der Lauf faehrt den Beleg und die Stufe merge.",
    releaseOnlyOhneBasis: "--release-only: der Anker '{ref}' ist kein Commit — ohne Basis gibt es keinen Beleg.",
    releaseOnlyDecideArgument: "--decide nimmt nur --json dazu, nicht '{arg}'.",
    grundReleaseBeleg: "Beleg der Release-Ableitung: Release-Schritte auf der Basis, verglichen mit dem Baum",
    grundReleaseBelegt: "release-only: push main hat den Stand geprueft, die Release-Aenderungen belegt der Beleg",
    messungAbgebrochen: "Messung abgebrochen: {grund}",
    bereichsabgleichKopf: "Abgleich der Pruefbereiche (Hinweis, haelt nicht an):",
    teileVerteilenOhneTeil: "teileVerteilen: n muss eine ganze Zahl ab 1 sein, ist {n}",
    bereichsabgleichLuecke: "- {test} laedt {datei} aus Bereich {bereich}, den {kommando} nicht ausloest",
    bereichsabgleichFehler: "Abgleich der Pruefbereiche nicht moeglich: {grund}",
    keinVerzeichnis: "--in '{pfad}' ist kein Verzeichnis.",
    integrationMitSince: "--integration und --since zusammen: Der Integrationslauf bestimmt seinen Nullpunkt selbst.",
    integrationMitEingrenzung: "--integration und {schalter} zusammen: Der Integrationslauf faehrt den vollen Umfang der Paketstufe, ohne Eingrenzung.",
    hotfixOhnePush: "--hotfix gilt nur zusammen mit --stage push: Der Hotfix prueft den Stand, der hinausgeht.",
    hotfixMitBereich: "--hotfix und --area zusammen: Der Hotfix faehrt jede faellige Pruefung ohne Eingrenzung.",
    nachholenOhnePush: "--catch-up gilt nur zusammen mit --stage push: Nachgeholt wird der volle Umfang der Veroeffentlichung.",
    nachholenMitEingrenzung: "--catch-up und {schalter} zusammen: Das Nachholen faehrt den vollen Umfang ohne Eingrenzung.",
    grundStrengeBereiche: "Pruefumfang nach Bereichen (Strenge): {grund}",
    grundNachholen: "Nachholen (--catch-up): voller Umfang",
    grundAufstieg: "Strenge gestiegen seit {basis}: voller Umfang",
    strengeBereiche: "nur die seit {basis} beruehrten Bereiche",
    strengeOhneMutation: "kein Mutationstest",
    strengeNachholen: "voller Umfang mit Mutationstest (--catch-up)",
    strengeAufstieg: "Strenge gestiegen seit {basis}: voller Umfang mit Mutationstest",
    strengeAbweichung: "Abweichung {schalter}: {wert} statt {vorgabe}",
    grundNachAuslieferung: "Hotfix: laeuft nach der Auslieferung (deferOnHotfix), der naechste push main holt sie nach",
    grundIntegration: "Integrationslauf: voller Umfang der Paketstufe",
    grundIntegrationStufe: "Integrationslauf: Stufe {stufe} laeuft beim Veroeffentlichen",
    grundIntegrationGuete: "Integrationslauf: die Guetemessung laeuft beim Veroeffentlichen",
    grundIntegrationOhneNullpunkt: "Integrationslauf ohne Nullpunkt: weder ein gruener Lauf in {datei} noch {ref}",
    integrationStart: "Integrationslauf seit {commit} ({quelle}): {pakete}",
    integrationKeinePakete: "kein Paket seitdem",
    integrationObergrenze: "Integrationslauf: Obergrenze von {dauer} erreicht — abgebrochen, Ergebnis offen",
    ausgangBestanden: "ohne Fund beendet",
    ausgangRot: "mit Fund beendet",
    ausgangRotWiederholt: "mit Fund beendet, auch in der Wiederholung",
    ausgangHaengend: "abgebrochen: {haengt}",
    ausgangObergrenze: "Obergrenze des Integrationslaufs erreicht",
    ausgangNachRot: "nach einem Fund davor nicht gestartet",
    integrationNichtGeschrieben: "Hinweis: {pfad} nicht geschrieben: {grund}",
    integrationGepushtOhneWert: "--pushed ohne Commit. Erwartet: --pushed <commit>",
    integrationGepushtUnbekannt: "'{commit}' ist kein Commit in diesem Repository — {datei} bleibt unveraendert.",
    unbekannterBefehl: "Unbekannter Befehl: '{befehl}'. Erwartet: plan, run, integration oder areas",
    altname: "unbekannt: '{name}' — englischer Name: '{englisch}'",
  }),
  en: Object.freeze({
    keineZusammenfassung: "no completed summary in the worktree",
    fehler: "Error",
    unerwarteterFehler: "Unexpected error",
    aufrufenLaeuft: "checks.mjs: aufrufen is already running — two calls at the same time are not possible",
    keineConfig: "No .claude/workflow.config.json under {wurzel} — please start in the project root.",
    configKeinJson: ".claude/workflow.config.json is not valid JSON: {grund}",
    unbekannterWertAbschluss: "Unknown value {wert} for notAtCompletion on check '{cmd}'. Expected: {erwartet}.",
    unbekannterWertArt: "Unknown value {wert} for kind on check '{cmd}'. Expected: {erwartet}.",
    unbekannterWertVorab: "Unknown value {wert} for upfront on check '{cmd}'. Expected: true, false.",
    vorabUndGleichzeitig: "The check '{cmd}' carries upfront and concurrent — it runs either before the concurrent phase or in it.",
    unbekannterWertDeferOnHotfix: "Unknown value {wert} for deferOnHotfix on check '{cmd}'. Expected: true, false.",
    unbekannterWertGewicht: "Unknown value {wert} for weight on check '{cmd}'. Expected: a whole number from 1.",
    teilUngueltig: "Invalid value '{wert}' for --part. Expected: <i>/<n> of whole numbers with 1 <= i <= n, for instance 2/4.",
    keineBereiche: "none",
    unbekannterBereich: "Unknown area '{name}' on check '{cmd}'. Known from checkAreas: {liste}.",
    abschlussBereicheForm: "completionAreas on check '{cmd}' is not a non-empty list of area names: {wert}.",
    abschlussBereicheOhneAchse: "The check '{cmd}' carries completionAreas without notAtCompletion — without the axis it runs at completion anyway, the field has no effect.",
    abschlussBereicheUnbekannt: "Unknown area '{name}' in completionAreas on check '{cmd}'. Known from checkAreas: {liste}.",
    abschlussBereicheAusserhalb: "The area '{name}' in completionAreas on check '{cmd}' is not in its areas ({areas}) — touching it would never select the check.",
    mehrereGuete: "More than one quality measurement: {liste} all carry 'quality' — at most one entry may measure.",
    gueteMerge: "The quality measurement '{cmd}' carries stage 'merge' — a measurement only before the release would come too late. Allowed: {erlaubt}.",
    abschlussAchseStufe: "The check '{cmd}' carries notAtCompletion and stage '{stufe}' — there it does not run at completion anyway. The axis applies to the stage '{paket}'.",
    abschlussOhneGate: "No entry of the stage '{paket}' runs at completion: each carries notAtCompletion or a quality block. So the completion of a work package has no gate.",
    nichtImportiert: "not imported by any file",
    nichtMitMusterImportiert: "not imported by any file with a pattern",
    abhaengig: "area {bereich} touched via import of {ueber}",
    importeUnbekannt: "full scope: the imports could not be determined",
    ableitungOhnePruefung: "no check: {pfad} — {grund}",
    ableitung: "derived: {pfad} via {ueber} → {bereiche}",
    ohneMusterWeitere: "{genannt} and {weitere} more",
    ohneMusterEine: "full scope: {liste} matches no pattern",
    ohneMusterMehrere: "full scope: {liste} match no pattern",
    nurBlobs: "{dateien}: blobs and stamps only",
    gitDiffGescheitert: "git diff against '{basis}' failed: {grund}",
    gitStatusGescheitert: "git status failed: {grund}",
    bereichEiner: "area {namen}",
    bereichMehrere: "areas {namen}",
    immerLaufend: "set to always run",
    nichtZugeordnet: "not assigned",
    beruehrt: "{bereiche} touched",
    unberuehrt: "{bereiche} untouched{blobs}",
    grundGueteVeroeffentlichung: "quality measurement: always runs before the release",
    grundGueteAbschluss: "completion run: the quality measurement needs the full test set",
    grundStufeSpaeter: "stage {stufe}, running {gefahren}",
    grundNichtBeimAbschluss: "completion run: {achse}, runs at release",
    grundNichtDirektBeruehrt: "completion run: {achse}, none of the areas from completionAreas ({bereiche}) touched directly, runs at release",
    grundDirektBeruehrt: "completion run: {bereiche} touched directly",
    grundTestsBetroffen: "completion run: {n} of {m} tests affected",
    grundWartetIntegration: "waits for the integration run",
    grundKeineDateiDesPakets: "no file of the package",
    pushPruefungUngueltig: "Invalid value {genannt} for pushCheck. Expected: \"local\" or { \"location\": \"buildService\", \"branch\": \"<name>\" }, optionally with \"machine\": \"<computer>\" from [a-z0-9-].",
    pushPruefungZweig: "pushCheck: the check branch '{zweig}' is {feld}. The check branch must be a branch of its own.",
    releaseKommandosUngueltig: "Invalid value {genannt} for release.commands. Expected: a list of command lines.",
    releasePublishKommandosUngueltig: "Invalid value {genannt} for release.publishCommands. Expected: a list of command lines.",
    unbekannterBereichWahl: "Unknown area '{name}'. Configured in checkAreas: {liste}.",
    keinerBereich: "none",
    grundAnkerUnbekannt: "full scope: anchor '{ref}' cannot be resolved",
    grundBereichslauf: "area run {bereich}: {grund}",
    grundVeroeffentlichung: "release stage: full scope",
    grundLeeresPaket: "empty package: no change since {basis}",
    grundFreigabe: "approval stage: runs before every approval",
    grundPushGeprueft: "stage push, checked at push main",
    zuschnittHinweis: "{cmd} is assigned to every area and runs on every change — check the cut (checks.mjs areas)",
    gitLsFilesGescheitert: "git ls-files failed: {grund}",
    bremseVersuche: "{versuche}{marke}: failed the same way {versuche} times; no check runs any more (exit 3).",
    zusammenfassung: "Summary: {pfad}",
    letzterVersuch: "Last allowed attempt: {cmd} failed the same way {versuche} times ({fehler}) — the next call runs nothing and ends with exit 3.",
    festgefahrenHinweis: "Note: stuck at {cmd} — failed the same way {versuche} times ({fehler})",
    standUnlesbar: "The state of '{pfad}' could not be read: {grund}",
    hashObjectGescheitert: "git hash-object failed: {grund}",
    hashObjectAnzahl: "git hash-object returned {hashes} hashes for {pfade} paths.",
    gueteOhneErgebnis: "Quality: no evaluable result ({grund})",
    gueteErgebnis: "Quality: {anteil} % reached, threshold {marke} % — {grund}",
    gueteNichtGestartet: "not started: an earlier command was red",
    gueteAusgelassen: "skipped: {grund}",
    nichtProtokolliert: "Note: execution not logged ({pfad}): {grund}",
    dauerNichtGemessen: "duration not measured",
    obergrenze: " — limit {grenze} s exceeded by {ueber} s",
    haengend: "hanging: aborted after the {grenze} s limit",
    nebenMarke: "measured alongside others",
    berichtKopf: "For the completion report:",
    berichtGelaufen: "ran: {cmd} → {ergebnis}, {dauer}{zusatz} — {grund}",
    berichtAusgelassen: "skipped: {cmd} → {grund}",
    berichtTeilweise: "partial: {cmd} → {n} of {m} tests",
    berichtHinweis: "note: {text}",
    keinePruefung: "no check, because nothing was changed",
    gewackelt: "Flaky: {cmd} → red first, then green{erstlauf}",
    gewackeltFrueher: "Flaky: {cmd} → red first, then green (earlier run of {zeitpunkt})",
    ausgabeErstlauf: " — output of the first run: {pfad}",
    ausgabe: " — output: {pfad}",
    rotWiederholt: "rot, also on the retry",
    berichtZustand: "state: {cmd} → {zustand} — {grund}",
    zustandBestanden: "passed",
    zustandRot: "with findings",
    zustandOhneErgebnis: "no usable result",
    zustandNichtGelaufen: "not run",
    gewackeltAusgang: "flaky (red first, then green)",
    protokolleNichtGeleert: "Note: {ordner} not emptied: {grund}",
    ausgabeNichtAbgelegt: "Note: output not stored ({pfad}): {grund}",
    wartezeit: "Wait time: {dauer}",
    wartezeitKarte: "{lauf}, together {summe} in {laeufe} runs for card #{karte}",
    zusammenfassungNichtGeschrieben: "The summary could not be written ({pfad}): {grund}",
    dauerTabelleNichtGeschrieben: "Warning: --summary-file '{pfad}': table of durations not written: {grund}",
    dauerTabellePfadLeer: "empty path",
    dauerTabelleKopf: "Duration per check — stage {stufe}",
    dauerTabelleTeil: ", part {teil}",
    dauerTabelleSpalten: "| Check | Result | Duration |",
    dauerTabelleSumme: "Total",
    teillauf: "Partial run: only the checks red last time",
    teilLeer: "Part {teil}: empty, no check in this part",
    mutationInTeil: "Mutation test: {cmd} → in part {teil}",
    standUnveraendert: "State unchanged since {zeitpunkt}: {marke} ({befund}). Check again with --fresh.",
    merkmalRot: "Error marker in the output: '{merkmal}' — the run counts as red",
    gueteKommandoRot: "no share collected — the command itself was red",
    gueteMerkmal: "no share collected — error marker '{merkmal}' in the output",
    ohneRueckgabewert: "without return code",
    hinweisGescheitert: "Hint check failed: {cmd} ({wie})",
    rueckgabewert: "return code {status}",
    gitLogGescheitert: "git log {basis}..HEAD failed: {grund}",
    gitShowGescheitert: "git show {sha} failed: {grund}",
    verursacherAnker: "causers cannot be determined: anchor '{basis}' cannot be resolved",
    verursacherFehler: "causers cannot be determined: {fehler}",
    verursacherKeine: "No completed card since {basis} touches this check.",
    commitOhneKarte: "commit without card {shas}",
    verursacherZeile: "Causers ({cmd}): {text}",
    fundZeile: "Finding ({cmd}): {text}",
    umgebungZeile: "Environment ({cmd}): {text}",
    keineWeitere: "no further check",
    stufeZusaetzlich: "Stage {stufe}: in addition to the package stage runs {liste}",
    ausgelassenVorab: "skipped: {cmd} — {grund}",
    ausgabeAbgelegt: "Output stored: {pfad}",
    erstlaufAbgelegt: "Output of the first run stored: {pfad}",
    wiederholung: "Retry: {cmd} was red — repeated once on the same state",
    teillaufGruen: "Partial run green — the full run follows as evidence",
    formatFixStart: "Format fix: run red — {cmd} runs once, then a new pass",
    formatFixAusgefuehrt: "Format fix: {cmd} → executed",
    formatFixNichtGereicht: "Format fix ran and was not enough",
    formatFixArbeitsbaum: "The working tree has changed — the files changed by the format fix (git status) belong in the commit",
    mutationAngekuendigt: "then once the mutation test {cmd}, reported only",
    mutationStart: "mutation test — runs once, reported only, does not stop",
    mutationZeile: "Mutation test: {cmd} → {ergebnis} ({wie}), {dauer} — reported only, does not stop",
    mutationAusgelassen: "Mutation test: skipped, the check is red",
    mutationOhneDatei: "Mutation test: {cmd} → skipped, no changed file under the placeholder",
    mutationAngekuendigtHalt: "then once the mutation test {cmd}, stops below the marker {marke} %",
    mutationStartHalt: "mutation test — runs once, stops below the marker {marke} %",
    mutationZeileWert: "Mutation test: {cmd} → {ergebnis} ({wie}), {dauer} — {wert}: {folge}",
    mutationWert: "score {anteil} %, marker {marke} %",
    mutationWertUnter: "score {anteil} % below the marker {marke} %",
    mutationOhneWert: "failure, no evaluable value: {grund}; marker {marke} %",
    mutationAusfall: "the command ended with {wie}",
    mutationFolgeBericht: "reported only, does not stop",
    mutationFolgeGenuegt: "sufficient",
    mutationFolgeHalt: "stops",
    strengeLuecke: "Gap ({zeile}): {fehlt} — does not stop",
    lueckeOhneMutation: "no mutationCommand",
    lueckeOhneMarke: "no mutationQuality",
    lueckeOhneGuete: "no quality measurement (quality)",
    keineKartennummer: "'{wert}' is no card number for --finish. Expected: a number or nothing.",
    abschlussMitStufe: "--finish and --stage '{stufe}' together: the completion of a card runs the stage '{paket}'. Before publishing the full scope runs without --finish.",
    abschlussMitBereich: "--finish and --area together: two restrictions in one run. The area run belongs in the work, --finish at its end.",
    unbekannteStufe: "Unknown stage '{wert}'. Expected: {liste}.",
    unbekanntesArgument: "Unknown argument: '{arg}'",
    releaseOnlyOhnePro: "release-only belongs to the Pro part card-check; kit/checks/release.mjs is missing in this installation.",
    releaseOnlyOhneStufe: "--release-only needs --release-stage <minor|major> and --since <base>.",
    releaseStufeOhneReleaseOnly: "--release-stage only together with --release-only.",
    releaseOnlyMitEingrenzung: "--release-only and {schalter} together: the run runs the proof and the stage merge.",
    releaseOnlyOhneBasis: "--release-only: the anchor '{ref}' is not a commit — without a base there is no proof.",
    releaseOnlyDecideArgument: "--decide takes only --json besides, not '{arg}'.",
    grundReleaseBeleg: "proof of the release derivation: release steps on the base, compared with the tree",
    grundReleaseBelegt: "release-only: push main checked the state, the proof covers the release changes",
    messungAbgebrochen: "measurement aborted: {grund}",
    bereichsabgleichKopf: "Comparison of the check areas (hint, never stops):",
    teileVerteilenOhneTeil: "teileVerteilen: n must be a whole number of at least 1, is {n}",
    bereichsabgleichLuecke: "- {test} loads {datei} from area {bereich}, which {kommando} does not trigger",
    bereichsabgleichFehler: "Comparison of the check areas not possible: {grund}",
    keinVerzeichnis: "--in '{pfad}' is not a directory.",
    integrationMitSince: "--integration and --since together: the integration run determines its zero point itself.",
    integrationMitEingrenzung: "--integration and {schalter} together: the integration run runs the full scope of the package stage, without restriction.",
    hotfixOhnePush: "--hotfix only together with --stage push: the hotfix checks the state that goes out.",
    hotfixMitBereich: "--hotfix and --area together: the hotfix runs every due check without restriction.",
    nachholenOhnePush: "--catch-up only together with --stage push: what is caught up on is the full scope of publishing.",
    nachholenMitEingrenzung: "--catch-up and {schalter} together: catching up runs the full scope without restriction.",
    grundStrengeBereiche: "scope by areas (strictness): {grund}",
    grundNachholen: "catch-up (--catch-up): full scope",
    grundAufstieg: "strictness rose since {basis}: full scope",
    strengeBereiche: "only the areas touched since {basis}",
    strengeOhneMutation: "no mutation test",
    strengeNachholen: "full scope with mutation test (--catch-up)",
    strengeAufstieg: "strictness rose since {basis}: full scope with mutation test",
    strengeAbweichung: "deviation {schalter}: {wert} instead of {vorgabe}",
    grundNachAuslieferung: "hotfix: runs after delivery (deferOnHotfix), the next push main catches up on it",
    grundIntegration: "integration run: full scope of the package stage",
    grundIntegrationStufe: "integration run: stage {stufe} runs at publishing",
    grundIntegrationGuete: "integration run: the quality measurement runs at publishing",
    grundIntegrationOhneNullpunkt: "integration run without zero point: neither a green run in {datei} nor {ref}",
    integrationStart: "Integration run since {commit} ({quelle}): {pakete}",
    integrationKeinePakete: "no package since",
    integrationObergrenze: "Integration run: upper limit of {dauer} reached — aborted, result open",
    ausgangBestanden: "finished without a finding",
    ausgangRot: "finished with a finding",
    ausgangRotWiederholt: "finished with a finding, in the repetition too",
    ausgangHaengend: "aborted: {haengt}",
    ausgangObergrenze: "upper limit of the integration run reached",
    ausgangNachRot: "not started after a finding before it",
    integrationNichtGeschrieben: "Note: {pfad} not written: {grund}",
    integrationGepushtOhneWert: "--pushed without a commit. Expected: --pushed <commit>",
    integrationGepushtUnbekannt: "'{commit}' is no commit in this repository — {datei} stays unchanged.",
    unbekannterBefehl: "Unknown command: '{befehl}'. Expected: plan, run, integration or areas",
    altname: "unknown: '{name}' — English name: '{englisch}'",
  }),
});

/**
 * Ein Config-Wert in der Sprache des Prozesses: englisch der Name aus dem Board-Teil
 * config-namen, deutsch und ohne den Teil der Wert, wie dieses Modul ihn liest.
 */
function configWert(pfad, wert) {
  return spracheJetzt() === "en" ? CONFIG_WERTE[pfad]?.[wert] ?? wert : wert;
}

// Das Vokabular der Ausloeser im Ausfuehrungsprotokoll, wie die Hilfe es nennt — Vertrag (E14).
const AUSLOESER_HILFE = "bereiche | ohne-bereich | ohne-zuordnung | veroeffentlichung | anker";

// Die Hilfe gibt es genau einmal, englisch, in jedem Projekt (Issue #1564, Plan #1548 E7). Die
// Config-Werte nennt sie darum unter ihrem englischen Namen, den jedes Projekt lesen kann.
const HILFE = `checks.mjs (claude-workflow-kit v{version}) — due checks

  node checks.mjs plan [--since <ref>] [--stage <stage>] [--area <name>] [--finish [n]] [--hotfix] [--part <i>/<n>] [--in <path>]
  node checks.mjs run  [--since <ref>] [--stage <stage>] [--area <name>] [--finish [n]] [--retry] [--fresh] [--hotfix] [--catch-up] [--part <i>/<n>] [--summary-file <path>] [--in <path>]
  node checks.mjs run  --release-only --release-stage <minor|major> --since <base> [--in <path>]
  node checks.mjs run  --integration [--in <path>]
  node checks.mjs integration [--pushed <commit>] [--in <path>]
  node checks.mjs areas
  node checks.mjs areas suggest [--json]
  node checks.mjs areas compare [--json]
  node checks.mjs release-only [--base <sha>] [--head <sha>] [--merge-ref <ref>] [--json]
  node checks.mjs release-only --decide [--json]

plan  Prints as JSON which buildChecks must run after the current work package
      and which may be skipped — every decision with its reason. Nothing is
      executed.
run   Executes exactly this selection in phases and writes the summary
      to {zusammenfassung}. First the checks marked 'upfront' run one after
      another in config order; after a red there no further check starts.
      Then the checks marked 'concurrent' run side by side, at most
      {gleichzeitigEnv} at a time (default {gleichzeitigVorgabe};
      1 runs them one after another; measured in issue #1119: fastest with 2
      and the only stable value). This phase runs to its end so that every red
      one is known; its output stands as one closed block per check in config
      order, and the report line marks the duration with '({nebenMarke})'.
      Then the remaining checks run one after another in config order and stop
      at the first red check; after a red in an earlier phase they do not start.
      At --stage push and with --integration no phase stops at a red check:
      every check runs to its end, only the upper limit of the integration run
      stops. Every entry in laufen[] carries 'ausgang' (one of {ausgaenge}:
      passed, red, aborted without result, did not run) and 'ausgangGrund';
      a run with an aborted check or one that did not run is not green.
      A red run ends with an exit code other than 0.
      Besides the return code, 'run' scans the output of every command for a
      fixed list of general failure markers ({fehlermerkmale}). A match turns
      the check red, even with return code 0 — no config field switches this
      off. A false red is the safe direction: the command errs in one
      direction only, checking more.
      Every red command carries its failure fingerprint in laufen[] ('fehler'):
      the names of the failed tests (node:test, Jest/Vitest, Maven Surefire),
      otherwise the first error line, without timestamps, durations, temporary
      paths and random values. The field 'festgefahren' of the summary counts
      per command the identically failed real runs in a row; green or another
      fingerprint resets the sequence, an adopted result does not count.
      From night.stuckAfter identical failures (default {festgefahrenVorgabe})
      on, the check counts as stuck. Unattended (KIT_AGENT_MODEL set) the run
      announces this as the last allowed attempt, and the next call runs
      nothing more, even with --fresh: it prints
      '{festgefahrenMarke} <command> — <error>', leaves the previous summary as
      it is, adds only 'festgefahren.ausgeloest' and ends with exit 3.
      Interactively nothing brakes; the run only prints a notice on stderr that
      names the command, the count of identical failures and the error.
      The summary ACCOMPANIES the run: it is created before the first command
      and overwritten before every further one and after every concurrent one;
      a running command still stands there with the result '{nichtGestartet}'.
      Only the last version carries 'abgeschlossen': true. A run that dies at
      the clock or with its session thus leaves a state that is never fully
      green.
      The output of every command that is not green lies complete under
      {protokollOrdner}/; the report line and the field 'protokoll' in the
      summary name the path. Every real run empties the folder, an adopted one
      leaves it in place.
      If the state has not changed since the last run — same anchor, same
      stage, the same files with the same blob hashes, the same config —, no
      command runs: 'run' adopts the result of the previous run (a red one
      too) with its exit code and writes the evidence again with a fresh
      timestamp. '--fresh' forces the real run.
      If the previous run was RED and only the state has changed since, not
      the selection — same anchor, same stage, the same config, the same
      selected commands in the same order, but other files or blob hashes —,
      'run' first runs a PARTIAL RUN with only the commands that were red last
      time, along the same axes as the full run. If they turn green, the full
      run follows exactly once in the same call as evidence; if they stay red,
      the call ends red, the others keep the result '{nichtGestartet}', the
      summary carries 'teillauf': true and the report block marks the partial
      run before its lines. After a fix the same call as before is therefore
      enough. '--fresh' skips the partial run and runs everything at once.
      A hanging check is aborted: the limit is five times the median of its
      green runs from .claude/ausfuehrungen.tsv, at least 3 min, without
      history 15 min. The whole process group receives SIGTERM, SIGKILL after
      5 s; the check stands red with the limit it hit (field 'haengend' in
      laufen[]).
      With --finish or --retry every red check is repeated exactly once on the
      same state, immediately and before the phase stops; the output says so.
      Red then green is a flaky check: result 'gruen', field 'gewackelt'
      ({ erstDauerMs, protokoll }), the output of the first run under
      {protokollOrdner}/ with the suffix '-erstlauf', and a line in the report
      that names the command and the output of the first run. Red and red
      stays red: result 'rot', field 'wiederholt'. 'dauerMs' is the sum of
      both runs; the brake counts the pair as one attempt. Hint checks are
      never repeated. Partial run and full run each repeat at most once.
      With --finish <n> the summary keeps the flaky checks of the card (field
      'gewackeltKarte': [{ cmd, zeitpunkt, karte }]), carried on over the runs
      of the same card and started anew for another card; without a card
      number the field is missing. A case from an earlier run stands in the
      report with the time of that run.
      As the red command every message names the first with result 'rot', only
      without such one the first that is not green.
      At the end stands the block for the completion report with ready-made
      lines per check that ran and per check that was skipped, each with its
      reason, the adopted run included; the field 'berichtszeilen' of the
      summary carries the same. The block opens with the wait time: the wall
      clock of this run from the call to the result (field 'wartezeitMs';
      'dauerGesamtMs' stays the sum of the single durations), and with
      --finish <n> the total of all runs of the same card (field
      'wartezeitKarte'); an adopted run counts as a run without time. Unattended,
      the total starts anew with every session, because the runner discards
      the summary before every round; the total over sessions comes from the
      run report. If a check takes longer than {obergrenzeMs} ms, its line
      notes the excess (field 'ueberObergrenzeMs'); the run does not turn red
      because of it.
      CHECK SLOTS: a full run — the selection carries the full scope before the
      first command, or the stage is 'push' or 'merge' — takes one of the
      machine-wide slots before its first command and frees it at its end;
      a narrowed run takes none (field 'pruefplatz': 'eingegrenzt'). The limit
      is {fullChecksEnv} (default {fullChecksVorgabe}), counted over all
      projects and sessions on this machine; the slots lie in
      {fullChecksDirEnv} (default {fullChecksOrt}). Unattended
      (KIT_AGENT_MODEL set) a run waits in a {fullChecksTaktS}-second rhythm
      until fewer than the limit are taken; the wait stands in the field
      'pruefplatzWartezeitMs' and in the line 'Check slot: waited <s> s' of
      the report block — 'wartezeitMs' stays the wall clock of the run.
      An interactive run never waits: with all slots taken it takes one above
      the limit and prints before its first command 'Check slots: <taken> of
      <limit> taken, this run does not wait' (field 'pruefplatz':
      'ueberzogen'). The run sets {fullChecksHeldEnv}=<slot> for everything it
      starts; a run with this variable set takes no own slot ('gehalten').
      If the place cannot be written, the run continues without a slot
      ('ungezaehlt'). Every slot taken appends {zeit, belegt, projekt,
      interaktiv} to belegung.jsonl next to the slots. The slots are a Pro
      part: in Community a run takes none (field 'pruefplatz':
      '{ohnePlaetze}'), and a set {fullChecksEnv} or {fullChecksDirEnv}
      stands before the first command in the line of passed-over Pro
      settings.
      At the stage 'push' a red run names the CAUSERS: the cards whose commits
      since the anchor touched an area of the red check, read from
      '(Issue #<n>)' in the subject and 'Refs #<n>' in the body. A commit
      without a recognizable number appears with its short SHA, a check
      without area assignment counts as touched by every card. If no card
      touched the check, a sentence says so instead of an empty list; if the
      anchor cannot be resolved or a git call fails, the reason stands in the
      same place. The search explains a finding that has already fallen and
      changes nothing about the outcome of the run.
      Every execution appends a line to {ausfuehrungen}; at its end stand its
      trigger ({ausloeser}),
      the triggering areas and, for the full scope, the files without
      a pattern, then 'gleichzeitig' if the duration was measured next to other
      checks, last 'erstlauf' or 'wiederholung' on the two runs of a repeated
      check.
areas
      Prints as JSON how the areas are cut: per area its patterns, in how many
      of the area-bound commands of the package stage it stands (field 'nennend', its total in the
      neighbouring field), whether it is highlighted (in all or all but one, from
      {hervorhebungAb} commands on) and the reason from 'coupledAreas'. Per
      command ('kommandoUrteile') how many areas it names and whether it is
      broad (all or all but one, from {hervorhebungAb} commands on); a broad
      command without a coupled area stands in plan ('zuschnitt') and in run as
      a hint in the report.
      Plus the inventory: all files versioned by git without a checkAreas
      match, split into exempted (noCheck, with reason) and without any
      assignment.
integration
      Prints as JSON the zero point of the next integration run (field
      'nullpunkt': the younger of the green commit in {integrationDatei} and
      origin/<mainBranch>, with its source), the packages since then (commits
      naming 'Issue #N' between zero point and HEAD), the last result and the
      age of the last fetch. Changes nothing.
      With --pushed <commit>, after a green push main: writes the commit with
      the result gruen to {integrationDatei}; it becomes the zero point.
areas suggest
      Suggests check areas, measured from which files every test loads or
      mentions (JavaScript, TypeScript, Java): per area its patterns and the
      tests and files behind it, per command the areas it should trigger,
      splits and merges of existing areas, commands that could be split (no
      command line) and candidates for scaffoldOnly. A command running tests
      of another language cannot be assessed and keeps its areas, with the
      reason. Works without .claude/workflow.config.json (empty config, the
      groups are then the folders of the test files).
areas compare
      Compares the configured areas with the measurement: a gap is a test
      that loads a file whose area its command does not trigger (risk); an
      area none of its command's tests loads is a note. Needs the config.
      Both never change the config and always end with exit code 0; --json
      prints the same data as JSON.
release-only
      Proves for the build service that the release commit --head (default
      HEAD) is exactly the output of the release steps over --base (default
      HEAD^): reads Release-Stufe: and Release-Version: from the commit, runs
      release.publishCommands from the config of --base in a worktree and
      compares the trees; --base must carry a green or skipped check. No
      command comes from the commit message. With --merge-ref <ref> it proves
      instead that the merge state has the tree of the green-checked --head.
      Exit code 0 only when proven; --json prints belegt, grund and dateien.
      With --decide it says whether merge production may take the short
      path: Pro, pushPruefung.ort buildDienst, release.publishCommands set,
      origin/<mainBranch> green by the runs of the check branches,
      auslieferungNachholen of the strictness false, and the merge of
      origin/<productionBranch> and origin/<mainBranch> has the tree of
      origin/<mainBranch>. Exit code 0 only for the short path; the reason
      names the first missing condition; --json prints kurzweg, grund and
      gestuetztAuf { commit, zeitpunkt, adresse }.

  --since <ref>   Anchor against which the changes are determined (default HEAD).
                  If the anchor cannot be resolved — an empty value too —,
                  all checks run.
  --stage <s>     Stage to run: {stufen} (default {stufeVorgabe}).
                  push runs paket too. Checks of later stages appear as skipped
                  with a reason. push runs every due check, even with an empty
                  package and untouched areas. merge checks only what push main
                  did not check: the stage merge always, the package stage by
                  areas over the files since --since, the stage push not.
  --area <n>      Runs the check groups of exactly one checkAreas area instead
                  of determining the touched ones from the changed files. The
                  intended way when only the complete group exists for the
                  changed file — a group run justified like this is no breach
                  of the ten-minute mark but its sanctioned case. An unknown
                  name aborts and names the configured areas. Combinable with
                  --since, --stage and --fresh: '--area' says WHETHER a check
                  is affected, '--stage' further WHEN it is due.
  --finish [n]    This run completes exactly one work package. Then every check
                  with 'notAtCompletion' stays out, and the quality measurement
                  too — both with a reason in the list of skips, and both run
                  again before publishing. Exception: a check with
                  'completionAreas' does run when the package touches one of
                  these areas directly (pattern or derivation from the
                  importers, not the dependent areas). The card number is optional and
                  serves the evaluation per card; a value that is no number
                  aborts. Not together with --stage push|merge (there runs
                  exactly what the completion skips) and not together with
                  --area (two restrictions in one run). Only the completion of
                  a card sets the switch: whoever forgets it checks more.
  --integration   Only for 'run': the integration run. Every check of the
                  package stage runs without area filter, including those with
                  'notAtCompletion'; the stages push and merge, the quality
                  measurement and mutationCommand keep their time at
                  publishing. The anchor is the zero point (see 'integration'),
                  so a red run names the causing cards since then. The result
                  goes to {integrationDatei} (gruen, rot, offen); after
                  {integrationObergrenze} the run aborts and stays open. Not
                  together with --since, --stage, --area or --finish.
  --retry         Only for 'run': repeat a red check once on the same state, as
                  --finish does anyway. For the run before push main and merge
                  production, together with --stage. Accepted with 'plan' and
                  without effect, allowed with --finish and without effect.
  --fresh         Only for 'run': adopt no result and run no partial run with
                  the last red ones, but really run all due commands — for
                  instance on suspicion of a flaky test.
  --hotfix        The shortened run of a hotfix, only together with --stage
                  push and not with --area. Every check with 'deferOnHotfix:
                  true' stays out with the reason 'after delivery'; the next
                  push main catches up on it. The summary names both lists in
                  the field 'hotfix' ({ gelaufen, nachDerAuslieferung }). A
                  placeholder '{files:<expr>}' in mutationCommand carries the
                  files since --since under the expression; with none there
                  the mutation test is skipped with a reason. It stays
                  reported only. Without --hotfix the placeholder runs with
                  its expression. Accepted with 'plan' and shows the same
                  selection. A hotfix ignores the strictness.
  --catch-up      Only together with --stage push and not with --hotfix or
                  --area: the full scope of the push stage and the mutation
                  test, regardless of the strictness — what a project in
                  'light' catches up on before delivery. The same scope runs
                  when the strictness rose against the state at --since.
  --part <i>/<n>  Only part i of n of the selected checks: first the stage,
                  --hotfix and the other options select, then the selection is
                  split. Distributed greedily by weight, the heaviest check
                  first into the lightest part; on a tie the order in
                  'buildChecks' decides. The weight is 'weight', otherwise for
                  a 'node --test' command the number of test files its
                  patterns match, otherwise 1. 'upfront' checks stay upfront
                  within their part, an empty part ends green with a line
                  that it is empty, and only part n/n runs mutationCommand —
                  the other parts note it as 'in part n/n'. The summary names
                  the part; a part never adopts the result of another one.
                  Whole numbers with 1 <= i <= n, anything else aborts.
                  Accepted with 'plan' and shows the same selection.
  --summary-file <path>
                  Only for 'run': after the run, appends a Markdown table of
                  the durations to the file (never overwrites): a heading with
                  stage and, with --part, the part i/n, one row per check
                  with result and duration, longest first, and a total row.
                  The durations read like those of the 'ran:' lines. An empty
                  value or a file that cannot be written gives one warning
                  line; exit code and result of the run stay unchanged.
  --release-only  Only for 'run', with --release-stage <minor|major> and
                  --since <base>: the local proof before the release commit.
                  It runs release.publishCommands of the config at <base> in a
                  worktree with the stage, takes the version from the output of
                  the first command and compares the tree with the working
                  directory after 'git add -A' ('git write-tree'); the proof is
                  one entry in 'laufen', then the checks with stage merge run.
                  Not with --stage, --area, --finish, --hotfix, --catch-up,
                  --integration or --part.
  --in <path>     Working directory of the run instead of the process working
                  directory: config, anchor, commands and summary apply there.
                  For the worktree of the release skills — so the call stands
                  alone and needs no 'cd'.
  --help, -h      This overview (runs as the only call without a config).

Read is .claude/workflow.config.json in the working directory: 'buildChecks'
(command string or { cmd } with the axes 'areas'/'always', 'stage', 'quality'
and 'notAtCompletion: {abschlussWerte}' — the check counts only when
publishing and stays out of the completion run, plus
'completionAreas': [area names] — it does run in the completion run when one
of these areas is touched directly, as well as
'concurrent': true — the check runs in the first phase next to others, as well as
'upfront': true — the check runs before the concurrent phase, as well as
'deferOnHotfix': true — with --hotfix the check runs after delivery, as well as
'weight': <whole number from 1> — the weight with --part instead of the count of
test files, as well as
'kind': {arten} — the check only reports: it always ends green, even on a
crash, without return code, marker and quality check; every output line
'Hinweis: <text>' stands in 'hinweise' and as a hint in the report, an exit
from {hinweisAbsturzAb} on as a failed hint check) and 'checkAreas' (area name
-> path patterns). Patterns know '*' within a path segment and '**' across
segment boundaries; a directory is covered as 'frontend/**'.
`;

/** Ein Config-Wert unter seinem englischen Namen, unabhaengig von der Prozesssprache. */
function configWertEnglisch(pfad, wert) {
  return CONFIG_WERTE[pfad]?.[wert] ?? wert;
}

/** Die Nutzungshilfe, englisch. */
function hilfe() {
  const werte = {
    version: KIT_VERSION,
    zusammenfassung: SUMMARY_DATEI,
    gleichzeitigEnv: GLEICHZEITIG_ENV,
    gleichzeitigVorgabe: GLEICHZEITIG_VORGABE,
    nebenMarke: TEXTE.en.nebenMarke,
    fehlermerkmale: FEHLERMERKMALE.join(", "),
    festgefahrenVorgabe: FESTGEFAHREN_VORGABE,
    festgefahrenMarke: FESTGEFAHREN_MARKE,
    nichtGestartet: "nicht gestartet",
    ausgaenge: AUSGAENGE.map((w) => `'${w}'`).join(", "),
    protokollOrdner: PROTOKOLL_ORDNER,
    obergrenzeMs: PRUEFDAUER_OBERGRENZE_MS,
    ausfuehrungen: AUSFUEHRUNGEN_DATEI,
    hervorhebungAb: HERVORHEBUNG_AB_KOMMANDOS,
    stufen: STUFEN.map(stufeGetippt).join(" | "),
    stufeVorgabe: stufeGetippt(STUFEN[0]),
    abschlussWerte: NICHT_BEIM_ABSCHLUSS.map((w) => configWertEnglisch("buildChecks[].nichtBeimAbschluss", w)).join(" | "),
    arten: ARTEN.map((w) => configWertEnglisch("buildChecks[].art", w)).join(" | "),
    hinweisAbsturzAb: HINWEIS_ABSTURZ_AB,
    ausloeser: AUSLOESER_HILFE,
    // Die Plaetze sind seit Issue #2016 der Pro-Teil `check-slots`; die Hilfe nennt sie auch in
    // Community und laedt ihn dafuer nicht. SYNC: die Konstanten in kit/checks/pruefplaetze.mjs.
    fullChecksEnv: "KIT_FULL_CHECKS_MAX",
    fullChecksVorgabe: 3,
    fullChecksDirEnv: "KIT_FULL_CHECKS_DIR",
    // Aus Segmenten wie TEMP_ORTE: Die Hilfe nennt den Ort nur, sie beschreibt ihn nicht.
    fullChecksOrt: `${posix.join("/tmp", "claude-<uid>", "kit-prueflaeufe")}, on Windows <tmpdir>/kit-prueflaeufe`,
    fullChecksTaktS: 2,
    fullChecksHeldEnv: "KIT_FULL_CHECKS_HELD",
    ohnePlaetze: OHNE_PLAETZE.art,
    integrationDatei: INTEGRATION_DATEI,
    integrationObergrenze: `${INTEGRATION_OBERGRENZE_MS / 60_000} minutes`,
  };
  return HILFE.replaceAll(/\{([A-Za-z_]\w*)\}/g, (_, name) => String(werte[name]));
}

class ChecksError extends Error {}

function fail(nachricht) {
  throw new ChecksError(nachricht);
}

/** Meldet einen Fehler wie die Kommandozeile: `Fehler:` fuer den erwarteten, sonst `Unerwarteter Fehler:`. */
function fehlerMelden(err) {
  const prefix = t(err instanceof ChecksError ? "fehler" : "unerwarteterFehler");
  aufStderr(`${prefix}: ${err.message}\n`);
}

/**
 * Ein Aufruf wie von der Kommandozeile, aber im selben Prozess (Issue #1212, Plan #1199
 * E6). `argv` ist die Kommandozeile ohne `node checks.mjs`, `cwd` das Projekt. `env`
 * ersetzt die Umgebungsvariablen, `git(args, optionen)` den Start von git — im Ergebnis
 * wie `spawnSync`.
 *
 * Rueckgabe: `{ status, stdout, stderr }` wie bei einem Kindprozess, fuer `run` als
 * Promise. Die Signal-Handler des CLI setzt ein solcher Aufruf nicht: Sie beendeten den
 * aufrufenden Prozess. Zwei Aufrufe zugleich gehen nicht — die Umgebung gilt fuer das
 * ganze Modul —, der zweite bricht darum mit einem Fehler ab.
 */
export function aufrufen(argv, { cwd, env = process.env, git: gitStarter } = {}) {
  if (umgebung.aktiv) throw new Error(t("aufrufenLaeuft"));
  let stdout = "";
  let stderr = "";
  umgebung = {
    aktiv: true,
    cwd,
    env,
    argv,
    git: gitStarter,
    signale: false,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  };
  const ende = (status) => {
    umgebung = {};
    return { status, stdout, stderr };
  };
  const scheitern = (err) => {
    fehlerMelden(err);
    return ende(1);
  };
  let code;
  try {
    code = main(argv);
  } catch (err) {
    return scheitern(err);
  }
  return code instanceof Promise ? code.then(ende, scheitern) : ende(code);
}

/**
 * Wie git gestartet wird (Issue #1136). Der Test-Hook `CHECKS_GIT_FAKE` nach dem Muster
 * `NIGHT_CLAUDE_CMD` nennt ein Node-Skript, das statt git startet — mit dem laufenden
 * Node und ohne Shell, damit das Fake weder ein x-Bit noch einen Platz im PATH
 * braucht. Ohne die Variable bleibt der Start, wie er war.
 */
export function gitStart(args, env = umgebungsVariablen()) {
  const fake = env.CHECKS_GIT_FAKE;
  return fake ? { cmd: process.execPath, args: [fake, ...args] } : { cmd: "git", args };
}

function gitSpawn(args, optionen) {
  if (umgebung.git) return umgebung.git(args, optionen);
  const start = gitStart(args);
  return spawnSync(start.cmd, start.args, optionen);
}

function git(...args) {
  return gitSpawn(args, { cwd: wurzel(), encoding: "utf-8" });
}

/** git in einem gewaehlten Repository; ohne `cwd` in der Projektwurzel wie `git`. */
function gitIn(cwd, ...args) {
  return cwd === undefined ? git(...args) : gitSpawn(args, { cwd, encoding: "utf-8" });
}

// --- Config ----------------------------------------------------------------

/**
 * Die Config des Projekts. Fehlt die Datei, bricht der Aufruf ab — ausser mit `ohneDateiLeer`:
 * Dann gilt die leere Config. Das nutzt allein `areas suggest`, damit der Installer den
 * Vorschlag beim ersten Einrichten holen kann, bevor es eine Config gibt (Plan #1713 A13).
 */
function ladeConfig({ ohneDateiLeer = false } = {}) {
  const pfad = join(wurzel(), ".claude", "workflow.config.json");
  if (!existsSync(pfad)) {
    if (ohneDateiLeer) return normalisiereConfig({}).config;
    fail(t("keineConfig", { wurzel: wurzel() }));
  }
  try {
    return normalisiereConfig(JSON.parse(readFileSync(pfad, "utf-8"))).config;
  } catch (err) {
    return fail(t("configKeinJson", { grund: err.message }));
  }
}

/** Die Hoechstlaenge der Beschreibung einer Pruefung, wie `maxLength` im Schema (Issue #2091). */
const BESCHREIBUNG_MAX = 200;

/**
 * Der Eintrag ohne eine Beschreibung, die nicht in die Zusammenfassung darf. Gueltig ist ein
 * nicht leerer Text bis BESCHREIBUNG_MAX Zeichen.
 */
function ohneUngueltigeBeschreibung(objekt) {
  const { beschreibung, ...rest } = objekt;
  const gueltig = typeof beschreibung === "string" && beschreibung.trim() !== "" && beschreibung.length <= BESCHREIBUNG_MAX;
  return gueltig ? objekt : rest;
}

/**
 * Die String-Form und das Objekt nur mit `cmd` bedeuten dasselbe.
 *
 * Die fehlende `stufe` wird hier auf `paket` gesetzt und nicht erst bei der
 * Auswahl (Issue #758): So laufen die String-Form, das Objekt ohne `stufe` und
 * das Objekt mit `stufe: "paket"` durch dieselbe Bahn, und jede bestehende
 * Config behaelt ihr Verhalten. Ein Default, der an jeder Lesestelle einzeln
 * nachgezogen wuerde, waere die naechste Stelle, an der er einmal fehlt.
 */
function normalisiere(check) {
  const objekt = typeof check === "string" ? { cmd: check } : check;
  // Ein unbekannter Wert bricht ab wie eine unbekannte Stufe (Issue #946): Er bliebe
  // sonst wirkungslos, die Pruefung liefe beim Abschluss weiter mit, und der Autor der
  // Config haette den Gegenteil-Effekt bestellt, ohne es zu merken. Hier und nicht in
  // einer eigenen Regel darunter, weil der Wert genau hier durch die eine Bahn geht,
  // durch die auch die fehlende Stufe geht.
  const nichtBeimAbschluss = objekt.nichtBeimAbschluss ?? null;
  if (nichtBeimAbschluss !== null && !NICHT_BEIM_ABSCHLUSS.includes(nichtBeimAbschluss)) {
    const genannt = typeof nichtBeimAbschluss === "string" ? `'${nichtBeimAbschluss}'` : JSON.stringify(nichtBeimAbschluss);
    fail(t("unbekannterWertAbschluss", {
      wert: genannt,
      cmd: objekt.cmd,
      erwartet: NICHT_BEIM_ABSCHLUSS.map((w) => configWert("buildChecks[].nichtBeimAbschluss", w)).join(", "),
    }));
  }
  // Dieselbe Haltung fuer `art` (Issue #1155): Ein vertippter Wert machte aus der
  // Hinweis-Pruefung still eine gewoehnliche, deren Fund den Lauf rot faerbte. Das Feld
  // steht nur im Ergebnis, wenn es gesetzt ist — so bleibt der Fingerabdruck jeder
  // bestehenden Config unveraendert.
  if (objekt.art !== undefined && !ARTEN.includes(objekt.art)) {
    const genannt = typeof objekt.art === "string" ? `'${objekt.art}'` : JSON.stringify(objekt.art);
    fail(t("unbekannterWertArt", { wert: genannt, cmd: objekt.cmd, erwartet: ARTEN.map((w) => configWert("buildChecks[].art", w)).join(", ") }));
  }
  // `vorab` (Issue #1519) bricht bei jedem Wert ausser true und false ab: Ein "ja" liesse
  // die Pruefung still hinter den gleichzeitigen laufen, und ihr schnelles Rot kaeme so
  // spaet wie vorher. Zugleich mit `gleichzeitig` widerspricht sich der Eintrag — er kann
  // nicht vor der gleichzeitigen Phase und in ihr laufen. Das Feld bleibt, wie es steht,
  // damit der Fingerabdruck jeder bestehenden Config unveraendert bleibt.
  if (objekt.vorab !== undefined && typeof objekt.vorab !== "boolean") {
    fail(t("unbekannterWertVorab", { wert: JSON.stringify(objekt.vorab), cmd: objekt.cmd }));
  }
  if (objekt.vorab === true && objekt.gleichzeitig === true) {
    fail(t("vorabUndGleichzeitig", { cmd: objekt.cmd }));
  }
  // `deferOnHotfix` (Issue #2051, Plan #2038, E2) mit derselben Haltung: Ein "ja" liesse die
  // Pruefung still vor der Auslieferung laufen oder, vertippt, sie unbemerkt verschieben. Das
  // Feld bleibt, wie es steht; gelesen wird es allein von der Push-Auswahl mit `--hotfix`.
  if (objekt.deferOnHotfix !== undefined && typeof objekt.deferOnHotfix !== "boolean") {
    fail(t("unbekannterWertDeferOnHotfix", { wert: JSON.stringify(objekt.deferOnHotfix), cmd: objekt.cmd }));
  }
  pruefeGewicht(objekt);
  // `beschreibung` (Issue #2091, Plan #2087, A9) ist eine Anzeige, kein Steuerwert: Ein Text
  // ueber BESCHREIBUNG_MAX Zeichen oder ein Wert, der kein Text ist, bricht nicht ab, sondern
  // faellt still heraus — den Befund nennt die Einstellungs-Oberflaeche. Ein Tippfehler darin
  // soll keinen Prueflauf anhalten.
  // `abschlussBereiche` (Issue #1530, Plan #1529) geht unveraendert durch; ob es etwas
  // bewirken kann, prueft `pruefeAbschlussBereiche`, weil es dafuer `checkAreas` braucht.
  const abschlussBereiche = objekt.abschlussBereiche ?? null;
  return {
    ...ohneUngueltigeBeschreibung(objekt),
    stufe: objekt.stufe ?? STUFEN[0], nichtBeimAbschluss, abschlussBereiche, gleichzeitig: objekt.gleichzeitig === true,
  };
}

/**
 * `weight` (Issue #2188, Plan #2176, E2) ersetzt beim Teilen mit `--part` die Zaehlung der
 * Testdateien. Ein Wert, der keine ganze Zahl ab 1 ist, verschoebe die Teile still und bricht
 * darum ab; das Feld bleibt, wie es steht.
 */
function pruefeGewicht(objekt) {
  if (objekt.weight === undefined || (Number.isInteger(objekt.weight) && objekt.weight >= 1)) return;
  fail(t("unbekannterWertGewicht", { wert: JSON.stringify(objekt.weight), cmd: objekt.cmd }));
}

/**
 * Ein vertippter Bereichsname wuerde eine Pruefung still nie laufen lassen —
 * genau der Fehler, den dieses Kommando verhindern soll. Also Abbruch.
 *
 * Ein LEERES `areas`-Array und die Kombination `areas` + `always` sind hier
 * nicht zu pruefen: Das Schema schliesst beide aus (minItems 1, not). Was das
 * Schema verhindert, muss die Laufzeit nicht erklaeren (Issue #422).
 */
// SYNC: dieselbe Regel prueft kit/settings.mjs (regelBereiche) vor dem Speichern.
function pruefeBereichsnamen(checks, checkAreas) {
  const bekannt = new Set(Object.keys(checkAreas));
  for (const check of checks) {
    for (const name of check.areas ?? []) {
      if (!bekannt.has(name)) {
        const liste = bekannt.size > 0 ? [...bekannt].join(", ") : t("keineBereiche");
        fail(t("unbekannterBereich", { name, cmd: check.cmd, liste }));
      }
    }
  }
}

/**
 * Die Grenzen der Guetemessung (Issue #763, Plan #753): hoechstens ein Eintrag
 * traegt `guete`, und nie mit `stufe: "merge"` — eine Messung erst vor der
 * Freigabe kaeme zu spaet, um noch etwas zu aendern. Beides prueft das Schema
 * nicht: Es sind Aussagen ueber die Liste bzw. ueber zwei Felder zusammen.
 * Derselbe Weg wie beim unbekannten Bereichsnamen: Abbruch statt stiller Wahl.
 */
// SYNC: dieselbe Regel prueft kit/settings.mjs vor dem Speichern (Issue #764).
function pruefeGuete(checks) {
  const traeger = checks.filter((check) => check.guete);
  if (traeger.length > 1) {
    const liste = traeger.map((check) => `'${check.cmd}'`).join(", ");
    fail(t("mehrereGuete", { liste }));
  }
  if (traeger[0]?.stufe === "merge") {
    fail(t("gueteMerge", { cmd: traeger[0].cmd, erlaubt: `${configWert("buildChecks[].stufe", "paket")}, push` }));
  }
}

/**
 * Die Achse `nichtBeimAbschluss` gehoert an die Paketstufe (Issue #946, Plan #944).
 *
 * An einem Eintrag der Stufe `push` oder `merge` sagt sie nichts: Dort laeuft die
 * Pruefung beim Abschluss ohnehin nicht, die Stufe hat es schon entschieden. Ein Feld,
 * das nichts bewirkt, ist entweder ein Irrtum ueber die Achse oder ein Rest — beides
 * faellt hier auf und nicht erst dem naechsten Leser der Config. Derselbe Weg wie beim
 * unbekannten Bereichsnamen: Abbruch statt stiller Wirkungslosigkeit.
 *
 * Diese Regel gilt UNBEDINGT, weil sie eine Aussage ueber die Config selbst ist — anders
 * als `pruefeAbschlussGate`, das eine Aussage ueber den Abschlusslauf trifft.
 */
// SYNC: dieselbe Regel prueft kit/settings.mjs vor dem Speichern (Issue #949).
function pruefeNichtBeimAbschlussStufe(checks) {
  for (const check of checks) {
    if (!check.nichtBeimAbschluss) continue;
    if (check.stufe === STUFEN[0]) continue;
    fail(t("abschlussAchseStufe", { cmd: check.cmd, stufe: configWert("buildChecks[].stufe", check.stufe), paket: configWert("buildChecks[].stufe", STUFEN[0]) }));
  }
}

/**
 * Das Feld `abschlussBereiche` (Issue #1530, Plan #1529, E7): Ein Eintrag mit
 * `nichtBeimAbschluss` nennt die Bereiche, bei deren direkter Beruehrung er beim Abschluss
 * doch laeuft. Jede Form, in der das Feld nichts bewirken koennte, bricht ab — ohne die
 * Achse, als leere oder falsch geformte Liste, mit einem unbekannten Bereich oder mit
 * einem Bereich, der nicht in `areas` steht und den Eintrag darum nie auswaehlte. Die
 * letzte Regel entfaellt bei `always: true` und ohne `areas`: Dort waehlt jeder Bereich
 * den Eintrag aus. Derselbe Weg wie bei `pruefeNichtBeimAbschlussStufe`: Abbruch statt
 * stiller Wirkungslosigkeit, unbedingt, weil es eine Aussage ueber die Config ist.
 */
// SYNC: dieselbe Regel prueft kit/settings.mjs vor dem Speichern (regelAbschlussBereiche, Issue #1532).
function pruefeAbschlussBereiche(checks, checkAreas) {
  const bekannt = new Set(Object.keys(checkAreas));
  for (const check of checks) {
    const liste = check.abschlussBereiche;
    if (liste === null) continue;
    if (!Array.isArray(liste) || liste.length === 0 || liste.some((name) => typeof name !== "string")) {
      fail(t("abschlussBereicheForm", { cmd: check.cmd, wert: JSON.stringify(liste) }));
    }
    if (!check.nichtBeimAbschluss) fail(t("abschlussBereicheOhneAchse", { cmd: check.cmd }));
    for (const name of liste) pruefeAbschlussBereich(check, name, bekannt);
  }
}

function pruefeAbschlussBereich(check, name, bekannt) {
  if (!bekannt.has(name)) {
    fail(t("abschlussBereicheUnbekannt", { name, cmd: check.cmd, liste: bekannt.size > 0 ? [...bekannt].join(", ") : t("keineBereiche") }));
  }
  if (check.always !== true && Array.isArray(check.areas) && !check.areas.includes(name)) {
    fail(t("abschlussBereicheAusserhalb", { name, cmd: check.cmd, areas: check.areas.join(", ") }));
  }
}

/**
 * Das Gate des Abschlusses (Issue #946, Plan #944, E4): Ein Abschlusslauf laesst die
 * Guetemessung und jede Pruefung mit `nichtBeimAbschluss` aus. Traegt JEDER Eintrag der
 * Paketstufe eines von beiden, bleibt nichts uebrig — der Lauf waere gruen, weil er nichts
 * gefahren hat, und ein leeres Gate faellt an nichts auf.
 *
 * Geprueft wird NUR im Abschlusslauf, nicht bei jedem Aufruf. Dieselbe Config bleibt fuer
 * jeden anderen Lauf gueltig, und sie ist es auch: Ohne den Schalter laufen beide
 * Pruefungen. Ein unbedingter Abbruch naehme dagegen einem Prueflauf von Hand ohne Karte,
 * einem Lauf aus `/push-main` oder einem Commit von Hand die Pruefung weg, obwohl dort nie etwas ausgelassen wurde — und genau das
 * schliesst die einseitige Richtung des Plans aus: Wer den Schalter nicht setzt, prueft mehr.
 *
 * Eine Config OHNE Paketstufen-Eintrag faellt hier nicht durch: Sie hatte nie ein Gate,
 * die neue Achse aendert daran nichts, und der Zustand hat seine eigene Meldung im
 * Start-Guard des Runners.
 */
// SYNC: als Warnung vor dem Speichern in kit/settings.mjs (Issue #949), als Halt im
// Start-Guard von kit/night.mjs (Issue #950).
function pruefeAbschlussGate(checks) {
  const paketstufe = checks.filter((check) => check.stufe === STUFEN[0]);
  if (paketstufe.length === 0) return;
  if (paketstufe.some((check) => !check.nichtBeimAbschluss && !check.guete)) return;
  fail(t("abschlussOhneGate", { paket: configWert("buildChecks[].stufe", STUFEN[0]) }));
}

// --- Muster ----------------------------------------------------------------

const REGEX_SONDERZEICHEN = /[.+?^${}()|[\]\\]/;

/**
 * Minimal-Glob: '*' innerhalb eines Pfadsegments, '**' ueber Segmentgrenzen,
 * '/' als Trenner. Ein '**' samt folgendem Trenner darf ganz verschwinden, damit
 * ein Muster wie "doppelstern, Trenner, *.md" auch eine Datei im
 * Wurzelverzeichnis trifft und nicht erst eine in einem Unterverzeichnis.
 *
 * Exportiert, damit test/config-teile.test.mjs die Teile dieses Repos gegen
 * `git ls-files` prueft, ohne die Aufloesung ein zweites Mal zu schreiben
 * (Issue #850) — derselbe Grund wie bei `blobHashes` fuer findings.mjs: Ab der
 * ersten Abweichung bescheinigte die zweite Fassung eine Abdeckung, die das
 * ausfuehrende Kommando nicht sieht.
 */
export function globZuRegex(muster) {
  let quelle = "";
  let i = 0;
  while (i < muster.length) {
    const zeichen = muster[i];
    if (zeichen !== "*") {
      quelle += REGEX_SONDERZEICHEN.test(zeichen) ? `\\${zeichen}` : zeichen;
      i += 1;
    } else if (muster[i + 1] === "*") {
      const mitTrenner = muster[i + 2] === "/";
      quelle += mitTrenner ? "(?:.*/)?" : ".*";
      i += mitTrenner ? 3 : 2;
    } else {
      quelle += "[^/]*";
      i += 1;
    }
  }
  return new RegExp(`^${quelle}$`);
}

/** Die Teile aus der Config als fertige Regexe. Exportiert aus demselben Grund wie `globZuRegex`. */
export function bereicheVorbereiten(checkAreas) {
  return Object.entries(checkAreas).map(([name, muster]) => ({
    name,
    regexe: (muster ?? []).map((m) => globZuRegex(m)),
  }));
}

/**
 * Ordnet jede geaenderte Datei ihren Bereichen zu. Die erste Datei, die kein
 * einziges Muster trifft, wird als `ohneMuster` gemeldet — sie loest den vollen
 * Umfang aus. Der Grund nennt seit Issue #1003 alle solchen Dateien
 * (`ohneMusterGrund`), sonst weiss niemand, welche Muster fehlen.
 *
 * Daneben steht `ohneZuordnung` mit ALLEN solchen Dateien (Issue #922, Plan
 * #917, E8): Der Beobachter fragt, welche Dateien kein Muster finden — nicht,
 * welche es als erste tat. Beides nebeneinander und nicht das eine aus dem
 * anderen: Der Grund-Text ist Text fuer Menschen und wird woertlich gelesen, die
 * Liste sind Daten. Wer die Liste aus dem Satz parsen muesste, haette beim ersten
 * Umformulieren des Satzes eine stille Fehlmessung.
 *
 * Die dritte Antwort ist `ohnePruefung` (Issue #934, Plan #930, E1): eine Datei,
 * zu der es ausdruecklich nichts zu pruefen gibt. Sie zaehlt weder als beruehrt
 * noch als unzugeordnet und traegt ihren Grund mit sich — die Ausnahme von der
 * Regel „im Zweifel laeuft alles" ist nur ertraeglich, wenn sie sich begruendet.
 */
/** Merkt zu jedem getroffenen Bereich die Datei, die nur Blobs und Stempel aendert. */
function blobBereicheMerken(blobBereiche, treffer, pfad) {
  for (const { name } of treffer) {
    if (!blobBereiche.has(name)) blobBereiche.set(name, new Set());
    blobBereiche.get(name).add(pfad);
  }
}

function zuordnen(dateien, bereichsdefinition, freistellungen = [], nurBlobs = new Set()) {
  const beruehrt = new Set();
  const ohneZuordnung = [];
  const ohnePruefung = [];
  // Bereich → die Dateien darin, die nur Blobs und Stempel aendern.
  const blobBereiche = new Map();
  for (const pfad of dateien) {
    const treffer = bereichsTreffer(pfad, bereichsdefinition);
    // Eine Datei mit nur gespiegelten Blob- und Stempelzeilen (Issue #1178, #1521)
    // beruehrt ihre Bereiche nicht; die Bereiche merken sich die Datei, damit der Grund
    // der Auslassung es sagt.
    if (treffer.length > 0 && nurBlobs.has(pfad)) {
      blobBereicheMerken(blobBereiche, treffer, pfad);
      continue;
    }
    // HIER wirkt der Vorrang aus Plan #930, E3: Trifft eine Datei beide Musterarten,
    // gewinnt `checkAreas`, und die Freistellung bleibt fuer sie wirkungslos. Die
    // Auswahl darf nur in eine Richtung irren, naemlich zu mehr Pruefung. Andersherum
    // machte ein zu weit geratenes `ohnePruefung`-Muster einen ganzen Bereich still ab
    // — und ein Bereich, der nicht mehr laeuft, faellt an nichts auf ausser an der Zeit.
    if (treffer.length > 0) {
      for (const bereich of treffer) beruehrt.add(bereich.name);
      continue;
    }
    const frei = freistellungen.find((f) => f.regex.test(pfad));
    if (frei) {
      ohnePruefung.push({ pfad, grund: frei.grund });
      continue;
    }
    ohneZuordnung.push(pfad);
  }
  // `direkt` (Issue #1531, Plan #1529, E4): die Bereiche, die eine geaenderte Datei selbst
  // traegt. Die abhaengigen Bereiche kommen spaeter nur in `beruehrt` dazu.
  return { beruehrt, direkt: new Set(beruehrt), ohneMuster: ohneZuordnung[0] ?? null, ohneZuordnung, ohnePruefung, blobBereiche };
}

/** Die Bereiche, deren Muster einen Pfad treffen. */
function bereichsTreffer(pfad, bereichsdefinition) {
  return bereichsdefinition.filter((b) => b.regexe.some((r) => r.test(pfad)));
}

// --- Ableitung aus den Importen (Issue #1181) --------------------------------

const JS_DATEI = /\.(?:mjs|cjs|js)$/;
// Die statischen Importformen: `import … from`/`export … from` (auch ueber mehrere
// Zeilen), das blosse `import "x"`, `import("x")` und `require("x")`. Lieber eine
// Erwaehnung zu viel als Importeur gezaehlt — das irrt zu mehr Pruefung.
const IMPORT_FORMEN = [
  /\b(?:import|export)\b[^;'"`]*?\bfrom\s*(["'])([^"'\n]+)\1/g,
  /\bimport\s*(["'])([^"'\n]+)\1/g,
  /\b(?:import|require)\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g,
];
// Was `require` ohne Endung aufloest; ein ESM-Import nennt die Endung ohnehin.
const OHNE_ENDUNG = [".js", ".mjs", ".cjs", "/index.js"];

/** Die repo-relativen Pfade, auf die eine relative Importangabe zeigen kann — sonst keine. */
function aufgeloest(pfad, angabe) {
  if (!angabe.startsWith("./") && !angabe.startsWith("../")) return [];
  const ziel = posix.normalize(posix.join(posix.dirname(pfad), angabe));
  if (ziel.startsWith("../")) return [];
  return JS_DATEI.test(ziel) ? [ziel] : [ziel, ...OHNE_ENDUNG.map((endung) => ziel + endung)];
}

/** Die repo-relativen Pfade, die eine Datei relativ importiert. */
function* importZiele(pfad, text) {
  for (const form of IMPORT_FORMEN) {
    for (const treffer of text.matchAll(form)) yield* aufgeloest(pfad, treffer[2]);
  }
}

/** Der Text eines moeglichen Importeurs: leer, wenn er fehlt, `null` bei jedem anderen Lesefehler. */
function importeurLesen(pfad, root = wurzel()) {
  try {
    return readFileSync(join(root, pfad), "utf-8");
  } catch (err) {
    return err.code === "ENOENT" ? "" : null;
  }
}

/**
 * Je Datei die versionierten JavaScript-Dateien, die sie importieren — oder `null`,
 * wenn die Suche scheitert. Eine fehlende Datei (im Arbeitsbaum geloescht) importiert
 * nichts mehr; jeder andere Lesefehler laesst einen Importeur womoeglich ungesehen und
 * gilt darum als Scheitern.
 *
 * Nur `git ls-files` und nicht auch Ungetracktes: Eine neue Datei steht selbst in der
 * Aenderung und waehlt ihre Bereiche dort.
 */
function importeureErheben(root = wurzel()) {
  const ls = gitSpawn(["ls-files", "-z"], { cwd: root, encoding: "utf-8" });
  if (ls.status !== 0) return null;
  const importeure = new Map();
  for (const roh of ls.stdout.split("\0")) {
    const pfad = roh.replaceAll("\\", "/");
    if (!JS_DATEI.test(pfad)) continue;
    const text = importeurLesen(pfad, root);
    if (text === null) return null;
    for (const ziel of importZiele(pfad, text)) {
      if (!importeure.has(ziel)) importeure.set(ziel, new Set());
      importeure.get(ziel).add(pfad);
    }
  }
  return importeure;
}

/** Eine Funktion ohne Argumente, die ihr Ergebnis beim ersten Aufruf rechnet und danach behaelt. */
function einmal(fn) {
  let gerechnet = false;
  let wert;
  return () => {
    if (!gerechnet) {
      wert = fn();
      gerechnet = true;
    }
    return wert;
  };
}

/**
 * Die Importeure mit Muster, die eine Datei erreichen, und deren Bereiche — die Kette
 * laeuft durch Importeure ohne Muster weiter und endet an jedem mit Muster. `besucht`
 * haelt einen Kreis auf.
 */
function importKette(start, importeure, bereichsdefinition) {
  const besucht = new Set([start]);
  const offen = [start];
  const ueber = new Set();
  const bereiche = new Set();
  while (offen.length > 0) {
    for (const importeur of importeure.get(offen.shift()) ?? []) {
      if (besucht.has(importeur)) continue;
      besucht.add(importeur);
      const treffer = bereichsTreffer(importeur, bereichsdefinition);
      if (treffer.length === 0) {
        offen.push(importeur);
        continue;
      }
      ueber.add(importeur);
      for (const bereich of treffer) bereiche.add(bereich.name);
    }
  }
  return {
    direkt: importeure.get(start)?.size ?? 0,
    ueber: [...ueber].sort(vergleicheText),
    bereiche: [...bereiche].sort(vergleicheText),
  };
}

/**
 * Eine JavaScript-Datei ohne Muster erbt die Bereiche der Dateien, die sie importieren
 * (Issue #1181). Ein neuer Test-Helfer trifft meist kein Muster und zog bisher den
 * vollen Umfang nach sich; welche Pruefung er braucht, sagen die Tests, die ihn laden.
 *
 *   - Erreicht die Kette Importeure mit Muster, beruehrt die Datei deren Bereiche.
 *   - Importiert sie niemand mit Muster, loest sie keine Pruefung aus und steht mit
 *     Grund unter `ohnePruefung`: Ein Helfer, den kein Test laedt, bricht keinen.
 *   - Andere Dateiarten und eine scheiternde Suche bleiben in `ohneZuordnung` und
 *     ziehen wie bisher den vollen Umfang — die Auswahl irrt nur zu mehr Pruefung.
 *
 * `abgeleitet` traegt je Datei die Ableitung fuer den Abschlussbericht.
 */
function ausImportenAbleiten(zuordnung, bereichsdefinition, importGraph = importeureErheben) {
  if (!zuordnung.ohneZuordnung.some((pfad) => JS_DATEI.test(pfad))) return { ...zuordnung, abgeleitet: [] };
  const importeure = importGraph();
  if (importeure === null) return { ...zuordnung, abgeleitet: [] };
  const beruehrt = new Set(zuordnung.beruehrt);
  const direktBeruehrt = new Set(zuordnung.direkt);
  const ohnePruefung = [...zuordnung.ohnePruefung];
  const ohneZuordnung = [];
  const abgeleitet = [];
  for (const pfad of zuordnung.ohneZuordnung) {
    if (!JS_DATEI.test(pfad)) {
      ohneZuordnung.push(pfad);
      continue;
    }
    const { direkt, ueber, bereiche } = importKette(pfad, importeure, bereichsdefinition);
    if (bereiche.length > 0) {
      for (const bereich of bereiche) {
        beruehrt.add(bereich);
        direktBeruehrt.add(bereich);
      }
      abgeleitet.push({ pfad, ueber, bereiche });
      continue;
    }
    const grund = t(direkt === 0 ? "nichtImportiert" : "nichtMitMusterImportiert");
    ohnePruefung.push({ pfad, grund });
    abgeleitet.push({ pfad, ueber, bereiche, grund });
  }
  return { ...zuordnung, beruehrt, direkt: direktBeruehrt, ohnePruefung, ohneZuordnung, ohneMuster: ohneZuordnung[0] ?? null, abgeleitet };
}

/**
 * Die Bereiche, die eine Aenderung ueber Importe mitberuehrt (Issue #1208, Plan #1199, E3).
 * Zerfaellt ein Werkzeug in Teile, bricht eine Aenderung an Teil A auch die Teile, die A
 * importieren — ohne diese Ableitung liefe zu wenig, und das ist die unsichere Richtung.
 *
 * Die Kette laeuft Datei fuer Datei und transitiv: von jeder geaenderten Datei zu ihren
 * Importeuren, von dort zu deren Importeuren, durch Dateien mit und ohne Muster. Jeder
 * erreichte Importeur beruehrt seine Bereiche; `besucht` haelt einen Kreis auf. Ein neuer
 * Bereich steht mit der Datei da, deren Import ihn erreichte, zuerst gefunden gewinnt.
 *
 * `importGraph` ist die Erhebung aus `importeureErheben` — dieselbe Literal-Erhebung wie
 * fuer Dateien ohne Muster (#1181): statische und dynamische Importe mit literalem Pfad.
 * Nicht literale Importe sieht sie NICHT, und das ist gewollt: die Nachbar-Importe des
 * Runners (`NACHBAR_*` ueber `pathToFileURL` in `kit/night.mjs`). Diese Kopplungen stehen
 * weiter von Hand in den `areas` des Kommandos, dessen Teil den Nachbarn laedt (E3).
 */
function abhaengigeBereiche(beruehrt, importGraph, bereichsdefinition, startDateien) {
  const besucht = new Set(startDateien);
  const offen = [...startDateien].sort(vergleicheText);
  const bekannt = new Set(beruehrt);
  const abhaengig = [];
  while (offen.length > 0) {
    const ziel = offen.shift();
    for (const importeur of [...(importGraph.get(ziel) ?? [])].sort(vergleicheText)) {
      if (besucht.has(importeur)) continue;
      besucht.add(importeur);
      offen.push(importeur);
      for (const bereich of bereichsTreffer(importeur, bereichsdefinition)) {
        if (bekannt.has(bereich.name)) continue;
        bekannt.add(bereich.name);
        abhaengig.push({ bereich: bereich.name, ueber: ziel });
      }
    }
  }
  return abhaengig;
}

/**
 * Erweitert eine Zuordnung um die abhaengigen Bereiche (Issue #1208). Ausgangspunkt ist
 * jede geaenderte Datei ausser einer, die nur Blob- und Stempelzeilen aendert — die beruehrt nicht
 * einmal ihre eigenen Bereiche. Scheitert die Erhebung, laesst sich nicht sagen, was
 * abhaengt: Dann gilt die Zuordnung als nicht bestimmbar und zieht den vollen Umfang.
 */
function umAbhaengigeErweitern(zuordnung, geaendert, nurBlobs, bereichsdefinition, importGraph) {
  const start = geaendert.filter((pfad) => !nurBlobs.has(pfad));
  if (start.length === 0) return { ...zuordnung, abhaengig: [] };
  const graph = importGraph();
  if (graph === null) return { ...zuordnung, abhaengig: [], importeUnbekannt: true };
  const abhaengig = abhaengigeBereiche(zuordnung.beruehrt, graph, bereichsdefinition, start);
  const beruehrt = new Set(zuordnung.beruehrt);
  for (const { bereich } of abhaengig) beruehrt.add(bereich);
  return { ...zuordnung, beruehrt, abhaengig };
}

/**
 * Die Pruefbereiche, die eine Dateiliste voraussichtlich beruehrt (Issue #1788, Plan #1404,
 * E9): dieselbe Zuordnung wie in `auswahlPlanen` — Muster, Freistellungen, Ableitung fuer
 * Dateien ohne Muster und die abhaengigen Bereiche aus dem Importgraphen —, nur ohne Diff.
 * Der Runner setzt zwei Pakete nur gleichzeitig um, wenn beide nicht leere, disjunkte
 * Bereichsmengen haben und keines `vollerUmfang` ausloest.
 *
 * Die Pfade liest der Aufrufer aus `## Aufgabe` des Pakets mit `pfadTokens` aus
 * `kit/board/geschuetzt.mjs`. Pruefungen mit `always: true` und ohne Bereich tragen keinen
 * Bereich und stehen darum nie in `bereiche` (PO-Antwort 13 zu #1347): Sie laufen in jeder
 * Pruefung des gemeinsamen Standes. Eine Datei ohne Muster oder ein nicht erhebbarer
 * Importgraph ergibt `vollerUmfang: true` — im Zweifel nacheinander.
 */
export function bereicheFuerDateien(dateien, config, root = wurzel()) {
  const bereichsdefinition = bereicheVorbereiten(config.checkAreas ?? {});
  const importGraph = einmal(() => importeureErheben(root));
  const { beruehrt, ohneMuster, importeUnbekannt } = umAbhaengigeErweitern(
    ausImportenAbleiten(
      zuordnen(dateien, bereichsdefinition, freistellungenVorbereiten(config.ohnePruefung)),
      bereichsdefinition,
      importGraph,
    ),
    dateien,
    new Set(),
    bereichsdefinition,
    importGraph,
  );
  return { bereiche: [...beruehrt].sort(vergleicheText), vollerUmfang: ohneMuster !== null || importeUnbekannt === true };
}

/** Die Berichtszeile eines abhaengigen Bereichs (Issue #1208). */
function abhaengigZeile({ bereich, ueber }) {
  return t("abhaengig", { bereich, ueber });
}

/** Der Grund des vollen Umfangs, wenn sich die Importe nicht erheben liessen (Issue #1208). */
const importeUnbekanntGrund = () => t("importeUnbekannt");

/** Die Zeile einer Ableitung im Block `Fuer den Abschlussbericht:` (Issue #1181). */
function ableitungsZeile({ pfad, ueber, bereiche, grund }) {
  if (bereiche.length === 0) return t("ableitungOhnePruefung", { pfad, grund });
  return t("ableitung", { pfad, ueber: ueber.join(", "), bereiche: bereiche.join(", ") });
}

/** Wie viele unzugeordnete Dateien der Grund des vollen Umfangs hoechstens beim Namen nennt. */
const GRUND_DATEIEN_HOECHSTENS = 10;

/**
 * Der Grund des vollen Umfangs wegen unzugeordneter Dateien (Issue #1003, Plan #1001,
 * E2). Er nennt ALLE solchen Dateien, nicht nur die erste: Wer den Bericht liest, soll
 * jedes fehlende Muster sehen und nicht eines nach dem anderen ueber mehrere Laeufe
 * entdecken. Ab der elften Datei steht nur noch die Zahl — ein Grund, der ueber den
 * Bildschirm laeuft, liest niemand; die volle Liste steht in `ohneZuordnung`.
 */
function ohneMusterGrund(ohneZuordnung) {
  const genannt = ohneZuordnung.slice(0, GRUND_DATEIEN_HOECHSTENS).map((pfad) => `'${pfad}'`).join(", ");
  const weitere = ohneZuordnung.length - GRUND_DATEIEN_HOECHSTENS;
  const liste = weitere > 0 ? t("ohneMusterWeitere", { genannt, weitere }) : genannt;
  return t(ohneZuordnung.length === 1 ? "ohneMusterEine" : "ohneMusterMehrere", { liste });
}

/** Die pruefungsfreien Eintraege aus der Config als fertige Regexe samt Grund (Issue #934). */
function freistellungenVorbereiten(ohnePruefung) {
  return (ohnePruefung ?? []).map((e) => ({ regex: globZuRegex(e.muster), grund: e.grund }));
}

// --- Aenderungen -----------------------------------------------------------

// Die Datei mit den Blob-Konstanten und die Form einer solchen Zeile (Issue #1178).
const BLOB_DATEI = "install.mjs";
const BLOB_ZEILE = /^\s*(?:export\s+)?const\s+\w+_B64\s*=\s*"[^"]*";?\s*$/;
// Die Versionsstempel, die `sync-blobs` setzt (Issue #1521): `KIT_VERSION` in jeder
// gestempelten Kit-Datei, `VERSION` nur im Installer.
const KIT_STEMPEL_ZEILE = /^\s*(?:export\s+)?const\s+KIT_VERSION\s*=\s*"[^"]*";?\s*$/;
const INSTALLER_STEMPEL_ZEILE = /^\s*(?:export\s+)?const\s+VERSION\s*=\s*"[^"]*";?\s*$/;
// Der Vermerk im Grund einer Auslassung, die nur daran haengt.
const nurBlobsVermerk = (dateien) => t("nurBlobs", { dateien: [...dateien].sort(vergleicheText).join(", ") });

/** Ob eine geaenderte Zeile von `pfad` nur ein gespiegelter Blob oder ein Stempel ist. */
function istBlobOderStempel(pfad, zeile) {
  if (KIT_STEMPEL_ZEILE.test(zeile)) return true;
  if (pfad !== BLOB_DATEI) return false;
  return BLOB_ZEILE.test(zeile) || INSTALLER_STEMPEL_ZEILE.test(zeile);
}

/**
 * Die Dateien, deren Aenderung seit dem Anker nur aus Blob-Konstanten und
 * Versionsstempeln besteht (Issue #1178, #1521). `sync-blobs` aendert in `install.mjs`
 * bei jeder Aenderung an einer Quelle die gespiegelte Zeile mit, und beim Release in
 * jeder gestempelten Datei die Versionszeile; die Quelle steht selbst im Diff und waehlt
 * die Pruefungen, die sie braucht, und ob Stempel und Blobs stimmen, prueft
 * `sync-blobs --check`. Gilt nur, wenn JEDE geaenderte Zeile, hinzugefuegt oder
 * entfernt, so eine Zeile ist: Eine echte Aenderung loest die Pruefungen weiter aus. Im
 * Zweifel — kein Diff, ein Fehler, eine neue oder geloeschte Datei ohne Stand an einem
 * Ende — beruehrt die Datei ihre Bereiche wie jede andere.
 */
function nurBlobsGeaendert(basis, geaendert) {
  const ergebnis = new Set();
  if (geaendert.length === 0) return ergebnis;
  // Ohne Pfadliste: Sie waere Pathspec und kein woertlicher Pfad; was nicht in
  // `geaendert` steht, faellt unten heraus.
  const diff = git("diff", "--no-color", "--no-ext-diff", "--no-renames", "-U0", basis);
  if (diff.status !== 0) return ergebnis;
  for (const abschnitt of diff.stdout.split(/^(?=diff --git )/m)) {
    const pfad = nurBlobsDatei(abschnitt.split(/\r?\n/));
    if (pfad !== null && geaendert.includes(pfad)) ergebnis.add(pfad);
  }
  return ergebnis;
}

/**
 * Der Pfad einer Datei im Diff, wenn jede ihrer geaenderten Zeilen ein Blob oder ein
 * Stempel ist, sonst `null`. Eine neue oder geloeschte Datei hat an einem Ende keinen
 * Stand und ist nie ausgenommen.
 */
function nurBlobsDatei(zeilen) {
  const kopfEnde = zeilen.findIndex((zeile) => zeile.startsWith("@@"));
  if (kopfEnde < 0) return null;
  const kopf = zeilen.slice(0, kopfEnde);
  if (kopf.includes("--- /dev/null") || kopf.includes("+++ /dev/null")) return null;
  const ziel = kopf.find((zeile) => zeile.startsWith("+++ b/"));
  if (!ziel) return null;
  const pfad = ziel.slice("+++ b/".length);
  const geaendert = zeilen
    .slice(kopfEnde)
    .filter((zeile) => !zeile.startsWith("@@") && (zeile.startsWith("+") || zeile.startsWith("-")));
  if (geaendert.length === 0) return null;
  return geaendert.every((zeile) => istBlobOderStempel(pfad, zeile.slice(1))) ? pfad : null;
}

function ankerAufloesen(refText) {
  // Der leere Wert wird gar nicht erst gefragt: Er ist die Spur einer
  // fehlgeschlagenen merge-base-Substitution und gilt als nicht aufloesbar.
  if (refText === "") return null;
  const res = git("rev-parse", "--verify", "--short", `${refText}^{commit}`);
  const basis = res.stdout.trim();
  return res.status === 0 && basis ? basis : null;
}

/**
 * Zerlegt die NUL-getrennte Ausgabe von `git diff --name-status -z`. Eine
 * Umbenennung (R) und eine Kopie (C) tragen zwei Pfade — beide zaehlen, denn eine
 * verschobene Datei aendert an beiden Enden etwas.
 */
function* diffPfade(roh) {
  const felder = roh.split("\0");
  let i = 0;
  while (i < felder.length) {
    const status = felder[i];
    i += 1;
    if (!status) continue;
    const anzahl = status.startsWith("R") || status.startsWith("C") ? 2 : 1;
    for (let n = 0; n < anzahl && i < felder.length; n += 1, i += 1) {
      if (felder[i]) yield felder[i];
    }
  }
}

function* untracktePfade(roh) {
  for (const eintrag of roh.split("\0")) {
    if (eintrag.startsWith("?? ")) yield eintrag.slice(3);
  }
}

/**
 * Alles, was das Arbeitspaket beruehrt hat: getrackte Aenderungen gegen den
 * Anker (angelegt, geaendert, geloescht, umbenannt) plus Ungetracktes.
 * `--untracked-files=all` ist Pflicht — sonst meldet git ein neues Verzeichnis
 * als einen einzigen Eintrag, und die Datei darin faende nie ihr Muster.
 *
 * Wartende Vorhaben-Notizen fallen hier heraus und nicht erst in `blobHashes`
 * (Issue #546): So beruehrt eine Notiz auch keine `checkAreas` und loest keinen
 * Bereichs-Check aus, zu dem sie nicht gehoert. Der Filter greift damit zugleich
 * fuer `hashes`, die Bereichszuordnung und die Zusammenfassung — alle leiten sich
 * aus `geaendert` ab. Bleibt danach nichts uebrig, ist das Paket leer: Was nicht
 * gestagt werden darf, muss auch nicht geprueft werden.
 */
function geaenderteDateien(basis) {
  const dateien = new Set();

  const diff = git("diff", "--name-status", "-z", basis);
  if (diff.status !== 0) fail(t("gitDiffGescheitert", { basis, grund: diff.stderr.trim() }));
  for (const pfad of diffPfade(diff.stdout)) dateien.add(pfad);

  const status = git("status", "--porcelain", "-z", "--untracked-files=all");
  if (status.status !== 0) fail(t("gitStatusGescheitert", { grund: status.stderr.trim() }));
  for (const pfad of untracktePfade(status.stdout)) dateien.add(pfad);

  // Nach dem Trenner-Normalisieren gefiltert: Kaeme ein Pfad mit Backslash, ginge
  // der Praefix-Vergleich sonst daneben.
  return [...dateien]
    .map((p) => p.replaceAll("\\", "/"))
    .filter((p) => !p.startsWith(WARTEND_PRAEFIX))
    .sort(vergleicheText);
}

// --- Auswahl ---------------------------------------------------------------

function bereichsText(namen) {
  return t(namen.length === 1 ? "bereichEiner" : "bereichMehrere", { namen: namen.join(", ") });
}

/**
 * String und `always: true` laufen beide immer, meinen aber Verschiedenes —
 * vergessen gegen entschieden. Nur der Grund haelt das auseinander.
 */
function entscheidung(check, beruehrt, blobBereiche = new Map()) {
  if (check.always) return { laeuft: true, grund: t("immerLaufend") };
  if (!check.areas) return { laeuft: true, grund: t("nichtZugeordnet") };
  const treffer = check.areas.filter((name) => beruehrt.has(name));
  if (treffer.length > 0) return { laeuft: true, grund: t("beruehrt", { bereiche: bereichsText(treffer) }) };
  // Haette nur die Blob- oder Stempelaenderung die Pruefung ausgeloest, sagt der Grund
  // das (Issue #1178, #1521) — sonst saehe die Auslassung aus wie eine, an der nichts
  // geaendert wurde.
  const blobDateien = new Set(check.areas.flatMap((name) => [...(blobBereiche.get(name) ?? [])]));
  const blobs = blobDateien.size > 0 ? ` (${nurBlobsVermerk(blobDateien)})` : "";
  return { laeuft: false, grund: t("unberuehrt", { bereiche: bereichsText(check.areas), blobs }) };
}

/**
 * Verteilt jede Pruefung auf `laufen` oder `ausgelassen` — in der Reihenfolge der
 * Config, damit beide Listen so lesbar bleiben wie die Datei.
 *
 * Die STUFENAUSWAHL GREIFT VOR der Bereichsauswahl (Issue #758): Wer nicht dran
 * ist, wird gar nicht erst gefragt, ob er betroffen waere. Andersherum stuende im
 * Grund einer ausgelassenen Push-Pruefung „Bereich unberuehrt", obwohl sie auch
 * im beruehrten Bereich nicht gelaufen waere — ein Grund, der auf die falsche
 * Ursache zeigt, kostet beim naechsten Lesen mehr, als er erklaert.
 *
 * `entscheiden` bekommt nur die faelligen Pruefungen und beantwortet die zweite
 * Frage: die des jeweiligen Auswahlfalls (Anker, leeres Paket, Bereiche).
 *
 * Die GUETEMESSUNG laeuft an der Push-Stufe IMMER (Issue #763, E11): AK 8
 * des Fachplans (#738) macht ihr Ergebnis fuer den Stand massgeblich, der
 * veroeffentlicht werden soll — eine wegen leeren Pakets oder unberuehrten
 * Bereichs ausgelassene Messung liesse den Halt ins Leere laufen, und das faellt
 * niemandem auf. An der Paketstufe gilt die normale Auswahl: Dort wird ein
 * Arbeitspaket gemessen, kein Veroeffentlichungsstand. Der Eintrag behaelt
 * seinen `guete`-Block, damit `ausfuehren` die Auswertung nicht ein zweites Mal
 * aus der Config lesen muss. An der Freigabestufe hat sie diese Sonderrolle nicht
 * mehr (Issue #1000): Beim `push main` lief sie fuer denselben Stand, und dort folgt
 * sie der Auswahl der Freigabe wie jede andere Pruefung (siehe `freigabeAuswahl`).
 *
 * Der ABSCHLUSSLAUF (Issue #946, Plan #944) laesst zwei Gruppen aus, und beide stehen an
 * genau bemessener Stelle:
 *   - Die GUETEMESSUNG (E3) faellt unbedingt weg, auch wenn keine Testpruefung wegfiel:
 *     Ihr Anteil entsteht aus der vollstaendigen Testmenge, und ein Anteil aus einem
 *     verkuerzten Lauf waere nicht dieselbe Zahl, sondern eine andere Groesse mit
 *     demselben Namen. Der Zweig steht UNTER dem Zweig fuer die Veroeffentlichungsstufen:
 *     Dort laeuft sie weiter immer, und `--finish` kommt dort ohnehin nicht vor.
 *   - `nichtBeimAbschluss` faellt weg, und zwar VOR der Bereichsauswahl: Sonst stuende im
 *     Grund "Bereich unberuehrt", obwohl die Pruefung auch im beruehrten Bereich nicht
 *     gelaufen waere — dieselbe Falle, die schon die Stufenauswahl nach oben gezogen hat.
 *     Unter der Stufenauswahl dagegen bleibt er: Wer ohnehin nicht dran ist, braucht keinen
 *     zweiten Grund.
 *
 * Traegt ein solcher Eintrag `abschlussBereiche` (Issue #1531, Plan #1529, E3–E5), laeuft er
 * beim Abschluss doch, wenn das Paket einen dieser Bereiche DIREKT beruehrt — `direkt` sind
 * die Bereiche aus Muster und Ableitung, ohne die abhaengigen (#1208) und ohne Blob- und
 * Stempeldateien; danach entscheidet die normale Auswahl. `direkt` ist `null`, wenn es keine
 * Dateiliste gibt (Anker nicht aufloesbar) oder sie leer ist: Dann laesst sich „direkt
 * beruehrt" nicht verneinen, und der Eintrag geht in die normale Auswahl, die beim leeren
 * Paket ihren eigenen Grund nennt.
 */
function verteilen(checks, stufe, entscheiden, abschluss = false, direkt = null) {
  const laufen = [];
  const ausgelassen = [];
  const gefahren = STUFEN.indexOf(stufe);
  for (const check of checks) {
    let ergebnis;
    if (check.guete && stufe === "push") {
      ergebnis = { laeuft: true, grund: t("grundGueteVeroeffentlichung") };
    } else if (check.guete && abschluss) {
      ergebnis = { laeuft: false, grund: t("grundGueteAbschluss") };
    } else if (STUFEN.indexOf(check.stufe) > gefahren) {
      ergebnis = { laeuft: false, grund: t("grundStufeSpaeter", { stufe: check.stufe, gefahren: stufe }) };
    } else if (check.nichtBeimAbschluss && abschluss) {
      ergebnis = beimAbschluss(check, entscheiden, direkt);
    } else {
      ergebnis = entscheiden(check);
    }
    (ergebnis.laeuft ? laufen : ausgelassen).push(auswahlEintrag(check, ergebnis.grund));
  }
  return { laufen, ausgelassen };
}

/** Die Wahl eines Eintrags mit `nichtBeimAbschluss` im Abschlusslauf (Issue #946, #1531). */
function beimAbschluss(check, entscheiden, direkt) {
  const achse = configWert("buildChecks[].nichtBeimAbschluss", check.nichtBeimAbschluss);
  if (!check.abschlussBereiche) return { laeuft: false, grund: t("grundNichtBeimAbschluss", { achse }) };
  if (direkt === null) return entscheiden(check);
  const treffer = check.abschlussBereiche.filter((name) => direkt.has(name));
  if (treffer.length === 0) {
    return { laeuft: false, grund: t("grundNichtDirektBeruehrt", { achse, bereiche: check.abschlussBereiche.join(", ") }) };
  }
  const ergebnis = entscheiden(check);
  return ergebnis.laeuft ? { laeuft: true, grund: t("grundDirektBeruehrt", { bereiche: bereichsText(treffer) }) } : ergebnis;
}

/**
 * Der Eintrag einer Pruefung in `laufen` oder `ausgelassen`. Er behaelt den `guete`-Block
 * und die `art` (Issue #1155), damit `ausfuehren` beides nicht ein zweites Mal aus der
 * Config lesen muss; fehlt eines, fehlt auch das Feld.
 */
function auswahlEintrag(check, grund) {
  const eintrag = { cmd: check.cmd, stufe: check.stufe, grund };
  if (check.guete) eintrag.guete = check.guete;
  if (check.art) eintrag.art = check.art;
  if (check.beschreibung) eintrag.beschreibung = check.beschreibung;
  return eintrag;
}

/**
 * `ohneZuordnung` hat die Vorgabe `[]` und wird nie aus etwas anderem erschlossen
 * (Issue #922): Ein voller Umfang wegen eines nicht aufloesbaren Ankers kennt gar
 * keine Dateiliste — dort stuende sonst ein erfundener Eintrag, und der Beobachter
 * zaehlte eine Luecke, die es nicht gibt. `ohnePruefung` steht aus demselben Grund
 * mit derselben Vorgabe daneben (Issue #934).
 */
function bauen({ basis, stufe, geaendert = [], bereiche = [], ohneZuordnung = [], ohnePruefung = [],
  laufen = [], ausgelassen = [], vollerUmfang = false, leeresPaket = false, bereichWahl = null,
  abschluss = false, abgeleitet = [], abhaengig = [] }) {
  // `bereichWahl` traegt den Namen des Bereichs, auf den `--area` die Auswahl
  // eingegrenzt hat, sonst null. Das Feld ist kein Schmuck, sondern die Marke eines
  // TEILNACHWEISES: Ein Bereichslauf bestimmt `geaendert` und `hashes` weiterhin aus
  // dem Anker und saehe darum aus wie ein vollstaendiger Lauf. Zwei Leser brauchen den
  // Unterschied — die Wiederverwendung darf ein eingegrenztes Ergebnis nicht fuer einen
  // vollen Lauf ausgeben (frueheresErgebnis), und das Commit-Gate darf auf ihm nicht
  // committen lassen (.githooks/gate.mjs).
  //
  // `abschluss` steht aus demselben Grund daneben (Issue #946): Ein Abschlusslauf laesst
  // Pruefungen aus und saehe ohne das Feld aus wie ein vollstaendiger. Zwei Leser brauchen
  // es — die Wiederverwendung (`frueheresErgebnis`) und die Auswertung, die je Karte
  // rechnet.
  //
  // `abgeleitet` (Issue #1181) steht nur da, wenn eine Datei ihre Bereiche aus den
  // Importen bekam — sonst fehlt das Feld, und die Zusammenfassung bleibt, wie sie war.
  const auswahl = { basis, stufe, geaendert, bereiche, ohneZuordnung, ohnePruefung, laufen, ausgelassen, vollerUmfang, leeresPaket, bereichWahl, abschluss };
  if (abgeleitet.length > 0) auswahl.abgeleitet = abgeleitet;
  // `abhaengig` (Issue #1208) aus demselben Grund nur, wenn ein Import einen Bereich mitberuehrt.
  if (abhaengig.length > 0) auswahl.abhaengig = abhaengig;
  return auswahl;
}

/**
 * Die Auswahl samt den Hinweisen auf breite Kommandos (Issue #1214, E13). `zuschnitt`
 * steht nur da, wenn es einen Hinweis gibt — sonst bleibt die Zusammenfassung, wie sie war.
 * Die Hinweise haengen an der Config und nicht am Diff; darum stehen sie in jedem Weg der
 * Auswahl, auch beim leeren Paket.
 */
function planen(args) {
  const auswahl = args.releaseOnly === true ? releaseAuswahl(args) : auswahlPlanen(args);
  const config = ladeConfig();
  const zuschnitt = zuschnittHinweise(config, (config.buildChecks ?? []).map((c) => normalisiere(c)));
  if (zuschnitt.length > 0) auswahl.zuschnitt = zuschnitt;
  if (auswahl.stufe === "push" && !auswahl.integration) {
    auswahl.pushPruefung = pushPruefung(config);
    auswahl.releaseKommandos = releaseKommandos(config);
  }
  // Ob eine rote Pruefung einmal wiederholt wird (Issue #1396, Plan #1395, E2): allein bei
  // `--finish` oder `--retry`, nie wegen der Stufe. Das Feld fehlt sonst, und die
  // Zusammenfassung bleibt, wie sie war.
  if (args.abschluss === true || args.wiederholen === true) auswahl.wiederholen = true;
  // Die Tests beim Abschluss (Issue #1980): Die Teile unter `checks/` kommen erst hier und
  // dynamisch dazu, darum ist nur dieser Weg ein Promise.
  let gewaehlt = auswahl[TESTWAHL] ? testsWaehlen(auswahl, config) : auswahl;
  // Erst auswaehlen, dann teilen (Issue #2188, Plan #2176, E10): `--part` sieht die Auswahl der
  // Stufe samt `--hotfix` und behaelt nur ihren Teil.
  if (args.teil !== undefined) {
    gewaehlt = Promise.resolve(gewaehlt).then((a) => teilAuswaehlen(a, args.teil, (config.buildChecks ?? []).map((c) => normalisiere(c))));
  }
  return gewaehlt instanceof Promise ? gewaehlt.then((a) => dateienEinsetzen(a, config)) : dateienEinsetzen(gewaehlt, config);
}

/**
 * Verteilt `pruefungen` gierig auf `n` Teile (Issue #2188, Plan #2176, E2): die schwerste zuerst,
 * jede in den Teil mit der kleinsten Summe, bei Gleichstand im Gewicht nach der Reihenfolge der
 * Eingabe und unter gleich leichten Teilen in den vorderen. `gewicht` ist eine Funktion je
 * Pruefung. Jeder Teil behaelt die Reihenfolge der Eingabe; ein Teil kann leer bleiben. Ein `n`
 * unter 1 oder ohne ganze Zahl weist es mit einem `RangeError` ab (Issue #2233).
 */
export function teileVerteilen(pruefungen, n, gewicht) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(t("teileVerteilenOhneTeil", { n }));
  const teile = Array.from({ length: n }, () => ({ summe: 0, stellen: [] }));
  const reihe = pruefungen.map((p, stelle) => ({ stelle, gewicht: gewicht(p) }))
    .sort((a, b) => b.gewicht - a.gewicht || a.stelle - b.stelle);
  for (const { stelle, gewicht: g } of reihe) {
    const leichtester = teile.reduce((min, teil) => (teil.summe < min.summe ? teil : min), teile[0]);
    leichtester.summe += g;
    leichtester.stellen.push(stelle);
  }
  return teile.map((teil) => teil.stellen.toSorted((a, b) => a - b).map((s) => pruefungen[s]));
}

// Ein Kommando mit `node … --test` (Issue #2188, E2): nur bei ihm zaehlen die Testdateien.
const NODE_TEST = /(?:^|[\s;&|(])node(?:\s+[^\s;&|]+)*?\s+--test(?=\s|$)/;

/**
 * Die Auswahl mit nur dem Teil `nummer` von `von` in `laufen` (Issue #2188, Plan #2176, E2, E3).
 * Das Gewicht ist `weight` aus der Config, sonst bei `node --test` die Zahl der Testdateien, die
 * seine Muster treffen (mindestens 1), sonst 1. `ausgelassen` bleibt die der Stufe, das Feld
 * `teil` sagt, welcher Teil gefahren wird; beim Hotfix nennt `hotfix.gelaufen` nur den Teil.
 */
async function teilAuswaehlen(auswahl, { nummer, von }, checks) {
  const testauswahl = await import("./checks/testauswahl.mjs").catch(() => null);
  const zaehlen = testauswahl ? testauswahl.testdateienZaehler({ repoRoot: wurzel() }) : () => 1;
  const gewichtVon = new Map(checks.map((c) => [c.cmd, c.weight]));
  const gewicht = (e) => gewichtVon.get(e.cmd) ?? (NODE_TEST.test(e.cmd) ? Math.max(1, zaehlen(e.cmd)) : 1);
  const laufen = teileVerteilen(auswahl.laufen, von, gewicht)[nummer - 1];
  const geteilt = { ...auswahl, laufen, teil: { nummer, von } };
  if (auswahl.hotfix) geteilt.hotfix = { ...auswahl.hotfix, gelaufen: laufen.map((e) => e.cmd) };
  return geteilt;
}

/**
 * Der Platzhalter `{files:<Ausdruck>}` einer Kommandozeile (Issue #1981, Plan #1969, E4). Der
 * Ausdruck ist eine durch Leerzeichen getrennte Liste aus Pfadpraefixen und Globs.
 */
const DATEI_PLATZHALTER = /\{files:([^}]*)\}/g;

/**
 * Die Kommandozeile mit dem Ausdruck an der Stelle jedes Platzhalters — so laeuft sie ohne
 * `--finish`. Exportiert fuer die Nachpruefung des Runners (`runBuildChecksSync`), die die
 * Config-Zeilen selbst faehrt.
 */
export function ausdruckEinsetzen(cmd) {
  return cmd.replaceAll(DATEI_PLATZHALTER, (_, ausdruck) => ausdruck.trim());
}

/** Die Zeile, die fuer einen Eintrag wirklich laeuft: die Teilzeile, sonst die Config-Zeile mit dem Ausdruck. */
function befehlszeile(eintrag) {
  return eintrag.gefahren ?? ausdruckEinsetzen(eintrag.cmd);
}

/** Ein Pfad als Wort der Shell, in einfachen Anfuehrungszeichen, wenn er mehr als Pfadzeichen traegt. */
function shellPfad(pfad) {
  return /^[\w@%+=:,./-]+$/.test(pfad) ? pfad : ["'", pfad.replaceAll("'", String.raw`'\''`), "'"].join("");
}

/**
 * Wie viele Dateien eine Kommandozeile faehrt (Issue #2216) — gleich gezaehlt fuer eine Teilzeile
 * und fuer den aufgeloesten Ausdruck einer Config-Zeile: jedes Wort ohne Anfuehrungszeichen und
 * ohne fuehrenden Bindestrich als Pfadpraefix oder Glob ueber `dateien` (`dateienUnter`). Trifft
 * keines, ist die Zahl nicht bestimmbar: `null`.
 */
export function dateizahl(zeile, dateien = baumDateien()) {
  const ausdruck = zeile.split(/\s+/).map((wort) => wort.replaceAll(/["']/g, "")).filter((wort) => wort !== "" && !wort.startsWith("-")).join(" ");
  const zahl = ausdruck === "" ? 0 : dateienUnter(ausdruck, dateien).length;
  return zahl > 0 ? zahl : null;
}

/** Die versionierten und die neuen, nicht ignorierten Dateien des Arbeitsbaums; leer, wenn git scheitert. */
function baumDateien() {
  const ls = gitSpawn(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: wurzel(), encoding: "utf-8" });
  if (ls.status !== 0) return [];
  return [...new Set(ls.stdout.split("\0").filter(Boolean).map((pfad) => pfad.replaceAll("\\", "/")))];
}

/** Die vorhandenen Dateien aus `geaendert`, die unter einem Teil des Ausdrucks liegen (Praefix oder Glob). */
function dateienUnter(ausdruck, geaendert) {
  const teile = ausdruck.trim().split(/\s+/).filter(Boolean).map((teil) => {
    if (/[*?[]/.test(teil)) {
      const regex = globZuRegex(teil);
      return (p) => regex.test(p);
    }
    let praefix = teil.startsWith("./") ? teil.slice(2) : teil;
    while (praefix.endsWith("/")) praefix = praefix.slice(0, -1);
    return praefix === "" || praefix === "." ? () => true : (p) => p === praefix || p.startsWith(`${praefix}/`);
  });
  const repoRoot = wurzel();
  return geaendert.filter((p) => teile.some((trifft) => trifft(p)) && existsSync(join(repoRoot, ...p.split("/"))));
}

/**
 * Format und Stil beim Abschluss (Issue #1981, Plan #1969, E4, E14): Ein laufender Eintrag mit
 * `{files:<Ausdruck>}` bekommt als `gefahren` seine Zeile mit den geaenderten Dateien unter dem
 * Ausdruck; liegt unter einem Platzhalter keine, wird er mit `keine Datei des Pakets`
 * ausgelassen. `cmd` bleibt die Config-Zeile wie bei der Teilzeile aus #1980.
 *
 * Nur bei `--finish` und nur mit einer Dateiliste: Ohne aufloesbaren Anker (voller Umfang ohne
 * `geaendert`) laeuft der Ausdruck — die sichere Richtung.
 */
function dateienEinsetzen(auswahl, config) {
  if (!auswahl.abschluss || auswahl.leeresPaket || auswahl.geaendert.length === 0) return auswahl;
  const laufen = [];
  const ausgelassen = [...auswahl.ausgelassen];
  for (const e of auswahl.laufen) {
    const quelle = e.gefahren ?? e.cmd;
    if (!quelle.includes("{files:")) {
      laufen.push(e);
      continue;
    }
    let leer = false;
    const zeile = quelle.replaceAll(DATEI_PLATZHALTER, (_, ausdruck) => {
      const dateien = dateienUnter(ausdruck, auswahl.geaendert);
      if (dateien.length === 0) leer = true;
      return dateien.map(shellPfad).join(" ");
    });
    if (leer) ausgelassen.push({ ...e, grund: t("grundKeineDateiDesPakets") });
    else laufen.push({ ...e, gefahren: zeile });
  }
  const reihenfolge = (config.buildChecks ?? []).map((c) => normalisiere(c).cmd);
  const stelle = (e) => reihenfolge.indexOf(e.cmd);
  auswahl.laufen = laufen;
  auswahl.ausgelassen = ausgelassen.toSorted((a, b) => stelle(a) - stelle(b));
  return auswahl;
}

/**
 * Die Marke an einer Auswahl, die beim Abschluss noch nach Tests gewaehlt wird (Issue #1980):
 * welche Eintraege die Bereichsauswahl entschieden hat und was sich geaendert hat. Ein Symbol,
 * damit sie in keiner Zusammenfassung erscheint.
 */
const TESTWAHL = Symbol("testwahl");

/**
 * Die Wahl nach Tests beim Abschluss eines Pakets (Issue #1980, Plan #1969, E1–E3).
 *
 * Fuer jeden Eintrag, den die Bereichsauswahl entschieden hat und der sich teilen laesst
 * (`teilzeileBauen`), zaehlt statt der Bereiche, welche seiner Tests das Paket betrifft:
 * neue und geaenderte Tests, Tests, deren `laedt`, `nennt` oder `durch` eine geaenderte Datei
 * enthaelt, und Tests mit unvollstaendiger Messung (die sichere Richtung). Gemessen wird ohne
 * Huelle — was ein Test nur ueber eine gemeinsame Grundlage erreicht, laeuft erst im
 * Integrationslauf.
 *
 *   - Ein Teil der Tests betroffen: Der Eintrag laeuft, `cmd` bleibt die Config-Zeile — Haenge-
 *     Historie, Verursachersuche und Commit-Gate finden ihn darunter —, `gefahren` ist die
 *     Teilzeile und `tests` zaehlt `{ gefahren, gesamt }`.
 *   - Alle betroffen: Er laeuft ganz.
 *   - Keiner betroffen: ausgelassen, er wartet auf den Integrationslauf.
 *
 * Nicht teilbare Eintraege und `always` bleiben bei der Bereichsauswahl. Fehlen die Teile oder
 * bricht die Messung ab, bleibt die ganze Auswahl, wie sie war — ein Abbruch ist nie eine
 * Entwarnung.
 */
async function testsWaehlen(auswahl, config) {
  const { kandidaten, geaendert } = auswahl[TESTWAHL];
  delete auswahl[TESTWAHL];
  let teile;
  try {
    teile = await Promise.all([import("./checks/verflechtung.mjs"), import("./checks/testauswahl.mjs")]);
  } catch {
    return auswahl;
  }
  const eintraege = new Map((config.buildChecks ?? []).map((c) => normalisiere(c)).map((c) => [c.cmd, c]));
  let wahl;
  try {
    wahl = testwahlMessen(teile, { kandidaten, geaendert, eintraege, config });
  } catch {
    return auswahl;
  }
  if (wahl.size > 0) testwahlAnwenden(auswahl, wahl, eintraege);
  return auswahl;
}

/**
 * Je teilbarem Kandidaten: wie viele seiner Tests das Paket betrifft, wie viele er hat, und die
 * Teilzeile, wenn es nicht alle sind. Ein Abbruch wirft — der Aufrufer behaelt dann die Bereiche.
 */
function testwahlMessen([verflechtung, testauswahl], { kandidaten, geaendert, eintraege, config }) {
  const repoRoot = wurzel();
  const dateien = verflechtung.imArbeitsstand(repoRoot);
  const teilbar = new Map();
  for (const cmd of kandidaten) {
    const urteil = testauswahl.testsVon(eintraege.get(cmd), { repoRoot, dateien });
    if (urteil.urteil !== testauswahl.URTEIL.beurteilbar) continue;
    if (testauswahl.teilzeileBauen(eintraege.get(cmd), urteil.tests, { repoRoot, dateien }) === null) continue;
    teilbar.set(cmd, urteil.tests);
  }
  const wahl = new Map();
  if (teilbar.size === 0) return wahl;
  const nurGeruest = (config.nurGeruest ?? []).map((eintrag) => (typeof eintrag === "string" ? eintrag : eintrag.muster));
  const testdateien = [...new Set([...teilbar.values()].flat())].sort(vergleicheText);
  const tabelle = verflechtung.verflechtungErheben({ repoRoot, nurGeruest, testdateien, huelle: false });
  const aenderung = new Set(geaendert);
  const betroffen = (test) => {
    const zeile = tabelle.get(test) ?? {};
    if (aenderung.has(test) || zeile.unvollstaendig) return true;
    return [zeile.laedt, zeile.nennt, zeile.durch].some((liste) => (liste ?? []).some((p) => aenderung.has(p)));
  };
  // Ein geloeschter Test ist geaendert, aber nicht mehr zu fahren.
  const vorhanden = (test) => existsSync(join(repoRoot, ...test.split("/")));
  for (const [cmd, tests] of teilbar) {
    const treffer = tests.filter((test) => betroffen(test) && vorhanden(test));
    const teil = treffer.length > 0 && treffer.length < tests.length;
    const zeile = teil ? testauswahl.teilzeileBauen(eintraege.get(cmd), treffer, { repoRoot, dateien }) : null;
    wahl.set(cmd, { treffer: treffer.length, gesamt: tests.length, zeile });
  }
  return wahl;
}

/** Ordnet die gemessenen Eintraege nach `wahl` neu auf `laufen` und `ausgelassen`, in Config-Reihenfolge. */
function testwahlAnwenden(auswahl, wahl, eintraege) {
  const laufen = [];
  const ausgelassen = [];
  for (const e of [...auswahl.laufen, ...auswahl.ausgelassen]) {
    const w = wahl.get(e.cmd);
    if (!w) (auswahl.laufen.includes(e) ? laufen : ausgelassen).push(e);
    else if (w.treffer === 0) ausgelassen.push(auswahlEintrag(eintraege.get(e.cmd), t("grundWartetIntegration")));
    else {
      const eintrag = auswahlEintrag(eintraege.get(e.cmd), t("grundTestsBetroffen", { n: w.treffer, m: w.gesamt }));
      if (w.zeile !== null) Object.assign(eintrag, { gefahren: w.zeile, tests: { gefahren: w.treffer, gesamt: w.gesamt } });
      laufen.push(eintrag);
    }
  }
  const reihenfolge = [...eintraege.keys()];
  const stelle = (e) => reihenfolge.indexOf(e.cmd);
  auswahl.laufen = laufen.toSorted((a, b) => stelle(a) - stelle(b));
  auswahl.ausgelassen = ausgelassen.toSorted((a, b) => stelle(a) - stelle(b));
}

/**
 * Wo der volle Lauf vor `push main` stattfindet (Issue #1216, Plan #1199 E14): `"lokal"`
 * (Vorgabe) oder `{ ort: "buildDienst", zweig }`. `plan --stage push` gibt den Wert aus,
 * damit `/push-main` die Config nicht selbst liest.
 *
 * Ein ungueltiger Wert ist ein Fehler und nicht stillschweigend `lokal`: Wer den
 * Build-Dienst meinte, bekaeme sonst einen lokalen Lauf, ohne es zu merken. Der Pruefzweig
 * darf weder `mainBranch` noch `productionBranch` sein — `/push-main` pusht ihn vor dem
 * Ergebnis und loescht ihn danach.
 *
 * `machine` ist die Kennung dieses Rechners fuer seinen eigenen Pruefzweig
 * `<zweig>-<rechner>` (Issue #2146, Plan #2145 E3), `null`, wenn die Config keine nennt.
 * Gelesen wird hier nur die geteilte Datei; die persoenliche mischt der Runner.
 */
function pushPruefung(config) {
  const wert = config.pushPruefung ?? "lokal";
  if (wert === "lokal") return wert;
  const genannt = JSON.stringify(wert);
  const objekt = wert !== null && typeof wert === "object" && !Array.isArray(wert);
  const felder = objekt ? Object.keys(wert).filter((f) => f !== "machine") : [];
  const rechnerGut = !objekt || wert.machine === undefined || (typeof wert.machine === "string" && /^[a-z0-9-]+$/.test(wert.machine));
  if (!objekt || felder.length !== 2 || !felder.includes("ort") || !felder.includes("zweig") || wert.ort !== "buildDienst" || typeof wert.zweig !== "string" || !/^\S+$/.test(wert.zweig) || !rechnerGut) {
    fail(t("pushPruefungUngueltig", { genannt }));
  }
  for (const [feld, vorgabe] of [["mainBranch", "main"], ["productionBranch", "production"]]) {
    if (wert.zweig === (config[feld] ?? vorgabe)) {
      fail(t("pushPruefungZweig", { zweig: wert.zweig, feld }));
    }
  }
  return { ort: wert.ort, zweig: wert.zweig, machine: wert.machine ?? null };
}

/**
 * Die Befehle aus `release.commands` (Issue #2146, Plan #2145 E5): Mit ihnen legt die
 * Pruefung je Karte Version und Aenderungsprotokoll in den geprueften Stand. Fehlt das Feld,
 * ist die Liste leer, und es entsteht kein Release-Commit. Ein ungueltiger Wert ist ein
 * Fehler wie bei `pushPruefung`: Eine still leere Liste liesse Version und Protokoll
 * unbemerkt aus.
 */
function releaseKommandos(config) {
  return releaseBefehlsliste(config, "commands", "releaseKommandosUngueltig");
}

/**
 * Die Befehle aus `release.publishCommands` (Issue #2246, Plan #2242 E2): die Release-Schritte
 * des kurzen Wegs von `merge production`, mit den Platzhaltern `<stage>` und `<version>`.
 * `release.commands` bleibt der Pruefung je Karte (Stufe patch). Fehlt das Feld, ist die Liste
 * leer, und der kurze Weg entfaellt (A8). Ein ungueltiger Wert ist ein Fehler wie dort.
 */
export function releasePublishKommandos(config) {
  return releaseBefehlsliste(config, "publishCommands", "releasePublishKommandosUngueltig");
}

function releaseBefehlsliste(config, feld, fehlertext) {
  const release = config.release ?? {};
  const objekt = release !== null && typeof release === "object" && !Array.isArray(release);
  const wert = objekt ? release[feld] ?? [] : release;
  if (!objekt || !Array.isArray(wert) || wert.some((zeile) => typeof zeile !== "string" || zeile.trim() === "")) {
    fail(t(fehlertext, { genannt: JSON.stringify(wert) }));
  }
  return [...wert];
}

function auswahlPlanen(args) {
  const config = ladeConfig();
  const checks = (config.buildChecks ?? []).map((c) => normalisiere(c));
  const checkAreas = config.checkAreas ?? {};
  pruefeBereichsnamen(checks, checkAreas);
  pruefeGuete(checks);
  pruefeNichtBeimAbschlussStufe(checks);
  pruefeAbschlussBereiche(checks, checkAreas);

  // Der Abschlusslauf (Issue #946): Er schliesst genau ein Arbeitspaket ab und ist der
  // einzige Lauf, der die Zusammenspiel-Pruefungen auslassen darf. Sein Gate wird hier
  // geprueft und nur hier — die Begruendung steht an `pruefeAbschlussGate`.
  const abschluss = args.abschluss === true;
  if (abschluss) pruefeAbschlussGate(checks);

  // Der Integrationslauf (Issue #1982) hat seinen eigenen Anker und keine Eingrenzung.
  if (args.integration === true) return integrationsAuswahl(checks, config);

  // Derselbe Weg wie beim vertippten Bereichsnamen einer Pruefung: Abbruch statt
  // stiller Wahl. Ein Tippfehler im Flag liefe sonst auf einen Bereich, den keine
  // Pruefung kennt — es liefe nichts ausser `always`, und der Aufrufer hielte die
  // Gruppe fuer gefahren.
  const bereichWahl = args.bereich ?? null;
  if (bereichWahl !== null && !Object.hasOwn(checkAreas, bereichWahl)) {
    const namen = Object.keys(checkAreas);
    fail(t("unbekannterBereichWahl", { name: bereichWahl, liste: namen.length > 0 ? namen.join(", ") : t("keinerBereich") }));
  }

  const stufe = args.stufe ?? STUFEN[0];
  const refText = args.since ?? "HEAD";
  const basis = ankerAufloesen(refText);
  const strenge = strengePlanen(config, stufe, basis, args);
  if (basis === null) {
    // Der Zweifelsfall behaelt seinen eigenen Grund, auch an der Freigabestufe:
    // Dort laeuft ohnehin alles, aber WARUM ist verschieden — entschieden gegen
    // nicht gewusst.
    const grund = t("grundAnkerUnbekannt", { ref: refText });
    return mitStrenge(hotfixBauen(args, checks, {
      basis: refText, stufe, vollerUmfang: true, abschluss,
      ...verteilen(checks, stufe, () => ({ laeuft: true, grund }), abschluss),
    }), strenge);
  }

  const geaendert = geaenderteDateien(basis);
  const bereichsdefinition = bereicheVorbereiten(checkAreas);
  const nurBlobs = nurBlobsGeaendert(basis, geaendert);
  // Die Erhebung liest jede versionierte JavaScript-Datei; sie laeuft hoechstens einmal
  // je Lauf, auch wenn beide Ableitungen sie brauchen.
  const importGraph = einmal(importeureErheben);
  const {
    beruehrt, direkt, ohneMuster: ohneMusterDatei, ohneZuordnung, ohnePruefung, blobBereiche, abgeleitet, abhaengig, importeUnbekannt,
  } = umAbhaengigeErweitern(
    ausImportenAbleiten(
      zuordnen(geaendert, bereichsdefinition, freistellungenVorbereiten(config.ohnePruefung), nurBlobs),
      bereichsdefinition,
      importGraph,
    ),
    geaendert,
    nurBlobs,
    bereichsdefinition,
    importGraph,
  );
  const bereiche = [...beruehrt].sort(vergleicheText);
  // Laesst sich nicht sagen, was von der Aenderung abhaengt, gilt dasselbe wie fuer eine
  // Datei ohne Muster: im Zweifel alles (E16). Der Grund sagt, welcher Zweifel es war.
  const ohneMuster = ohneMusterDatei ?? (importeUnbekannt ? importeUnbekanntGrund() : null);
  const zweifelGrund = ohneMusterDatei !== null ? ohneMusterGrund(ohneZuordnung) : importeUnbekanntGrund();

  // Der BEREICHSLAUF (Issue #922, Plan #917, E3): Nicht der Diff sagt, welche
  // Bereiche beruehrt sind, sondern der Aufrufer. Das ist der sanktionierte Weg
  // fuer den Fall, dass fuer die geaenderte Datei nur die vollstaendige Gruppe
  // existiert — ohne ihn liefe dieselbe Gruppe von Hand am Kommando vorbei, und
  // niemand koennte Verstoss und Notwendigkeit auseinanderhalten.
  //
  // Die Wahl steht VOR den Sonderwegen darunter (Veroeffentlichungsstufe, leeres
  // Paket, Datei ohne Muster): Jeder von ihnen wuerde die Eingrenzung wieder
  // aufheben, um die es beim Aufruf gerade ging. Nicht davor steht der
  // Zweifelsfall des nicht aufloesbaren Ankers — dort ist gar nichts bekannt, und
  // dieses Kommando irrt in diese Richtung nie.
  //
  // Die STUFENACHSE bleibt unberuehrt: `--area` beantwortet, OB eine Pruefung
  // betroffen ist, `--stage` weiter, WANN sie an der Reihe ist. Der Grund traegt
  // das Praefix, damit im Bericht steht, warum die Auswahl so ausfiel.
  if (bereichWahl !== null) {
    const gewaehlt = new Set([bereichWahl]);
    return mitStrenge(bauen({
      basis, stufe, geaendert, bereiche, ohneZuordnung, ohnePruefung, bereichWahl, abschluss, abgeleitet, abhaengig,
      ...verteilen(checks, stufe, (check) => {
        const ergebnis = entscheidung(check, gewaehlt);
        return { laeuft: ergebnis.laeuft, grund: t("grundBereichslauf", { bereich: bereichWahl, grund: ergebnis.grund }) };
      }, abschluss),
    }), strenge);
  }

  if (stufe === "merge") {
    return freigabeAuswahl({ checks, basis, geaendert, bereiche, ohneZuordnung, ohnePruefung, ohneMuster, zweifelGrund, beruehrt, blobBereiche, abschluss, abgeleitet, abhaengig });
  }

  // Die Push-Stufe faehrt jede faellige Pruefung (Plan #753, E12;
  // Plan #843, E9 nach Fachplan #837, AK 11): Ihr Ergebnis
  // gilt fuer den Stand, der hinausgeht, und der besteht aus mehr als dem letzten
  // Arbeitspaket. Eine Auslassung wegen leeren Pakets oder unberuehrten Bereichs
  // zeigte hier auf den falschen Vergleich — deshalb greift keine von beiden.
  // `basis`, `geaendert`, `bereiche` und (in `run`) `hashes` bleiben trotzdem aus
  // dem Anker bestimmt: Sie sind der Nachweis, gegen den das Commit-Gate den Index
  // prueft (gate-1), und nicht Teil der Auswahl.
  //
  // Die Kumulation bleibt davon unberuehrt: Was spaeter dran ist, bleibt aus. Die
  // Stufe sagt weiter, WANN eine Pruefung laeuft — nur die Eingrenzung unter den
  // faelligen entfaellt.
  //
  // `vollerUmfang` bleibt dabei false — das Feld markiert den Zweifelsfall
  // („wir wissen es nicht, also alles"), und diese Stufe ist das Gegenteil
  // davon: eine Entscheidung. Denselben Unterschied halten String-Form und
  // `always: true` auseinander.
  //
  // Mit `--hotfix` (Issue #2051, Plan #2038, E2) bleibt jede Pruefung mit `deferOnHotfix`
  // aus: Sie laeuft nach der Auslieferung, und der naechste `push main` holt sie nach. Das
  // Feld `hotfix` nennt beide Listen fuer den Kartenkommentar des Hotfix.
  //
  // Die STRENGE (Issue #2107, Plan #2102) schraenkt das ein: Mit `pushUmfang bereiche` waehlt
  // die Stufe nach den Bereichen der Dateien seit dem Anker, auch fuer die Pruefungen der Stufe
  // `push` (A5); das Nachholen — `--catch-up` oder eine gestiegene Strenge — faehrt den vollen
  // Umfang mit eigenem Grund (A7, A9).
  if (stufe === "push") {
    return pushAuswahl(args, checks, strenge, {
      basis, geaendert, bereiche, ohneZuordnung, ohnePruefung, abschluss, abgeleitet, abhaengig, ohneMuster, zweifelGrund, beruehrt, blobBereiche,
    });
  }

  if (geaendert.length === 0) {
    const grund = t("grundLeeresPaket", { basis });
    return bauen({
      basis, stufe, leeresPaket: true, abschluss,
      ...verteilen(checks, stufe, () => ({ laeuft: false, grund }), abschluss),
    });
  }

  if (ohneMuster !== null) {
    const grund = zweifelGrund;
    return bauen({
      basis, stufe, geaendert, bereiche, ohneZuordnung, ohnePruefung, vollerUmfang: true, abschluss, abgeleitet, abhaengig,
      ...verteilen(checks, stufe, () => ({ laeuft: true, grund }), abschluss, direkt),
    });
  }

  // Beim Abschluss merkt sich die Auswahl, welche Eintraege die Bereiche entschieden haben:
  // Teilbare unter ihnen waehlt `testsWaehlen` danach nach Tests (Issue #1980).
  const kandidaten = new Set();
  const auswahl = bauen({
    basis, stufe, geaendert, bereiche, ohneZuordnung, ohnePruefung, abschluss, abgeleitet, abhaengig,
    ...verteilen(checks, stufe, (check) => {
      if (abschluss && !check.always) kandidaten.add(check.cmd);
      return entscheidung(check, beruehrt, blobBereiche);
    }, abschluss, direkt),
  });
  if (kandidaten.size > 0) auswahl[TESTWAHL] = { kandidaten, geaendert };
  return auswahl;
}

/**
 * Die Auswahl der Push-Stufe nach der Strenge (Issue #2107, Plan #2102, A5, A7, A9): Mit
 * `pushUmfang bereiche` und ohne Nachholen nach den Bereichen der Dateien seit dem Anker, auch
 * fuer die Pruefungen der Stufe `push` — `always` laeuft, ein leerer Stand laesst den Rest aus,
 * eine Datei ohne Muster faehrt alles. Sonst jede faellige Pruefung, beim Nachholen mit eigenem
 * Grund und beim Hotfix ueber `hotfixBauen`.
 */
function pushAuswahl(args, checks, strenge, { ohneMuster, zweifelGrund, beruehrt, blobBereiche, ...felder }) {
  const stufe = "push";
  const { basis, geaendert, abschluss } = felder;
  if (strenge?.nachholen === null && strenge.vorgaben.pushUmfang === "bereiche") {
    const leer = geaendert.length === 0;
    const zweifel = !leer && ohneMuster !== null;
    return mitStrenge(bauen({
      ...felder, stufe, vollerUmfang: zweifel,
      ...verteilen(checks, stufe, (check) => {
        if (leer && !check.always) return { laeuft: false, grund: t("grundLeeresPaket", { basis }) };
        if (zweifel) return { laeuft: true, grund: zweifelGrund };
        const ergebnis = entscheidung(check, beruehrt, blobBereiche);
        return { laeuft: ergebnis.laeuft, grund: t("grundStrengeBereiche", { grund: ergebnis.grund }) };
      }, abschluss),
    }), strenge);
  }
  const grund = nachholGrund(strenge) ?? t("grundVeroeffentlichung");
  return mitStrenge(hotfixBauen(args, checks, {
    ...felder, stufe,
    ...verteilen(checks, stufe, () => ({ laeuft: true, grund }), abschluss),
  }), strenge);
}

/**
 * Die Push-Auswahl eines Hotfix (Issue #2051, Plan #2038, E2): Jeder faellige Eintrag mit
 * `deferOnHotfix: true` wandert mit dem Grund „nach der Auslieferung" nach `ausgelassen`, auch
 * eine Guetemessung. Die Auslassungen stehen in der Reihenfolge der Config; `verschoben` nennt
 * die Kommandos, die nach der Auslieferung laufen.
 */
function hotfixVerschieben({ laufen, ausgelassen }, checks) {
  const nachher = new Set(checks.filter((c) => c.deferOnHotfix === true).map((c) => c.cmd));
  const reihenfolge = checks.map((c) => c.cmd);
  const verschoben = laufen.filter((e) => nachher.has(e.cmd));
  return {
    laufen: laufen.filter((e) => !nachher.has(e.cmd)),
    ausgelassen: [...ausgelassen, ...verschoben.map((e) => ({ ...e, grund: t("grundNachAuslieferung") }))]
      .sort((a, b) => reihenfolge.indexOf(a.cmd) - reihenfolge.indexOf(b.cmd)),
    verschoben: verschoben.map((e) => e.cmd),
  };
}

/**
 * `bauen` mit dem Hotfix: ohne `--hotfix` unveraendert, mit ihm ueber `hotfixVerschieben`
 * und mit dem Feld `hotfix` — `gelaufen` und `nachDerAuslieferung` liest der Hotfix-Skill fuer
 * den Kartenkommentar. `--hotfix` gibt es nur mit `--stage push` (`pruefeHotfix`).
 */
function hotfixBauen(args, checks, felder) {
  if (args.hotfix !== true) return bauen(felder);
  const { laufen, ausgelassen, verschoben } = hotfixVerschieben(felder, checks);
  const auswahl = bauen({ ...felder, laufen, ausgelassen });
  auswahl.hotfix = { gelaufen: laufen.map((e) => e.cmd), nachDerAuslieferung: verschoben };
  return auswahl;
}

/**
 * Die Strenge eines Push-Laufs (Issue #2107, Plan #2102, A2, A7, A9): `vorgaben` aus
 * `strengeVorgaben` und `nachholen` — `{ anlass: "catch-up" }` mit `--catch-up`,
 * `{ anlass: "aufstieg", seit }`, wenn die Strenge gegenueber der Config am Anker gestiegen ist,
 * sonst `null`. `null` ausserhalb der Push-Stufe, beim Hotfix, der die Strenge nicht liest (A8),
 * und ohne das Modul: Die Push-Stufe prueft dann wie bisher.
 */
function strengePlanen(config, stufe, basis, args) {
  if (stufe !== "push" || args.hotfix === true || strengeModul === null) return null;
  const vorgaben = strengeModul.strengeVorgaben(config);
  let nachholen = null;
  if (args.nachholen === true) {
    nachholen = { anlass: "catch-up" };
  } else if (basis !== null) {
    const vorher = configAm(basis);
    if (vorher !== null && strengeModul.strengeVergleich(vorher, config).richtung === "steigt") {
      nachholen = { anlass: "aufstieg", seit: basis };
    }
  }
  return { vorgaben, nachholen };
}

/**
 * Die Config am Commit `basis`, normalisiert wie `ladeConfig`; `null`, wenn sie dort fehlt oder
 * kein JSON ist — dann gibt es keinen frueheren Stand, gegen den die Strenge gestiegen waere.
 */
function configAm(basis) {
  const res = git("show", `${basis}:./.claude/workflow.config.json`);
  if (res.status !== 0) return null;
  try {
    return normalisiereConfig(JSON.parse(res.stdout)).config;
  } catch {
    return null;
  }
}

/** Die Auswahl mit den Feldern `strenge` (die Vorgaben) und, wenn nachgeholt wird, `nachholen`. */
function mitStrenge(auswahl, strenge) {
  if (strenge === null) return auswahl;
  auswahl.strenge = strenge.vorgaben;
  if (strenge.nachholen !== null) auswahl.nachholen = strenge.nachholen;
  return auswahl;
}

/** Der Grund des vollen Umfangs beim Nachholen, `null` ohne Nachholen. */
function nachholGrund(strenge) {
  if (!strenge?.nachholen) return null;
  if (strenge.nachholen.anlass === "aufstieg") return t("grundAufstieg", { basis: strenge.nachholen.seit });
  return t("grundNachholen");
}

/** Ein Wert der Vorgaben fuer die Ankuendigung: eine Prueferzahl je Stufe als JSON. */
const vorgabeText = (wert) => (wert !== null && typeof wert === "object" ? JSON.stringify(wert) : String(wert));

/**
 * Die Ankuendigung der Strenge vor dem Push-Lauf (Issue #2107, Plan #2102, A12; #2100,
 * Kriterien 6 und 10): `Strenge: Leicht`, dahinter, was die Strenge am Umfang aendert oder dass
 * nachgeholt wird, und jede Abweichung des Projekts von seiner Strenge.
 */
function strengeAnkuendigung(auswahl) {
  const zeile = strengeModul.strengeZeile(auswahl.strenge, namen ? namen.prozessSprache() : "de");
  const teile = [];
  if (auswahl.nachholen?.anlass === "catch-up") {
    teile.push(t("strengeNachholen"));
  } else if (auswahl.nachholen?.anlass === "aufstieg") {
    teile.push(t("strengeAufstieg", { basis: auswahl.nachholen.seit }));
  } else {
    if (auswahl.strenge.pushUmfang === "bereiche" && !auswahl.vollerUmfang) teile.push(t("strengeBereiche", { basis: auswahl.basis }));
    if (auswahl.strenge.mutation === "aus" && configKommando("mutationCommand") !== null) teile.push(t("strengeOhneMutation"));
  }
  for (const a of auswahl.strenge.abweichungen) {
    teile.push(t("strengeAbweichung", { schalter: a.schalter, wert: vorgabeText(a.wert), vorgabe: vorgabeText(a.vorgabe) }));
  }
  return teile.length === 0 ? zeile : `${zeile} — ${teile.join("; ")}`;
}

/**
 * Die Auswahl des INTEGRATIONSLAUFS (Issue #1982, Plan #1969, E5, E6): jede Pruefung der
 * Paketstufe ohne Bereichsfilter, auch die mit `nichtBeimAbschluss`. Die Stufen `push` und
 * `merge` und die Guetemessung bleiben mit Grund aus — sie laufen beim Veroeffentlichen.
 *
 * Der Anker ist der Nullpunkt aus `nullpunktBestimmen`, und die Auswahl traegt intern die
 * Stufe `push`: So findet `verursacherKarten` die Karten seit dem Nullpunkt, ohne eine zweite
 * Suche. Laesst sich kein Nullpunkt bestimmen, laeuft derselbe Umfang mit `vollerUmfang` —
 * es gibt dann keine Menge „seit dem Nullpunkt", aus der Verursacher zu nennen waeren.
 */
function integrationsAuswahl(checks, config) {
  const nullpunkt = nullpunktBestimmen(config);
  const verteilt = { laufen: [], ausgelassen: [] };
  for (const check of checks) {
    let grund = null;
    if (check.guete) grund = t("grundIntegrationGuete");
    else if (check.stufe !== STUFEN[0]) grund = t("grundIntegrationStufe", { stufe: check.stufe });
    if (grund === null) verteilt.laufen.push(auswahlEintrag(check, t("grundIntegration")));
    else verteilt.ausgelassen.push(auswahlEintrag(check, grund));
  }
  let auswahl;
  if (nullpunkt === null) {
    const ref = originRef(config);
    const grund = t("grundIntegrationOhneNullpunkt", { datei: INTEGRATION_DATEI, ref });
    auswahl = bauen({
      basis: ref, stufe: "push", vollerUmfang: true,
      laufen: verteilt.laufen.map((e) => ({ ...e, grund })), ausgelassen: verteilt.ausgelassen,
    });
  } else {
    auswahl = bauen({ basis: nullpunkt.commit, stufe: "push", geaendert: geaenderteDateien(nullpunkt.commit), ...verteilt });
  }
  auswahl.integration = { nullpunkt, pakete: nullpunkt === null ? [] : paketeSeit(nullpunkt.commit) };
  return auswahl;
}

/**
 * Die Auswahl der FREIGABESTUFE (Issue #1000): Sie prueft nur, was `push main` nicht
 * geprueft hat. `merge production` gibt es nie ohne vorheriges `push main` — der Skill
 * haelt vorher an, wenn `<mainBranch>` Unveroeffentlichtes traegt. Der Stand bis zum
 * Anker (`git merge-base HEAD origin/<mainBranch>`) ist darum vollstaendig geprueft,
 * und die Dateien seit dem Anker sind die Release-Dateien des Merge-Wegs.
 *
 *   - Stufe `merge` laeuft immer: Sie ist genau das, was nur hier laeuft.
 *   - Stufe `push` laeuft nicht und sagt, wo sie lief.
 *   - Die Paketstufe waehlt nach Bereichen ueber die Dateien seit dem Anker, mit
 *     denselben Regeln wie beim Abschluss einer Karte: leeres Paket laesst sie aus, eine
 *     Datei ohne Muster faehrt sie ganz (`vollerUmfang`).
 *
 * `leeresPaket` bleibt false, auch ohne Aenderung: Die Merge-Pruefungen laufen, und
 * ein Bericht "keine Pruefung, weil nichts veraendert wurde" waere falsch.
 */
function freigabeAuswahl({ checks, basis, geaendert, bereiche, ohneZuordnung, ohnePruefung, ohneMuster, zweifelGrund, beruehrt, blobBereiche, abschluss, abgeleitet, abhaengig }) {
  const leer = geaendert.length === 0;
  const zweifel = !leer && ohneMuster !== null;
  const paketstufe = (check) => {
    if (leer) return { laeuft: false, grund: t("grundLeeresPaket", { basis }) };
    if (zweifel) return { laeuft: true, grund: zweifelGrund };
    return entscheidung(check, beruehrt, blobBereiche);
  };
  return bauen({
    basis, stufe: "merge", geaendert, bereiche, ohneZuordnung, ohnePruefung, vollerUmfang: zweifel, abschluss, abgeleitet, abhaengig,
    ...verteilen(checks, "merge", (check) => {
      if (check.stufe === "merge") return { laeuft: true, grund: t("grundFreigabe") };
      if (check.stufe === "push") return { laeuft: false, grund: t("grundPushGeprueft") };
      return paketstufe(check);
    }, abschluss),
  });
}

/**
 * Die Auswahl von `run --release-only` (Issue #2249, Plan #2242 E4): zuerst der Beleg der
 * Release-Ableitung als eigener Eintrag in `laufen` (Feld `beleg`), danach die Pruefungen der
 * Stufe `merge`. Die Paketstufe und `push` bleiben aus — `push main` hat den Stand geprueft, und
 * die Release-Aenderungen belegt der Beleg. `geaendert` und damit `hashes` kommen wie bei jedem
 * Lauf aus den Dateien seit `--since`. Ohne aufloesbare Basis gibt es keinen Beleg: Abbruch.
 */
function releaseAuswahl(args) {
  const checks = (ladeConfig().buildChecks ?? []).map((c) => normalisiere(c));
  const basis = ankerAufloesen(args.since);
  if (basis === null) fail(t("releaseOnlyOhneBasis", { ref: args.since }));
  const stufe = "merge";
  const { laufen, ausgelassen } = verteilen(checks, stufe, (check) => (check.stufe === "merge"
    ? { laeuft: true, grund: t("grundFreigabe") }
    : { laeuft: false, grund: t("grundReleaseBelegt") }));
  const beleg = { cmd: `release-only --release-stage ${args.releaseStufe}`, stufe, grund: t("grundReleaseBeleg"), beleg: { stufe: args.releaseStufe } };
  const auswahl = bauen({ basis, stufe, geaendert: geaenderteDateien(basis), laufen: [beleg, ...laufen], ausgelassen });
  auswahl.releaseOnly = { stufe: args.releaseStufe };
  return auswahl;
}

/**
 * Faehrt den Beleg eines Eintrags mit `beleg` (Issue #2249) im Arbeitsverzeichnis des Laufs und
 * gibt ihn in der Form von `kommandoAusfuehren` zurueck. `KIT_RELEASE_DATE` aus der Umgebung des
 * Laufs geht an die Release-Schritte, damit die Marke dieselbe ist wie im Release-Worktree.
 */
async function belegFahren(eintrag, basis, env) {
  const release = await import("./checks/release.mjs").catch((err) => (err?.code === "ERR_MODULE_NOT_FOUND" ? null : Promise.reject(err)));
  if (!release) return { gruen: false, ausgabe: `${t("releaseOnlyOhnePro")}\n`, haengend: false, code: 1 };
  const ergebnis = release.releaseLokal({ repoRoot: wurzel(), basis, stufe: eintrag.beleg.stufe, datum: env.KIT_RELEASE_DATE ?? null });
  return { gruen: ergebnis.belegt, ausgabe: `${ergebnis.grund}\n`, haengend: false, code: ergebnis.belegt ? 0 : 1 };
}

// --- Bereiche (Issue #1004) ------------------------------------------------

/** Die bereichsgebundenen Kommandos der Paketstufe — die einzigen, die die Auswahl nach Bereichen trifft. */
function bereichsgebunden(checks) {
  return checks.filter((check) => check.stufe === STUFEN[0] && check.areas);
}

/** Bereich → Grund aus `gekoppelteBereiche` (E14). */
function kopplungsgruende(config) {
  return new Map((config.gekoppelteBereiche ?? []).map((e) => [e.bereich, e.grund]));
}

/**
 * Das Urteil je Kommando (Issue #1214, Plan #1199, E13): Ein bereichsgebundenes Kommando
 * der Paketstufe ist BREIT, wenn seine `areas` alle oder alle bis auf einen der Bereiche
 * nennen und es mindestens `HERVORHEBUNG_AB_KOMMANDOS` solcher Kommandos gibt. Dann laeuft
 * es bei (fast) jeder Aenderung — so zeigt sich eine schwere Suite eines Projekts, die das
 * Urteil `hervorgehoben` je Bereich nicht sieht.
 *
 * `kopplungsgrund` traegt den Grund des ersten gekoppelten Bereichs, den das Kommando
 * nennt, sonst null. Wie beim Bereich aendert er am Urteil nichts; er unterdrueckt nur
 * die Hinweiszeile im Bericht (`zuschnittHinweise`).
 */
function kommandoUrteile(checks, checkAreas, kopplung) {
  const gebunden = bereichsgebunden(checks);
  const b = Object.keys(checkAreas).length;
  return gebunden.map((check) => {
    const genannt = new Set(check.areas.filter((name) => Object.hasOwn(checkAreas, name)));
    const gekoppelt = [...genannt].find((name) => kopplung.get(name));
    return {
      cmd: check.cmd,
      nennend: genannt.size,
      von: b,
      breit: gebunden.length >= HERVORHEBUNG_AB_KOMMANDOS && genannt.size >= b - 1,
      kopplungsgrund: gekoppelt === undefined ? null : kopplung.get(gekoppelt),
    };
  });
}

/** Die Hinweise auf breite Kommandos ohne Kopplungsgrund, fuer den Berichtsblock (E13). */
function zuschnittHinweise(config, checks) {
  return kommandoUrteile(checks, config.checkAreas ?? {}, kopplungsgruende(config))
    .filter((u) => u.breit && u.kopplungsgrund === null)
    .map((u) => t("zuschnittHinweis", { cmd: u.cmd }));
}

/**
 * Der Anteil je Bereich aus `bereicheAuswerten`, ohne Inventar: allein aus der Config, ohne
 * git und ohne Datei zu lesen. Exportiert, damit test/config-teile.test.mjs dieselbe
 * Hervorhebung im selben Prozess bekommt, statt `checks.mjs areas` zu starten (Issue #1235).
 */
export function anteilJeBereich(config) {
  const checks = (config.buildChecks ?? []).map((c) => normalisiere(c));
  const checkAreas = config.checkAreas ?? {};
  pruefeBereichsnamen(checks, checkAreas);

  const gebunden = bereichsgebunden(checks);
  const m = gebunden.length;
  const kopplung = kopplungsgruende(config);
  const bereiche = Object.entries(checkAreas).map(([name, muster]) => {
    const n = gebunden.filter((check) => check.areas.includes(name)).length;
    return {
      name,
      muster: muster ?? [],
      nennend: n,
      von: m,
      hervorgehoben: m >= HERVORHEBUNG_AB_KOMMANDOS && n >= m - 1,
      kopplungsgrund: kopplung.get(name) ?? null,
    };
  });
  return { checks, checkAreas, kopplung, kommandos: m, bereiche };
}

/**
 * Anteil je Bereich und Inventar der versionierten Dateien (Issue #1004, Plan #1001, E7,
 * E8, E14) — die Rohdaten der Wirksamkeits-Auswertung.
 *
 * Gezaehlt werden die BEREICHSGEBUNDENEN Kommandos der PAKETSTUFE (`m`): Nur sie waehlt die
 * Auswahl eines Arbeitspakets nach Bereichen aus. Ein Kommando ohne `areas` laeuft ohnehin
 * immer, und eines der Stufe `push` oder `merge` laeuft nach Zeitpunkt — beide sagen ueber
 * den Zuschnitt der Bereiche nichts. Ein Bereich ist HERVORGEHOBEN, wenn er in allen oder
 * allen bis auf eines steht (`n ≥ m−1`) und `m` mindestens drei ist: Dann loest eine
 * Aenderung darin (fast) jeden Prueflauf aus, und der Bereich schneidet nichts mehr heraus.
 *
 * Ein Eintrag in `gekoppelteBereiche` (E14) aendert an der Hervorhebung NICHTS, er traegt
 * nur ihren Grund: Eine gemessene Kopplung, die den Bereich in fast alle Kommandos zwingt,
 * ist eine begruendete Ausnahme und kein Ausschalter — sie bleibt sichtbar.
 *
 * Das INVENTAR geht durch `zuordnen`, dieselbe Funktion, die jede Auswahl trifft (E7): Eine
 * zweite Glob-Logik bescheinigte ab der ersten Abweichung eine Deckung, die die Auswahl
 * nicht sieht — derselbe Grund wie bei `globZuRegex` fuer test/config-teile.test.mjs.
 * Versioniert heisst `git ls-files`: Ungetracktes gehoert zu keinem Stand des Projekts.
 */
function bereicheAuswerten() {
  const config = ladeConfig();
  const { checks, checkAreas, kopplung, kommandos: m, bereiche } = anteilJeBereich(config);

  const ls = git("ls-files", "-z");
  if (ls.status !== 0) fail(t("gitLsFilesGescheitert", { grund: gitGrund(ls) }));
  const dateien = ls.stdout
    .split("\0")
    .filter((pfad) => pfad !== "")
    .map((pfad) => pfad.replaceAll("\\", "/"))
    .sort(vergleicheText);
  const { ohneZuordnung, ohnePruefung } = zuordnen(
    dateien,
    bereicheVorbereiten(checkAreas),
    freistellungenVorbereiten(config.ohnePruefung),
  );

  return {
    kommandos: m,
    bereiche,
    kommandoUrteile: kommandoUrteile(checks, checkAreas, kopplung),
    inventar: {
      dateien: dateien.length,
      ohneTreffer: ohneZuordnung.length + ohnePruefung.length,
      freigestellt: ohnePruefung,
      ohneZuordnung,
    },
  };
}

// --- Ausfuehrung (Issue #424) ----------------------------------------------

/**
 * Liest den env-Block aus .claude/settings.json (falls vorhanden) — uebernommen
 * aus `settingsEnv` in night.mjs, nicht neu erfunden.
 *
 * Dort stehen projektspezifische Variablen (z.B. DOCKER_HOST /
 * TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE fuer Testcontainers unter Colima), die
 * Claude Code seinen eigenen Bash-Aufrufen automatisch mitgibt. checks.mjs ist
 * aber ein eigener Node-Prozess ausserhalb von Claude Code und bekommt sie sonst
 * nicht — ohne sie ein falsches Rot (beobachtet bei kanban-kit #445: mvn verify
 * schlug ohne die beiden Variablen mit Mockito-MockMaker-Fehlern fehl).
 *
 * Precedence wie in Claude Code: settings.json zuerst, settings.local.json
 * gewinnt. Die local-Datei ist gitignored und damit der uebliche Ort fuer
 * maschinenspezifische Werte — genau die, die hier fehlen wuerden (Issue #168).
 *
 * Ist die Wurzel ein verknuepfter Git-Worktree (Kartenpruefung, Paket-Arbeitskopie),
 * fehlen dort beide Dateien: `.claude/*` ist gitignored und reist nicht mit. Dann
 * kommen sie zuerst aus der Hauptkopie, dem Elternordner von `--git-common-dir`,
 * und danach aus dem Worktree selbst, der so beim selben Schluessel gewinnt
 * (Issue #2183). Ohne Git, ausserhalb eines Worktrees oder wenn git scheitert,
 * bleibt es bei der Wurzel allein.
 */
export function settingsEnv(basis = wurzel()) {
  const merged = {};
  for (const ort of [hauptkopieVonWorktree(basis), basis]) {
    if (ort === null) continue;
    for (const name of ["settings.json", "settings.local.json"]) {
      const pfad = join(ort, ".claude", name);
      if (!existsSync(pfad)) continue;
      try {
        const settings = JSON.parse(readFileSync(pfad, "utf-8"));
        if (settings.env && typeof settings.env === "object") Object.assign(merged, settings.env);
      } catch {
        // Kaputtes JSON blockiert den Lauf nicht — nur diese eine Quelle faellt aus.
      }
    }
  }
  return merged;
}

/** Die Hauptkopie, wenn `basis` ein verknuepfter Worktree ist, sonst `null` (Issue #2183). */
function hauptkopieVonWorktree(basis) {
  const res = gitIn(basis, "rev-parse", "--git-dir", "--git-common-dir");
  if (res.status !== 0 || typeof res.stdout !== "string") return null;
  const [gitDir, commonDir] = res.stdout.split("\n").map((zeile) => zeile.trim());
  if (!gitDir || !commonDir) return null;
  const common = resolve(basis, commonDir);
  return resolve(basis, gitDir) === common ? null : dirname(common);
}

/**
 * Fuehrt ein konfiguriertes Kommando aus.
 *
 * Eine Shell ist hier zwingend — anders als in board.mjs, wo Issue #196 sie gerade
 * abgeschafft hat. Der Unterschied: Dort stehen die Kommandos fest im Code und
 * lassen sich als Argument-Array uebergeben. Hier ist `cmd` eine frei konfigurierte
 * Kommandozeile aus der workflow.config.json ("mvn verify", "npm --prefix frontend
 * run build"), die Operatoren und Umleitungen enthalten darf. Ohne Shell gaebe es
 * das Feature nicht.
 *
 * Die Shell ist /bin/sh — siehe `kommandoStart`.
 *
 * PATH-Aufloesung bewusst (S4036, Issue #183).
 *
 * Die Ausgabe wird eingesammelt und von uns geschrieben statt via stdio:"inherit"
 * durchgereicht: nur so steht sie garantiert zwischen der eigenen Kopf- und
 * Fusszeile und nicht irgendwo dazwischen.
 */
function kommandoAusfuehren(cmd, env, grenzen = {}) {
  return startAusfuehren(kommandoStart(cmd), env, grenzen);
}

/** Startet eine Kommandozeile nach `kommandoStart` und sammelt ihr Ergebnis ein. */
function startAusfuehren(start, env, { grenzeMs = Infinity, fristMs = HAENGEN_FRIST_MS } = {}) {
  // Asynchron seit Issue #1070 (Plan #1066): Gleichzeitige Kindprozesse gehen mit
  // `spawnSync` nicht. Die Ausgabe bleibt, wie sie war — erst stdout, dann stderr —,
  // und wird als Ganzes dekodiert, damit kein Zeichen an einer Stueckgrenze zerfaellt.
  return new Promise((aufloesen) => {
    const stdout = [];
    const stderr = [];
    let erledigt = false;
    let haengend = false;
    const uhren = [];
    const fertig = (code) => {
      if (erledigt) return;
      erledigt = true;
      for (const uhr of uhren) clearTimeout(uhr);
      // code ist null, wenn der Prozess durch ein Signal endete oder gar nicht erst
      // startete — beides ist rot, nie gruen. Ein Haenger ist rot, auch wenn die Gruppe
      // auf SIGTERM hin noch sauber endet.
      const ausgabe = `${Buffer.concat(stdout).toString("utf-8")}${Buffer.concat(stderr).toString("utf-8")}`;
      aufloesen({ gruen: code === 0 && !haengend, ausgabe, haengend, code: haengend ? null : code });
    };
    // stdin "ignore" (Issue #1076): Ohne Angabe waere sie eine Pipe, deren Schreibende
    // wir halten und nie schliessen. Ein Nachfahre, der von stdin liest, ohne eine
    // eigene zu bekommen — etwa `board.mjs … --text -` in einem Test —, wartete darauf
    // endlos. `ignore` ist /dev/null: Er sieht sofort Ende-der-Eingabe.
    //
    // Eine eigene Prozessgruppe (`detached`, Issue #1077, siehe `startOptionen`): Gestartet wird die Shell, und der
    // eigentliche Haenger haengt als Enkel unter ihr, etwa `node --test` -> `board.mjs`.
    // Nur ueber die Gruppe erreicht ihn der Abbruch — ein Weg ueber die Prozessliste
    // (`ps`) scheitert in der Sandbox der Sessions. Damit die Gruppe beim Abbruch des
    // AUFRUFERS nicht verwaist, beendet `laufendeGruppenBeenden` sie mit (siehe dort).
    const kind = spawn(start.befehl, start.args, { cwd: wurzel(), env, ...startOptionen() });
    if (kind.pid) LAUFENDE_GRUPPEN.add(kind.pid);
    kind.stdout.on("data", (stueck) => stdout.push(stueck));
    kind.stderr.on("data", (stueck) => stderr.push(stueck));
    kind.on("error", () => fertig(null));
    kind.on("close", (code) => {
      LAUFENDE_GRUPPEN.delete(kind.pid);
      fertig(code);
    });
    if (Number.isFinite(grenzeMs) && kind.pid) {
      uhren.push(setTimeout(() => {
        haengend = true;
        haengerAbbrechen(kind.pid, fristMs, uhren, fertig);
      }, grenzeMs));
    }
  });
}

/**
 * Bricht die Gruppe eines haengenden Kommandos ab (Issue #1077): SIGTERM, nach `fristMs`
 * SIGKILL. Das Netz danach: Haelt ein Prozess ausserhalb der Gruppe die Pipe offen, kaeme
 * `close` nie. Dann gilt das Kommando nach einer weiteren Sekunde als beendet — `run`
 * soll binnen Grenze und Frist fertig sein, nicht irgendwann.
 */
function haengerAbbrechen(pid, fristMs, uhren, fertig) {
  gruppeSignal(pid, "SIGTERM");
  const netz = () => {
    LAUFENDE_GRUPPEN.delete(pid);
    fertig(null);
  };
  uhren.push(setTimeout(() => {
    gruppeSignal(pid, "SIGKILL");
    uhren.push(setTimeout(netz, 1_000));
  }, fristMs));
}

/** Die Prozessgruppen der gerade laufenden Pruefungen (Issue #1077). */
const LAUFENDE_GRUPPEN = new Set();

/**
 * Die `spawn`-Optionen eines Kommandos (Issue #1123): eine eigene Prozessgruppe (`detached`,
 * Issue #1077), damit ein Haenger samt Enkeln abgebrochen werden kann.
 */
export function startOptionen() {
  return { stdio: ["ignore", "pipe", "pipe"], detached: true };
}

/**
 * Wie eine konfigurierte Kommandozeile startet (Issue #1176): `/bin/sh -c <zeile>` —
 * dasselbe, was Node mit der Shell-Option startete. Liefert `{ befehl, args }`.
 */
export function kommandoStart(cmd) {
  return { befehl: "/bin/sh", args: ["-c", cmd] };
}

/**
 * Wie ein Baum beendet wird (Issue #1123): ein Signal an die Prozessgruppe, denn ein Signal
 * an die PID erreichte nur die Shell, und ihre Enkel hielten das Arbeitsverzeichnis fest.
 */
export function baumBeendenAufruf(pid, signal) {
  return { pid: -pid, signal };
}

/** Ein Signal an die Prozessgruppe `pid`. Ein Baum, der schon fort ist, wird uebergangen. */
function gruppeSignal(pid, signal) {
  const aufruf = baumBeendenAufruf(pid, signal);
  try {
    process.kill(aufruf.pid, aufruf.signal);
  } catch {
    // schon beendet
  }
}

/**
 * Beendet die Gruppen der laufenden Pruefungen, wenn `checks.mjs` selbst beendet wird
 * (Issue #1077). Die Pruefungen laufen in eigenen Gruppen und bekaemen das Signal an den
 * Aufrufer sonst nicht mit: Der Runner beendet eine Session an ihrer Gruppe mit
 * SIGTERM, Ctrl-C schickt SIGINT an die Vordergrundgruppe. Ein SIGKILL an `checks.mjs`
 * laesst sich nicht abfangen — das bleibt die Luecke dieses Wegs.
 */
function laufendeGruppenBeenden(signal) {
  for (const pid of LAUFENDE_GRUPPEN) gruppeSignal(pid, "SIGKILL");
  LAUFENDE_GRUPPEN.clear();
  process.exit(signal === "SIGINT" ? 130 : 143);
}
/** Einmal je Prozess, erst in `run` — ein Import des Moduls soll keine Handler setzen. */
let gruppenHandlerGesetzt = false;
function gruppenHandlerSetzen() {
  if (gruppenHandlerGesetzt) return;
  gruppenHandlerGesetzt = true;
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => laufendeGruppenBeenden(signal));
}

/**
 * Das erste getroffene Merkmal der festen Liste oder `null`.
 *
 * Exportiert, damit die Gegenprobe an echten Maven-Logs
 * (`test/checks-fehlermerkmal.test.mjs`, Fixtures unter `test/fixtures/`) DIESE
 * Funktion trifft und keine Kopie: Eine zweite Fassung im Test bescheinigte ab der
 * ersten Abweichung eine Pruefung, die das ausfuehrende Kommando nicht macht —
 * derselbe Grund wie bei `globZuRegex` und `blobHashes`.
 *
 * Erst getroffen heisst: erstes Merkmal der LISTE, nicht der Ausgabe. Welches von
 * zwei Merkmalen weiter oben in einem Log steht, sagt ueber die Ursache nichts.
 */
// SYNC: dieselbe Pruefung traegt kit/night.mjs (fehlermerkmal samt FEHLERMERKMALE)
// fuer die Salvage-Vorpruefung des Runners; test/guete-wertung-sync.test.mjs haelt
// beide an derselben Fallliste gegeneinander.
export function fehlermerkmal(ausgabe) {
  return FEHLERMERKMALE.find((merkmal) => ausgabe.includes(merkmal)) ?? null;
}

// --- Festgefahrene Pruefung (Issue #1388, Plan #1386) -------------------------

// Die Orte temporaerer Dateien, die laengeren zuerst: `/private/tmp/` enthaelt `/tmp/`. Aus
// Segmenten gebaut, weil sie hier nur gesucht und nie beschrieben werden — als Literal hielte
// sie die Lint-Regel fuer oeffentlich beschreibbare Verzeichnisse fuer einen Schreibort.
const TEMP_ORTE = [["private", "var", "folders"], ["var", "folders"], ["private", "tmp"], ["tmp"]]
  .map((segmente) => `/${segmente.join("/")}/`);

/** Ersetzt jeden Pfad, der an einem der `orte` beginnt, bis zum naechsten Leerraum, Anfuehrungszeichen oder `)`. */
function tempPfadeErsetzen(text, orte) {
  let t = text;
  for (const ort of orte) {
    let ab = t.indexOf(ort);
    while (ab >= 0) {
      let bis = ab + ort.length;
      while (bis < t.length && !/[\s'"`)]/.test(t[bis])) bis += 1;
      t = `${t.slice(0, ab)}<tmp>${t.slice(bis)}`;
      ab = t.indexOf(ort, ab + 5);
    }
  }
  return t;
}

/**
 * Ersetzt, was von Lauf zu Lauf wechselt, ohne etwas ueber den Fehler zu sagen (E4):
 * Uhrzeiten samt Zeitzone, Daten, temporaere Pfade, UUIDs, Hexfolgen ab 8 Zeichen und
 * Dauern. Ein ISO-Zeitstempel wird so zu `<datum>T<zeit>`. Die Reihenfolge zaehlt — der
 * Pfad und die UUID vor der Hexfolge, die sonst Teile von ihnen fraesse.
 */
function abdruckNormalisieren(text, tmpdir) {
  let ort = typeof tmpdir === "string" ? tmpdir : "";
  while (ort.endsWith("/")) ort = ort.slice(0, -1);
  const orte = ort === "" ? TEMP_ORTE : [`${ort}/`, ...TEMP_ORTE];
  return tempPfadeErsetzen(text, orte)
    .replaceAll(/\d{1,2}:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:?\d\d)?/g, "<zeit>")
    .replaceAll(/\d{4}-\d\d-\d\d/g, "<datum>")
    .replaceAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    .replaceAll(/\b[0-9a-f]{8,}\b/gi, "<hex>")
    .replaceAll(/\b\d+(?:\.\d+)?\s?m?s\b/g, "<dauer>");
}

/** Der Testname ohne angehaengte Dauer, `(<dauer>)` wie bei node:test und Jest, `<dauer>` wie bei Vitest. */
function ohneDauer(name) {
  for (const ende of ["(<dauer>)", "<dauer>"]) {
    if (name.endsWith(ende)) return name.slice(0, -ende.length).trim();
  }
  return name.trim();
}

/** node:test TAP: `not ok <n> - <name>`; die Direktive hinter ` # ` gehoert nicht zum Namen. */
function tapName(zeile) {
  if (!zeile.startsWith("not ok ")) return undefined;
  const strich = zeile.indexOf(" - ");
  if (strich < 0) return undefined;
  const name = zeile.slice(strich + 3);
  const direktive = name.indexOf(" # ");
  return direktive < 0 ? name : name.slice(0, direktive);
}

/** node:test Spec (`✖`), Jest (`✕`, `●`) und Vitest (`×`), ohne die Kopfzeile der Spec-Zusammenfassung. */
function markenName(zeile) {
  if (!["✖ ", "✕ ", "× ", "● "].some((marke) => zeile.startsWith(marke))) return undefined;
  const name = zeile.slice(2).trim();
  return name === "failing tests:" ? undefined : name;
}

/** Maven Surefire: die Zeile mit `<<< FAILURE!` oder `<<< ERROR!`, bei der Klassenzeile die Klasse hinter ` in `. */
function surefireName(zeile) {
  const pfeil = zeile.indexOf("<<< ");
  if (pfeil < 0 || !(zeile.includes("<<< FAILURE!") || zeile.includes("<<< ERROR!"))) return undefined;
  const nachher = zeile.slice(pfeil);
  const klasse = nachher.lastIndexOf(" in ");
  if (klasse >= 0) return nachher.slice(klasse + 4);
  let name = zeile.slice(0, pfeil);
  const zeit = name.indexOf("Time elapsed");
  if (zeit >= 0) name = name.slice(0, zeit);
  if (name.startsWith("[ERROR]")) name = name.slice("[ERROR]".length);
  name = name.trim();
  return name.endsWith("--") ? name.slice(0, -2) : name;
}

/** Die gescheiterten Testnamen der normalisierten Zeilen, je Name einmal. */
function testnamen(zeilen) {
  const namen = new Set();
  for (const zeile of zeilen) {
    const z = zeile.trimStart();
    const name = tapName(z) ?? markenName(z) ?? surefireName(z);
    const rein = name === undefined ? "" : ohneDauer(name);
    if (rein !== "") namen.add(rein);
  }
  return namen;
}

const FEHLERKENNUNG = /error|fehler|failed/i;
// Ein Zaehler mit dem Wert 0: `Errors: 0`, `Failures: 0`, `0 failed` (Issue #1977).
const NULL_ZAEHLER_NACHGESTELLT = /\b(?:errors?|failures?|failed|fehler)\s*[:=]\s*0\b/gi;
const NULL_ZAEHLER_VORANGESTELLT = /\b0\s+(?:errors?|failures?|failed|fehler)\b/gi;
// Ein Log-Level in Klammern wie `[INFO]` ist kein Inhalt einer Fehlerzeile (Issue #1977).
const LOG_LEVEL = /\[[A-Z]+\]/g;

/** Die Zeile ohne die Treffer aus `FEHLERMERKMALE`. */
function ohneMerkmale(zeile) {
  return FEHLERMERKMALE.reduce((z, m) => z.replaceAll(m, ""), zeile);
}

/** Traegt die Zeile eine Fehlerkennung ausserhalb von Null-Zaehlern und Fehlermerkmalen? */
function hatFehlerkennung(zeile) {
  const rest = ohneMerkmale(zeile).replaceAll(NULL_ZAEHLER_NACHGESTELLT, "").replaceAll(NULL_ZAEHLER_VORANGESTELLT, "");
  return FEHLERKENNUNG.test(rest);
}

/** Traegt die Zeile ein Fehlermerkmal und daneben mehr als Merkmale und Log-Level? */
function merkmalMitInhalt(zeile) {
  if (!FEHLERMERKMALE.some((m) => zeile.includes(m))) return false;
  return ohneMerkmale(zeile).replaceAll(LOG_LEVEL, "").trim() !== "";
}

/**
 * Der Fehlerabdruck einer roten Ausgabe (Issue #1388, Plan #1386, E4): woran zwei
 * Fehlschlaege als "auf dieselbe Weise" erkennbar sind. Die sortierte Menge der
 * gescheiterten Testnamen, mit ` | ` verbunden. Ohne erkannte Testnamen in dieser Reihenfolge
 * (Issue #1977): die erste Zeile mit einem Treffer aus `FEHLERMERKMALE` und weiterem Inhalt
 * (Merkmale und Log-Level wie `[INFO]` zaehlen nicht als Inhalt), dann die erste Zeile mit
 * Fehlerkennung (`error`, `fehler`, `failed`), die nicht nur aus Null-Zaehlern wie
 * `Errors: 0` besteht, dann die erste Zeile mit nacktem Merkmal, sonst die erste nicht leere.
 * So schlaegt der Abbruch von Maven die Surefire-Zusammenfassung und die Logzeile eines
 * gruenen Tests. Alles zuvor normalisiert, damit Dauer und Zufall nicht zaehlen.
 */
export function fehlschlagAbdruck(ausgabe, { tmpdir = umgebungsVariablen().TMPDIR } = {}) {
  const zeilen = abdruckNormalisieren(String(ausgabe ?? ""), tmpdir)
    .split("\n")
    .map((z) => (z.endsWith("\r") ? z.slice(0, -1) : z));
  const namen = testnamen(zeilen);
  if (namen.size > 0) return [...namen].sort(vergleicheText).join(" | ");
  const fehlerzeile = zeilen.find(merkmalMitInhalt)
    ?? zeilen.find(hatFehlerkennung)
    ?? zeilen.find((z) => FEHLERMERKMALE.some((m) => z.includes(m)))
    ?? zeilen.find((z) => z.trim() !== "");
  return (fehlerzeile ?? "").trim();
}

/** Die Laenge, auf die ein Fund gekuerzt wird (Plan #2087, E2). */
const FUND_HOECHSTENS = 2000;
// Eine Zeile `Umgebung: <Handgriff>` oder `Environment: <Handgriff>` am Zeilenanfang (A3):
// Das Kit fuehrt keine Musterliste, die Pruefung sagt es selbst.
const UMGEBUNG_ZEILE = /^(?:Umgebung|Environment):(.*)$/m;

/**
 * Je rotem Eintrag die erste Zeile seines Funds und bei einem Fund an der Umgebung der
 * Handgriff (Issue #2090, Plan #2087, E4): fuer das Protokoll des Build-Diensts, das nur
 * die Ausgabe kennt — neben den Verursacher-Zeilen.
 */
function fundZeilenSchreiben(laufen) {
  for (const e of laufen.filter((l) => l.ergebnis === "rot")) {
    aufStdout(`${t("fundZeile", { cmd: e.cmd, text: (e.fund ?? "").split("\n")[0].replace(/\r$/, "") })}\n`);
    if (e.art === "umgebung") aufStdout(`${t("umgebungZeile", { cmd: e.cmd, text: e.handgriff })}\n`);
  }
}

/**
 * Der Fund einer roten Ausgabe im Wortlaut (Issue #2090, Plan #2087, A2, E2): der
 * unveraenderte Ausschnitt ab der Zeile, die auch `fehlschlagAbdruck` ohne Testnamen waehlt,
 * hoechstens `FUND_HOECHSTENS` Zeichen. Dazu die Art: `umgebung` mit `handgriff`, wenn die
 * Ausgabe eine Zeile `Umgebung: …` oder `Environment: …` traegt, sonst `projekt`.
 */
export function fundVon(ausgabe) {
  const text = String(ausgabe ?? "");
  const zeilen = text.split("\n");
  const ohneCr = zeilen.map((z) => (z.endsWith("\r") ? z.slice(0, -1) : z));
  let index = ohneCr.findIndex(merkmalMitInhalt);
  if (index < 0) index = ohneCr.findIndex(hatFehlerkennung);
  if (index < 0) index = ohneCr.findIndex((z) => FEHLERMERKMALE.some((m) => z.includes(m)));
  if (index < 0) index = ohneCr.findIndex((z) => z.trim() !== "");
  const fund = index < 0 ? "" : zeilen.slice(index).join("\n").slice(0, FUND_HOECHSTENS);
  const umgebung = UMGEBUNG_ZEILE.exec(text);
  return umgebung
    ? { fund, art: "umgebung", handgriff: umgebung[1].replace(/\r$/, "").trim() }
    : { fund, art: "projekt" };
}

/**
 * Die Folgen gleicher Fehlschlaege nach einem Lauf (Issue #1388, Plan #1386, E3): je `cmd`
 * der Abdruck und wie oft er hintereinander kam. Ein rotes Kommando mit demselben Abdruck
 * zaehlt weiter, mit einem anderen beginnt es bei 1; ein gruenes verliert seine Folge; ein
 * nicht gefahrenes (`nicht gestartet`) bleibt, wie es war. `vorige` ist das Feld
 * `festgefahren` der vorigen Zusammenfassung; eine dort ausgeloeste Bremse traegt der neue
 * Stand nicht weiter.
 */
export function festgefahrenNach(vorige, laufen) {
  const folgen = gueltigeFolgen(vorige?.folgen);
  for (const e of laufen ?? []) {
    if (e?.ergebnis === "gruen") {
      delete folgen[e.cmd];
    } else if (e?.ergebnis === "rot") {
      const fehler = typeof e.fehler === "string" ? e.fehler : "";
      const bisher = folgen[e.cmd];
      folgen[e.cmd] = { fehler, versuche: bisher?.fehler === fehler ? bisher.versuche + 1 : 1 };
    }
  }
  return { folgen };
}

/** Die lesbaren Folgen einer vorigen Zusammenfassung, als Kopie; alles andere faellt weg. */
function gueltigeFolgen(alt) {
  const folgen = {};
  if (alt === null || typeof alt !== "object") return folgen;
  for (const [cmd, f] of Object.entries(alt)) {
    if (typeof f?.fehler === "string" && Number.isInteger(f.versuche)) folgen[cmd] = { ...f };
  }
  return folgen;
}

/** Die Grenze aus `night.festgefahrenNach`, sonst die Vorgabe (E11). */
function festgefahrenGrenze() {
  const wert = ladeConfig().night?.festgefahrenNach;
  return Number.isInteger(wert) && wert >= FESTGEFAHREN_MINDEST ? wert : FESTGEFAHREN_VORGABE;
}

/** Unbeaufsichtigt heisst im ganzen Kit: `KIT_AGENT_MODEL` ist gesetzt (E5, wie `kit/board/hook.mjs`). */
function unbeaufsichtigt() {
  const modell = umgebungsVariablen().KIT_AGENT_MODEL;
  return typeof modell === "string" && modell.trim() !== "";
}

// --- Pruefplaetze (Issue #1785, Plan #1404, E11, E12) ------------------------
//
// Die Plaetze fuer volle Prueflaeufe je Rechner sind seit Issue #2016 der Pro-Teil `check-slots`
// in kit/checks/pruefplaetze.mjs (#1995 Kriterium 2, Plan #2008 A3, E1): geladen ueber
// `proLaden` in kit/board/pro.mjs, in Community nie, auch wenn die Datei liegt. Ohne ihn belegt
// kein Lauf einen Platz, und `pruefplatz` in der Zusammenfassung traegt `ohne-plaetze`. Fehlt
// kit/board/pro.mjs neben checks.mjs, gibt es den Teil nicht. Ein Fehler beim Laden einer
// vorhandenen Datei geht weiter: Fehlen ist erlaubt, kaputt sein nicht.

/** Der Platz eines Laufs ohne den Pro-Teil `check-slots`. */
const OHNE_PLAETZE = Object.freeze({ art: "ohne-plaetze", lock: null });

/** Der Lader der Pro-Teile, `null`, wenn kit/board/pro.mjs fehlt. */
async function proLader() {
  return import(new URL("./board/pro.mjs", import.meta.url).href).catch(() => null);
}

/**
 * In Community die Zeile der uebergangenen Pro-Einstellungen, die dieser Lauf aus der Umgebung
 * liest (`KIT_FULL_CHECKS_MAX`, `KIT_FULL_CHECKS_DIR`) — vor dem ersten Kommando, wie die Zeilen
 * der Plaetze in Pro. Ohne gesetzte Einstellung keine Zeile.
 */
function uebergangenMelden(pro) {
  if (pro.ausgabe({ wurzel: wurzel() }) !== "community") return;
  const zeile = pro.uebergangenText(pro.uebergangeneEinstellungen({}, { env: umgebungsVariablen() }));
  if (zeile) aufStdout(`${zeile}\n`);
}

/** Der Pro-Teil `check-slots` fuer die Wurzel dieses Aufrufs, `null` ohne ihn. */
async function pruefplaetzeLaden() {
  const pro = await proLader();
  if (!pro) return null;
  const teil = await pro.proLaden("check-slots", undefined, wurzel());
  if (!teil) uebergangenMelden(pro);
  return teil;
}

/** Die Felder der Zusammenfassung zum Platz: `pruefplatz` immer, ohne den Pro-Teil `ohne-plaetze`. */
function pruefplatzFelderVon(plaetze, platz) {
  if (plaetze) return plaetze.pruefplatzFelder(platz);
  return platz ? { pruefplatz: platz.art } : {};
}

/** Der Platz dieses Laufs (E11), ohne den Pro-Teil `OHNE_PLAETZE`. */
async function pruefplatzFuerLauf(plaetze, auswahl) {
  if (!plaetze) return OHNE_PLAETZE;
  return plaetze.pruefplatzFuerLauf(auswahl, {
    env: umgebungsVariablen(), projekt: wurzel(), paketStufe: STUFEN[0], aufStdout, aufStderr,
  });
}

/**
 * Die Bremse (E6): Hat ein ausgewaehltes Kommando die Grenze erreicht, faehrt
 * unbeaufsichtigt nichts. Die vorige Zusammenfassung bleibt, wie sie ist — das Commit-Gate
 * sieht weiter den roten Stand —, und bekommt allein `festgefahren.ausgeloest`. Rueckgabe:
 * der Exitcode 3 oder `null`, wenn nicht gebremst wird.
 */
function bremsen(auswahl, vorige) {
  if (!unbeaufsichtigt()) return null;
  const folgen = vorige?.festgefahren?.folgen;
  if (folgen === null || typeof folgen !== "object") return null;
  const grenze = festgefahrenGrenze();
  const fest = auswahl.laufen.find((e) => Object.hasOwn(folgen, e.cmd) && folgen[e.cmd]?.versuche >= grenze);
  if (!fest) return null;
  const { fehler, versuche } = folgen[fest.cmd];
  const ausgeloest = { pruefung: fest.cmd, fehler, versuche, zeitpunkt: new Date().toISOString() };
  const pfad = schreibeZusammenfassung({ ...vorige, festgefahren: { ...vorige.festgefahren, ausgeloest } });
  aufStdout(`${FESTGEFAHREN_MARKE} ${fest.cmd} — ${fehler}\n`);
  aufStdout(`${t("bremseVersuche", { versuche, marke: VERSUCHE_MARKE })}\n`);
  aufStdout(`\n${t("zusammenfassung", { pfad })}\n`);
  return 3;
}

/**
 * Die Zeilen ueber die festgefahrenen Kommandos dieses Laufs (E6, E12): unbeaufsichtigt die
 * Ankuendigung des letzten erlaubten Versuchs, interaktiv den Hinweis — beides auf stderr,
 * als Zeile des Werkzeugs und nicht als Eintrag in `hinweise`.
 */
function festgefahrenMelden(laufen, festgefahren) {
  const grenze = festgefahrenGrenze();
  const ohneAufsicht = unbeaufsichtigt();
  for (const e of laufen) {
    const f = festgefahren.folgen[e.cmd];
    if (e.ergebnis !== "rot" || !f || f.versuche < grenze) continue;
    aufStderr(ohneAufsicht
      ? `${t("letzterVersuch", { cmd: e.cmd, versuche: f.versuche, fehler: f.fehler })}\n`
      : `${t("festgefahrenHinweis", { cmd: e.cmd, versuche: f.versuche, fehler: f.fehler })}\n`);
  }
}

/**
 * Die Eintraege aus `buildChecks`, die der ABSCHLUSS eines Arbeitspakets faehrt
 * (Plan #753, E13/E14; Plan #944, E14).
 *
 * Erste Bedingung, die Paketstufe: Ein Eintrag ohne `stufe` gehoert dazu — die
 * String-Form, das Objekt ohne `stufe` und `stufe: "paket"` bedeuten dasselbe. Das ist
 * derselbe Default wie in checks.mjs, und er haelt jede bestehende Config bei ihrem
 * Verhalten. Eintraege der Stufe `push` oder `merge` sind erst beim Veroeffentlichen
 * faellig.
 *
 * Zweite Bedingung, die beiden Gruppen, die ein Abschlusslauf auslaesst (Issue #946,
 * Plan #944, E3/E4): jeder Eintrag mit `nichtBeimAbschluss` und jeder mit `guete`-Block.
 * Der eine traegt den Abschluss einer einzelnen Karte nicht, der andere gewinnt seinen
 * Anteil aus der vollstaendigen Testmenge — aus einem verkuerzten Lauf waere es nicht
 * dieselbe Zahl, sondern eine andere Groesse mit demselben Namen.
 *
 * Der Runner liest daraus an drei Stellen, und alle drei meinen denselben Umfang:
 *   - die NACHPRUEFUNG (`nachpruefLaufen` / `bewertePruefung`) und die
 *     SALVAGE-VORPRUEFUNG (`runBuildChecksSync`) vollziehen einen Abschluss nach, den
 *     sie nicht glauben koennen. Faehren sie MEHR als er, waere das ein zweiter Weg ueber
 *     denselben Vorgang — und er kostete im automatischen Lauf gerade die teuerste Gruppe,
 *     also dort, wo das Zeitbudget am knappsten ist (PO-Antwort 3 des Fachplans #938).
 *   - der START-GUARD fragt, ob die unbeaufsichtigte Umsetzung ueberhaupt ein Gate hat.
 *     Zaehlte er Eintraege mit, die der Abschluss nie faehrt, liesse er eine Config
 *     durch, in der sie keines hat.
 */
// SYNC: derselbe Default steht in normalisiere (oben in dieser Datei) und wird in
// kit/settings.mjs geprueft. Dieselbe Auslassung trifft `verteilen` im Abschlusslauf
// und dieselbe Bedingung `pruefeAbschlussGate`.
export function paketstufenChecks(cfg) {
  return (cfg.buildChecks || []).filter((eintrag) => {
    if (typeof eintrag === "string") return true;
    if ((eintrag.stufe ?? "paket") !== "paket") return false;
    return !eintrag.nichtBeimAbschluss && !eintrag.guete;
  });
}

/** Die Kartennummern der Verursacher, ohne Commits ohne Karte und ohne Doppel. */
function verursacherKartennummern(verursacher) {
  const nummern = verursacher.flatMap((v) => (v.karten ?? []).map((k) => k.karte)).filter((k) => k !== null);
  return [...new Set(nummern)];
}

/**
 * Was die Zusammenfassung des Worktrees bezeugt: `{ ergebnis, stufe, rot, gewackelt, mutation }`. Gruen
 * ist nur ein zu Ende gefahrener Lauf ohne rote und ohne ungestartete Pruefung. Fehlt die Datei
 * oder ist sie unlesbar, ist das Ergebnis rot — ohne Nachweis gibt es nichts zu uebernehmen.
 *
 * `gewackelt` nennt die Kommandos, die in diesem Lauf gewackelt haben — allein aus
 * `laufen[].gewackelt`, nie aus `gewackeltKarte`, das auch Wackler voriger Laeufe traegt
 * (Plan #1395, E14, Fund 3).
 *
 * `rot` traegt die Verursacher nach `verursacherKarten` (E11): Nennt eine rote Pruefung
 * statt Karten einen `hinweis`, oder laesst sich gar keine Karte zuordnen, gelten alle
 * Pakete des Stands.
 *
 * `mutation` ist das Feld des Mutationstests aus dem Lauf an `--stage push` (Issue #1673,
 * Plan #1671, E4), sonst `null`. Es faerbt nur, wenn er anhielt (`haelt` und rot, Issue #2108):
 * Dann ist der Lauf rot, und `rot.pruefung` nennt sein Kommando.
 *
 * Exportiert fuer das Notfall-Gate in board/schutz.mjs (Plan #1405, E9) und den Runner:
 * Beide legen dieselbe Frage, wann ein Lauf gruen ist, nicht ein zweites Mal fest. Liegt hier
 * und nicht in night/kitstand.mjs, damit das Gate ohne Runner laeuft (Issue #1857, Plan #1853, E9).
 */
export function zusammenfassungBezeugt(pfad, pakete) {
  let daten = null;
  try {
    daten = JSON.parse(readFileSync(join(pfad, ".claude", "checks-summary.json"), "utf-8"));
  } catch {
    // keine oder unlesbare Zusammenfassung: unten rot
  }
  const laufen = Array.isArray(daten?.laufen) ? daten.laufen : [];
  const offen = laufen.filter((e) => e.ergebnis === "rot" || e.ergebnis === "nicht gestartet");
  const gewackelt = laufen.filter((e) => e?.gewackelt).map((e) => e.cmd);
  const mutation = daten?.mutation && typeof daten.mutation === "object" ? daten.mutation : null;
  const mutationRot = mutationHaeltAn(mutation);
  if (daten?.abgeschlossen === true && offen.length === 0 && !mutationRot) return { ergebnis: "gruen", stufe: daten.stufe ?? null, rot: null, gewackelt, mutation };

  const roteCmds = [...laufen.filter((e) => e.ergebnis === "rot").map((e) => e.cmd), ...(mutationRot ? [mutation.cmd] : [])];
  const verursacher = (Array.isArray(daten?.verursacher) ? daten.verursacher : []).filter((v) => roteCmds.includes(v.cmd));
  const hinweise = verursacher.filter((v) => v.hinweis !== undefined).map((v) => v.hinweis);
  const karten = verursacherKartennummern(verursacher);
  let hinweis = hinweise.length > 0 ? hinweise.join(" ") : null;
  if (daten === null || daten.abgeschlossen !== true) hinweis = t("keineZusammenfassung");
  const alle = hinweis !== null || karten.length === 0;
  return {
    ergebnis: "rot",
    stufe: daten?.stufe ?? null,
    rot: { pruefung: roteCmds.length > 0 ? roteCmds.join(", ") : null, karten: alle ? pakete : karten, hinweis },
    gewackelt,
    mutation,
  };
}

/**
 * Blob-Hash je Pfad — der Nachweis, gegen den das Commit-Gate den Index prueft.
 *
 * Zwei Entscheidungen stecken hier drin, beide aus Issue #469:
 *
 * `null` haengt an der NICHTEXISTENZ (`lstat` -> ENOENT), nicht am Exit-Code von
 * `git hash-object`. Waere es der Exit-Code, bekaeme eine vorhandene, nur
 * unlesbare Datei denselben Tombstone wie eine geloeschte — und das Gate liest
 * ihn als "geprufte Loeschung". `lstat` statt `stat`, damit ein toter Symlink als
 * vorhanden gilt und nicht stillschweigend zum Tombstone wird.
 *
 * Gehasht wird ueber `git hash-object --stdin-paths`, also EIN Prozess statt einer
 * je Datei: Bei vollem Umfang stehen leicht hundert Pfade in `geaendert`, und jeder
 * Prozessstart kostet. Der Aufruf traegt
 * die Pfade und nicht den Inhalt, damit gits Filterkette (`autocrlf`, `clean`)
 * greift — sonst passte der Hash nicht zu dem Blob, den `git ls-files --stage`
 * dem Gate zeigt.
 *
 * Exportiert, damit findings.mjs denselben Blob-Hash ermitteln kann, statt die
 * Frage ein zweites Mal zu implementieren (Issue #802) — derselbe Grund, aus dem
 * `zusammenfassungPfad` fuer night.mjs exportiert ist (Issue #428). `root` ist das
 * Projekt, gegen das die Pfade gelten: findings.mjs nennt es, wenn es im selben Prozess
 * fuer ein anderes Verzeichnis laeuft (Issue #1213).
 */
export function blobHashes(pfade, root = wurzel()) {
  const hashes = {};
  const vorhanden = [];
  for (const pfad of pfade) {
    try {
      lstatSync(join(root, pfad));
      vorhanden.push(pfad);
    } catch (err) {
      if (err.code !== "ENOENT") {
        fail(t("standUnlesbar", { pfad, grund: err.message }));
      }
      hashes[pfad] = null;
    }
  }
  if (vorhanden.length === 0) return hashes;

  const res = gitSpawn(["hash-object", "--stdin-paths"], {
    cwd: root,
    encoding: "utf-8",
    input: `${vorhanden.join("\n")}\n`,
  });
  if (res.status !== 0) {
    fail(t("hashObjectGescheitert", { grund: (res.stderr || "").trim() }));
  }
  const zeilen = res.stdout.split(/\r?\n/).filter((z) => z.length > 0);
  if (zeilen.length !== vorhanden.length) {
    fail(t("hashObjectAnzahl", { hashes: zeilen.length, pfade: vorhanden.length }));
  }
  vorhanden.forEach((pfad, i) => {
    hashes[pfad] = zeilen[i];
  });
  return hashes;
}

/**
 * Liest den Anteil aus der Ausgabe der Guetemessung (Issue #763, Plan #753).
 *
 * Das Muster ist Pflicht, weil die Werkzeuge Verschiedenes melden — PIT
 * schreibt `Killed 42 (84%)`, Stryker `Mutation score: 84.21`. Die erste
 * Gruppe gilt als Prozentwert, wie die Marke: eine Einheit, keine zwei.
 *
 * Jeder Weg ohne Zahl endet mit `erfuellt: false` und einem Grund (E10):
 * "Ein fehlendes Ergebnis gilt nie als bestandene Pruefung" (AK 11, #738) —
 * dieselbe Richtung, in die dieses Kommando ueberall irrt: mehr pruefen, nie
 * weniger. Das gilt auch fuer ein Muster, das sich nicht uebersetzen laesst:
 * Die Konfigurationspruefung faengt es frueher (Issue #764), aber hier darf es
 * trotzdem nicht als bestanden durchrutschen.
 *
 * Zwei dieser Wege sahen bis Issue #817 nach einer Zahl aus, ohne eine zu sein:
 * `Number("")` und `Number("   ")` sind 0, und 0 genuegt der Marke 0 — eine
 * leere Gruppe bescheinigte so eine Messung, die es nie gab. Und ein Anteil
 * ausserhalb von 0 bis 100 ist keiner: Kein Werkzeug meldet 184 Prozent, der
 * Wert entsteht aus einem verbogenen Muster und sagt ueber die Guete nichts.
 * Beides ist ein nicht auswertbares Ergebnis und damit rot.
 */
// SYNC: dieselbe Wertung traegt kit/night.mjs (gueteAuswerten) fuer die
// Salvage-Vorpruefung des Runners; test/guete-wertung-sync.test.mjs haelt beide
// an derselben Fallliste gegeneinander.
export function gueteAuswerten(guete, ausgabe) {
  let regex;
  try {
    regex = new RegExp(guete.muster);
  } catch (err) {
    return { anteil: null, erfuellt: false, grund: `Muster '${guete.muster}' ist kein regulaerer Ausdruck: ${err.message}` };
  }
  const treffer = regex.exec(ausgabe);
  if (treffer === null) {
    return { anteil: null, erfuellt: false, grund: `Muster '${guete.muster}' trifft die Ausgabe nicht` };
  }
  if (treffer[1] === undefined) {
    return { anteil: null, erfuellt: false, grund: `Muster '${guete.muster}' hat keine Gruppe` };
  }
  if (treffer[1].trim() === "") {
    return { anteil: null, erfuellt: false, grund: `Gruppe '${treffer[1]}' ist leer` };
  }
  const anteil = Number(treffer[1]);
  if (!Number.isFinite(anteil)) {
    return { anteil: null, erfuellt: false, grund: `Gruppe '${treffer[1]}' ist keine Zahl` };
  }
  if (anteil < 0 || anteil > 100) {
    return { anteil: null, erfuellt: false, grund: `Anteil ${anteil} liegt ausserhalb von 0 bis 100 Prozent` };
  }
  const erfuellt = anteil >= guete.marke;
  return { anteil, erfuellt, grund: erfuellt ? "genuegt" : "unter der Marke" };
}

/**
 * Das Ergebnisfeld der Zusammenfassung fuer einen gelaufenen Guete-Eintrag.
 * Ein rotes Kommando wird nicht ausgewertet: Seine Ausgabe ist der Stand eines
 * Abbruchs, und ein darin zufaellig gefundener Anteil bescheinigte eine
 * Messung, die es nicht gab.
 *
 * WARUM der Lauf rot war, weiss der Aufrufer und nicht diese Funktion — der
 * Rueckgabewert oder ein Fehlermerkmal in der Ausgabe (Issue #858). Deshalb kommt
 * `grund` von dort: Ein hier festverdrahteter Satz behauptete bei einem Kommando
 * mit Rueckgabewert 0 das Falsche, und der Grund steht in der Zusammenfassung,
 * aus der der Runner liest.
 */
function gueteErgebnis(eintrag, gruen, ausgabe, grund) {
  const auswertung = gruen
    ? gueteAuswerten(eintrag.guete, ausgabe)
    : { anteil: null, erfuellt: false, grund };
  return {
    cmd: eintrag.cmd,
    anteil: auswertung.anteil,
    marke: eintrag.guete.marke,
    erfuellt: auswertung.erfuellt,
    grund: auswertung.grund,
  };
}

function gueteZeile(ergebnis) {
  return ergebnis.anteil === null
    ? t("gueteOhneErgebnis", { grund: ergebnis.grund })
    : t("gueteErgebnis", { anteil: ergebnis.anteil, marke: ergebnis.marke, grund: ergebnis.grund });
}

/**
 * Das Ergebnisfeld, wenn die Messung nicht lief — nicht gestartet (ein
 * frueheres Kommando war rot) oder an der Paketstufe ausgelassen. Auch das
 * steht in der Zusammenfassung: "kein Ergebnis" ist ein Ergebnis und nie ein
 * Bestehen, und wer die Datei liest, sieht, dass kein Anteil erhoben wurde.
 */
function gueteOhneLauf(laufen, ausgelassen) {
  const geplant = laufen.find((e) => e.guete);
  if (geplant) {
    return { cmd: geplant.cmd, anteil: null, marke: geplant.guete.marke, erfuellt: false, grund: t("gueteNichtGestartet") };
  }
  const eintrag = ausgelassen.find((e) => e.guete);
  if (eintrag) {
    return { cmd: eintrag.cmd, anteil: null, marke: eintrag.guete.marke, erfuellt: false, grund: t("gueteAusgelassen", { grund: eintrag.grund }) };
  }
  return null;
}

/**
 * Maskiert die Trennzeichen des Protokolls im Kommando (Issue #822).
 *
 * Eine Zeile des Protokolls ist zeilen- und tabgetrennt, und `cmd` steht frei
 * konfiguriert dazwischen: Ein Kommando mit Zeilenumbruch zerriss ohne Maskierung
 * seine eigene Zeile, und die Auswertung sah zwei fehlerhafte Zeilen statt einer
 * Ausfuehrung — die Pruefung stuende dort als "nicht gelaufen".
 *
 * Der Backslash wird ZUERST verdoppelt: sonst liesse sich ein echtes `\n` im Kommando
 * nach dem Lesen nicht mehr von einem maskierten Zeilenumbruch unterscheiden.
 *
 * SYNC: kit/effectiveness.mjs wandelt in `kommandoLesen` zurueck. Die Kit-Werkzeuge sind
 * eigenstaendige Single-File-Tools ohne gemeinsames Modul (#440); geteilte Logik wird
 * dupliziert und an beiden Enden markiert.
 */
function kommandoMaskieren(cmd) {
  return cmd
    .replaceAll("\\", String.raw`\\`)
    .replaceAll("\t", String.raw`\t`)
    .replaceAll("\n", String.raw`\n`)
    .replaceAll("\r", String.raw`\r`);
}

/**
 * Eine Liste als EIN Protokollfeld (Issue #1004, E5): jeder Eintrag maskiert wie das
 * Kommando und zusaetzlich das Komma, dann kommagetrennt. Das Komma kommt NACH dem
 * Backslash dran — derselbe Grund wie in `kommandoMaskieren`: Nur so bleibt ein `\,`
 * im Pfad von einem maskierten Trenner unterscheidbar.
 *
 * SYNC: kit/effectiveness.mjs wandelt beim Lesen zurueck (Issue #1005).
 */
function listeMaskieren(eintraege) {
  return eintraege.map((e) => kommandoMaskieren(e).replaceAll(",", String.raw`\,`)).join(",");
}

/**
 * Warum ein Kommando lief — als Daten fuer die Auswertung je Bereich (Issue #1004, Plan
 * #1001, E5). Fuenf Arten, in dieser Reihenfolge entschieden:
 *
 *   - `ohne-bereich`: Das Kommando traegt kein `areas` (String-Form, `{ cmd }`, `always`).
 *     Es waere auf JEDEM Weg gelaufen, auch ohne fehlende Zuordnung und ohne
 *     Veroeffentlichung — seine Minuten gehoeren keinem Ausloeser, und darum steht diese
 *     Art vor allen anderen.
 *   - `anker`: Der Anker liess sich nicht aufloesen. Erkennbar am vollen Umfang OHNE
 *     Dateiliste: Nur dieser Zweig von `planen` kennt keine geaenderten Dateien, der volle
 *     Umfang wegen einer Luecke nennt immer mindestens eine.
 *   - `bereiche` beim Bereichslauf: genau der gewaehlte Bereich, nicht der beruehrte.
 *   - `veroeffentlichung`: jede Pruefung an der Push-Stufe und die Stufe `merge` an der
 *     Freigabe — beide laufen dort nach Zeitpunkt, nicht nach Bereich.
 *   - `ohne-zuordnung`: voller Umfang wegen unzugeordneter Dateien, mit diesen Dateien.
 *   - sonst `bereiche` mit den beruehrten Bereichen des Kommandos.
 *
 * `bereiche` und `dateien` stehen nur bei der Art, die sie erklaeren; sonst sind sie
 * leer. So zaehlt die Auswertung eine Ausfuehrung entweder bei ihren Bereichen oder in
 * einer Sonderzeile, nie in beiden.
 *
 * `check` ist der Eintrag aus der Config, `null`, wenn keiner zum Kommando passt — dann
 * zaehlt es als nicht zugeordnet, dieselbe Deutung wie in `verursacherKarten`.
 */
function ausloeserBestimmen(auswahl, check) {
  const art = (name, bereiche = [], dateien = []) => ({ art: name, bereiche, dateien });
  const areas = check?.areas;
  if (!areas) return art("ohne-bereich");
  if (auswahl.vollerUmfang && auswahl.ohneZuordnung.length === 0) return art("anker");
  if (auswahl.bereichWahl !== null) return art("bereiche", [auswahl.bereichWahl]);
  if (auswahl.stufe === "push" || check.stufe === "merge") return art("veroeffentlichung");
  if (auswahl.vollerUmfang) return art("ohne-zuordnung", [], auswahl.ohneZuordnung);
  return art("bereiche", auswahl.bereiche.filter((name) => areas.includes(name)));
}

/**
 * Haengt eine Ausfuehrung an `.claude/ausfuehrungen.tsv` an (Issue #785).
 *
 * Eine Zeile je BEENDETEM Kommando: Zeitpunkt, Kommando, Ergebnis, Dauer — und dahinter
 * Anlass, Laufkennung und Karte (Issue #948). Ein Kommando mit dem Ergebnis
 * `nicht gestartet` bekommt keine — es ist keine Ausfuehrung, und als Zeile gezaehlt
 * senkte es den Anteil der Beanstandungen einer Pruefung, die gar nicht lief.
 *
 * Angehaengt, nie geleert — sonst saehe die Auswertung nur die letzte Runde, und genau
 * die zweite Runde nach einem Fix ist der Fall, um den es geht.
 *
 * Die drei hinteren Spalten stehen HINTEN und nicht in einer zweiten Protokolldatei
 * (Issue #948, E9): Jedes bestehende Protokoll bleibt lesbar, weil die vier vorderen
 * Spalten Stellung und Bedeutung behalten und eine aeltere Zeile die hinteren einfach
 * nicht traegt. Beim Lesen sind darum alle drei optional.
 *
 * Warum sie ueberhaupt gebraucht werden: Ein Abschlusslauf schreibt mehrere Zeilen.
 * Ohne die Laufkennung — fuer alle Zeilen EINES `run`-Aufrufs dieselbe — liesse sich
 * "je Lauf" nicht von "je Kommando" trennen, und der Nenner jeder Kennzahl je Karte
 * waere falsch. Die leere `karte` ist kein Nullwert, sondern "nicht gemessen": Eine
 * Zeile ohne Nummer geht in keine Rechnung je Karte ein.
 *
 * Dahinter stehen seit Issue #1004 (Plan #1001, E5) drei weitere Spalten, auf demselben
 * Weg und aus demselben Grund: `ausloeser`, `bereiche` und `dateien` — siehe
 * `ausloeserBestimmen`. Seit Issue #1071 (Plan #1066) folgt als elfte die Spalte
 * `gleichzeitig`: der Text `gleichzeitig`, wenn die Dauer neben anderen Pruefungen gemessen
 * wurde, sonst leer. Seit Issue #1396 (Plan #1395, E8) folgt als zwoelfte die Spalte
 * `wiederholung`: `erstlauf` an der Zeile des roten ersten Laufs einer wiederholten Pruefung,
 * `wiederholung` an der Zeile ihrer Wiederholung, sonst leer. Seit Issue #1980 (Plan #1969, E3)
 * folgt als dreizehnte die Spalte `teil`: die Teilzeile, wenn der Abschluss nur einen Teil der
 * Tests fuhr, sonst leer — die Config-Zeile in Spalte 2 bleibt. Eine Zeile hat damit dreizehn
 * Spalten, eine aeltere vier, sieben, zehn, elf oder zwoelf.
 *
 * Scheitert das Schreiben, bleibt es bei einem Hinweis auf stderr: Das Protokoll ist
 * Buchhaltung, keine Bedingung — dieselbe Haltung wie bei der Wegmarke in board.mjs.
 * Ausgang und Ausgabe von `run` bleiben davon unberuehrt; anders als die Zusammenfassung,
 * deren Ausfall `fail` ausloest, weil der Runner aus ihr seine Entscheidung liest.
 */
function ausfuehrungSchreiben(cmd, ergebnis, dauerMs, herkunft, ausloeser, { gleichzeitig = false, wiederholung = "", teil = "", jetzt = new Date() } = {}) {
  const pfad = join(wurzel(), ...AUSFUEHRUNGEN_DATEI.split("/"));
  const { anlass, lauf, karte } = herkunft;
  const hinten = [
    ausloeser.art, listeMaskieren(ausloeser.bereiche), listeMaskieren(ausloeser.dateien),
    gleichzeitig ? "gleichzeitig" : "", wiederholung, kommandoMaskieren(teil),
  ].join("\t");
  try {
    mkdirSync(dirname(pfad), { recursive: true });
    appendFileSync(
      pfad,
      `${jetzt.toISOString()}\t${kommandoMaskieren(cmd)}\t${ergebnis}\t${dauerMs}\t${anlass}\t${lauf}\t${karte}\t${hinten}\n`,
      "utf-8",
    );
  } catch (err) {
    aufStderr(`${t("nichtProtokolliert", { pfad, grund: err.message })}\n`);
  }
}

/**
 * Die Summe der gemessenen Dauern — `null`, wenn nichts gemessen wurde.
 *
 * Steht als eigene Funktion, seit die Zusammenfassung mehrfach im Lauf geschrieben
 * wird (Issue #857): Jede Fassung traegt den Stand, den sie bezeugt, und "nichts
 * gemessen" ist kein Nullbetrag — weder beim leeren Paket noch vor dem ersten
 * Kommando.
 */
function dauerGesamt(laufen) {
  const gemessen = laufen.filter((e) => e.dauerMs !== null);
  return gemessen.length > 0 ? gemessen.reduce((summe, e) => summe + e.dauerMs, 0) : null;
}

/**
 * Die wirksame Obergrenze: die Konstante, im Test herabgesetzt ueber die
 * Umgebungsvariable. Alles, was keine positive Zahl ist, faellt auf die Konstante
 * zurueck — dieselbe Haltung wie bei `sperrGrenzeMs`.
 */
function pruefdauerObergrenzeMs(env = umgebungsVariablen()) {
  const zahl = Number((env[OBERGRENZE_ENV] ?? "").trim());
  return Number.isFinite(zahl) && zahl > 0 ? zahl : PRUEFDAUER_OBERGRENZE_MS;
}

/** Eine positive Zahl aus der Umgebung, sonst `vorgabe` — wie bei `pruefdauerObergrenzeMs`. */
function positiveZahl(env, name, vorgabe) {
  const zahl = Number((env[name] ?? "").trim());
  return Number.isFinite(zahl) && zahl > 0 ? zahl : vorgabe;
}

/**
 * Die Abbruchgrenze einer Pruefung (Issue #1077): das Vielfache des Medians der
 * juengsten gruenen Laeufe desselben Kommandos, mindestens der Mindestwert; ohne gruene
 * Historie die Vorgabe, im Build-Dienst die laengere (Issue #1828), mindestens das
 * Vielfache der laengsten Dauer in `laufDauern` (Issue #1822). Rote Laeufe zaehlen nicht — ein abgebrochener Haenger steht
 * als rot im Protokoll und zoege den Median sonst selbst nach oben.
 *
 * `zeilen` sind Eintraege `{ cmd, ergebnis, dauerMs }`, wie `ausfuehrungenLesen` sie
 * liefert; `laufDauern` die Dauern der Pruefungen, die in diesem Lauf schon gruen endeten.
 * Ein Lauf mit dem Anlass `integration` misst nur an frueheren Integrationslaeufen (Issue
 * #1982, Plan #1969, E8): Er faehrt den vollen Umfang, ein Abschluss oft nur einen Teil.
 *
 * Bezugsgroesse ist die Dauer je Testdatei (Issue #2216): `anstehend` ist die Dateizahl des
 * anstehenden Laufs (`dateizahl`), und jede gruene Zeile geht mit `dauerMs / Dateizahl ×
 * anstehend` in den Median ein — die Dateizahl eines Teillaufs aus seiner Teilzeile, die eines
 * vollen aus dem aufgeloesten Ausdruck von `cmd`. Im Lauf 2026-11-04-142114 riss die Gruppe
 * `test/ablauf-night-*.test.mjs` sonst achtmal die Grenze kleiner Teillaeufe, ohne zu haengen.
 * Ohne bestimmbare Dateizahl — eine aeltere Zeile ohne Spalte `teil`, ein Kommando ohne
 * Dateiausdruck, `anstehend` null — geht die Dauer unveraendert ein. `dateien` ist die Liste,
 * gegen die gezaehlt wird, ohne Angabe die des Arbeitsbaums.
 * Exportiert, damit die Tests die Rechnung ohne Subprozess pruefen.
 */
export function haengeGrenzeMs(cmd, zeilen, env = umgebungsVariablen(), laufDauern = [], anlass = "", anstehend = null, dateien = null) {
  const mindest = positiveZahl(env, HAENGEN_MINDEST_ENV, HAENGEN_MINDEST_MS);
  const imBuildDienst = (env.CI ?? "").trim() !== "";
  const vorgabe = positiveZahl(env, HAENGEN_VORGABE_ENV, imBuildDienst ? HAENGEN_VORGABE_BUILDDIENST_MS : HAENGEN_VORGABE_MS);
  const dauern = zeilen
    .filter((z) => z.cmd === cmd && z.ergebnis === "gruen" && Number.isFinite(z.dauerMs))
    .filter((z) => anlass !== "integration" || z.anlass === "integration")
    .slice(-HAENGEN_HISTORIE)
    .map((z) => {
      if (anstehend === null || z.teil === undefined) return z.dauerMs;
      dateien ??= baumDateien();
      const gefahren = dateizahl(z.teil === "" ? ausdruckEinsetzen(z.cmd) : z.teil, dateien);
      return gefahren === null ? z.dauerMs : (z.dauerMs / gefahren) * anstehend;
    })
    .sort((a, b) => a - b);
  if (dauern.length === 0) return Math.max(vorgabe, HAENGEN_FAKTOR * Math.max(0, ...laufDauern));
  const mitte = Math.floor(dauern.length / 2);
  const median = dauern.length % 2 === 1 ? dauern[mitte] : (dauern[mitte - 1] + dauern[mitte]) / 2;
  return Math.max(mindest, HAENGEN_FAKTOR * median);
}

/** Die Frist zwischen SIGTERM und SIGKILL beim Abbruch (Issue #1077). */
function haengenFristMs(env = umgebungsVariablen()) {
  return positiveZahl(env, HAENGEN_FRIST_ENV, HAENGEN_FRIST_MS);
}

/**
 * Die Zeilen des Ausfuehrungsprotokolls als `{ cmd, ergebnis, dauerMs, anlass, teil }` (Issue
 * #1077, #1982, #2216); eine aeltere Zeile ohne die Spalte hat den leeren Anlass, eine ohne die
 * dreizehnte Spalte keinen `teil` (undefined, nicht leer: leer heisst „voller Lauf").
 * Kommando und Teilzeile werden entmaskiert — die Umkehrung von `kommandoMaskieren`, wie
 * `kommandoLesen` in kit/effectiveness.mjs. Fehlt die Datei oder ist sie unlesbar, gibt es
 * keine Historie: Dann gilt die Vorgabe, und `run` laeuft weiter.
 */
function ausfuehrungenLesen() {
  let text;
  try {
    text = readFileSync(join(wurzel(), ...AUSFUEHRUNGEN_DATEI.split("/")), "utf-8");
  } catch {
    return [];
  }
  return ausfuehrungenParsen(text);
}

/** Der Text des Ausfuehrungsprotokolls als Zeilen wie bei `ausfuehrungenLesen`; exportiert fuer die Tests. */
export function ausfuehrungenParsen(text) {
  const zurueck = { "\\": "\\", t: "\t", n: "\n", r: "\r" };
  const entmaskieren = (wert) => wert.replaceAll(/\\([\\tnr])/g, (_, z) => zurueck[z]);
  return text.split(/\r?\n/).filter(Boolean).map((zeile) => {
    const spalten = zeile.split("\t");
    const [, cmd = "", ergebnis = "", dauer = "", anlass = ""] = spalten;
    return {
      cmd: entmaskieren(cmd),
      ergebnis,
      dauerMs: Number(dauer),
      anlass,
      teil: spalten.length > 12 ? entmaskieren(spalten[12]) : undefined,
    };
  });
}

/**
 * Die wirksame Grenze gleichzeitiger Pruefungen (Issue #1071): die Vorgabe, ueber die
 * Umgebungsvariable uebersteuert. Alles, was keine positive ganze Zahl ist, faellt auf die
 * Vorgabe zurueck — dieselbe Haltung wie bei `pruefdauerObergrenzeMs`.
 */
function gleichzeitigGrenze(env = umgebungsVariablen()) {
  const text = (env[GLEICHZEITIG_ENV] ?? "").trim();
  const zahl = Number(text);
  return /^\d+$/.test(text) && zahl > 0 ? zahl : GLEICHZEITIG_VORGABE;
}

/** Sekunden mit hoechstens einer Nachkommastelle, ohne abschliessende Null. */
function sekunden(ms) {
  return String(Math.round(ms / 100) / 10);
}

/** Die Dauer einer Berichtszeile (Issue #1003). "Nicht gemessen" ist kein Nullbetrag. */
export function dauerText(dauerMs) {
  return typeof dauerMs === "number" ? `${sekunden(dauerMs)} s` : t("dauerNichtGemessen");
}

/**
 * Der Zusatz einer Berichtszeile, deren Pruefung die Obergrenze gerissen hat — sonst
 * der leere Text (Issue #1003, E3). Genau an der Grenze ist nichts ueberschritten.
 */
export function obergrenzeZusatz(dauerMs, grenzeMs = PRUEFDAUER_OBERGRENZE_MS) {
  if (typeof dauerMs !== "number" || dauerMs <= grenzeMs) return "";
  return t("obergrenze", { grenze: sekunden(grenzeMs), ueber: sekunden(dauerMs - grenzeMs) });
}

/** Der Vermerk einer abgebrochenen, haengenden Pruefung (Issue #1077). */
export function haengendText(grenzeMs) {
  return t("haengend", { grenze: sekunden(grenzeMs) });
}

/**
 * Die fertigen Zeilen fuer den Abschlussbericht (Issue #1003, Plan #1001, E1, E12).
 *
 * Das Kommando bildet sie selbst, damit die Skills sie WORTGETREU uebernehmen koennen:
 * Eine Zeile, die erst die Session aus Einzelfeldern zusammensetzt, verliert unter
 * Druck zuerst Dauer und Grund — genau das, was der Bericht bisher verlor.
 *
 * Ein nicht gestartetes Kommando (nach einem roten) steht als `gelaufen` mit seinem
 * Ergebnis: Es war ausgewaehlt, und ein Bericht, der es verschwiege, saehe aus wie
 * ein vollstaendiger Lauf. `uebernommen` haengt den Vermerk an die Dauer — sie ist die
 * des Ursprungslaufs und in diesem Aufruf nicht gemessen. Ein gleichzeitig gelaufenes
 * Kommando traegt `(neben anderen gemessen)` hinter der Dauer (Issue #1071): Seine Dauer
 * ist nicht die, die es allein braeuchte.
 */
function berichtszeilen(auswahl, laufen, { uebernommen = false, grenzeMs = PRUEFDAUER_OBERGRENZE_MS, frueher = [] } = {}) {
  const zeilen = auswahlZeilen(auswahl);
  const vermerk = uebernommen ? ` (${UEBERNAHME_MARKE})` : "";
  for (const e of laufen) {
    zeilen.push(...gelaufenZeilen(e, vermerk, grenzeMs));
    // Die Wackler derselben Karte aus frueheren Laeufen unter der Zeile ihrer Pruefung
    // (Issue #1397, E12).
    for (const w of frueher.filter((x) => x.cmd === e.cmd)) zeilen.push(frueherGewackeltZeile(w));
    // Der Zustand mit Grund als letzte Zeile der Pruefung (Issue #2089, #2079, Kriterium 1),
    // sobald der Lauf ihn kennt: erst in der letzten Fassung steht `ausgang` fest.
    if (e.ausgang) zeilen.push(t("berichtZustand", { cmd: e.cmd, zustand: zustandText(e.ausgang), grund: e.ausgangGrund }));
  }
  // Eine Pruefung, die in diesem Lauf nicht ausgewaehlt ist, verliert ihren Fall nicht.
  for (const w of frueher.filter((x) => !laufen.some((e) => e.cmd === x.cmd))) zeilen.push(frueherGewackeltZeile(w));
  for (const e of auswahl.ausgelassen) zeilen.push(t("berichtAusgelassen", { cmd: e.cmd, grund: e.grund }));
  return zeilen;
}

function frueherGewackeltZeile(w) {
  return t("gewackeltFrueher", { cmd: w.cmd, zeitpunkt: w.zeitpunkt });
}

/** Die Zeilen eines gelaufenen Kommandos: `gelaufen:`, darunter `Gewackelt:` und seine Hinweise. */
function gelaufenZeilen(e, vermerk, grenzeMs) {
  const dauerMs = typeof e.dauerMs === "number" ? e.dauerMs : null;
  const neben = e.gleichzeitig ? ` (${t("nebenMarke")})` : "";
  const haengt = e.haengend ? " — " + haengendText(e.haengend.grenzeMs) : "";
  // Am Ende der Zeile, weil das Ende einer gekappten Ausgabe stehen bleibt (Issue #1196).
  const ablage = e.protokoll ? t("ausgabe", { pfad: e.protokoll }) : "";
  // Rot auch bei der Wiederholung (Issue #1396, E12): Der Leser sieht, dass nicht ein
  // einzelner Ausreisser den Lauf rot gemacht hat.
  const ergebnis = e.wiederholt === true ? t("rotWiederholt") : e.ergebnis;
  const zeilen = [
    t("berichtGelaufen", { cmd: e.cmd, ergebnis, dauer: dauerText(dauerMs), zusatz: `${neben}${vermerk}`, grund: e.grund })
      + `${obergrenzeZusatz(dauerMs, grenzeMs)}${haengt}${ablage}`,
  ];
  // Der Wackler direkt unter seiner Zeile (Issue #1396, E12, E17).
  if (e.gewackelt) {
    const erstlauf = e.gewackelt.protokoll ? t("ausgabeErstlauf", { pfad: e.gewackelt.protokoll }) : "";
    zeilen.push(t("gewackelt", { cmd: e.cmd, erstlauf }));
  }
  // Der Teilaufruf beim Abschluss direkt unter seiner Zeile (Issue #1980, E14).
  if (e.tests) zeilen.push(t("berichtTeilweise", { cmd: e.cmd, n: e.tests.gefahren, m: e.tests.gesamt }));
  // Die Funde einer Hinweis-Pruefung direkt unter ihrer Zeile (Issue #1155, E11).
  for (const hinweis of e.hinweise ?? []) zeilen.push(t("berichtHinweis", { text: hinweis }));
  return zeilen;
}

/** Der Zustand eines `ausgang` im Bericht (Issue #2089): einer der vier aus `AUSGAENGE`. */
function zustandText(ausgang) {
  const schluessel = ["zustandBestanden", "zustandRot", "zustandOhneErgebnis", "zustandNichtGelaufen"];
  const i = AUSGAENGE.indexOf(ausgang);
  return i < 0 ? ausgang : t(schluessel[i]);
}

/** Die Zeilen, die die Auswahl erklaeren — sie stehen vor den Kommandos. */
function auswahlZeilen(auswahl) {
  const zeilen = auswahl.leeresPaket ? [t("keinePruefung")] : [];
  // Die Ableitung aus den Importen je Datei (Issue #1181): Sie erklaert die Auswahl darunter.
  for (const a of auswahl.abgeleitet ?? []) zeilen.push(ableitungsZeile(a));
  // Die Bereiche, die ein Import mitberuehrt, mit ihrem Weg (Issue #1208).
  for (const a of auswahl.abhaengig ?? []) zeilen.push(abhaengigZeile(a));
  // Kommandos, die jedem Bereich zugeordnet sind (Issue #1214, E13).
  for (const hinweis of auswahl.zuschnitt ?? []) zeilen.push(t("berichtHinweis", { text: hinweis }));
  zeilen.push(...teilZeilen(auswahl));
  return zeilen;
}

/** Ein Dateiname aus dem Kommando: Kleinbuchstaben und Ziffern, alles andere ein Strich. */
function kurzname(cmd) {
  let name = cmd.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join("-").slice(0, 40);
  while (name.endsWith("-")) name = name.slice(0, -1);
  return name || "kommando";
}

/**
 * Leert den Ordner der Ausgaben vor einem echten Lauf (Issue #1196). Geloescht werden die
 * Dateien darin, nicht der Ordner selbst. Scheitert das, bleibt es bei einem Hinweis: Die
 * Ablage ist eine Auskunft fuer den Menschen, keine Bedingung des Laufs.
 */
function protokolleLeeren() {
  const ordner = join(wurzel(), ...PROTOKOLL_ORDNER.split("/"));
  try {
    for (const name of readdirSync(ordner)) unlinkSync(join(ordner, name));
  } catch (err) {
    if (err.code !== "ENOENT") aufStderr(`${t("protokolleNichtGeleert", { ordner: PROTOKOLL_ORDNER, grund: err.message })}\n`);
  }
}

/**
 * Legt die Ausgabe eines nicht gruenen Kommandos ab und gibt den Pfad relativ zum Projekt
 * zurueck, oder `null`, wenn das Schreiben scheitert — dann mit einem Hinweis auf stderr,
 * wie beim Ausfuehrungsprotokoll. `nummer` ist die Stelle in der Auswahl, damit die
 * Dateien in Config-Reihenfolge stehen. `zusatz` haengt am Namen — `-erstlauf` fuer den
 * roten ersten Lauf einer wiederholten Pruefung (Issue #1396, E17).
 */
function protokollAblegen(nummer, cmd, ausgabe, zusatz = "") {
  const relativ = `${PROTOKOLL_ORDNER}/${String(nummer).padStart(2, "0")}-${kurzname(cmd)}${zusatz}.log`;
  const pfad = join(wurzel(), ...relativ.split("/"));
  try {
    mkdirSync(dirname(pfad), { recursive: true });
    writeFileSync(pfad, ausgabe, "utf-8");
    return relativ;
  } catch (err) {
    aufStderr(`${t("ausgabeNichtAbgelegt", { pfad: relativ, grund: err.message })}\n`);
    return null;
  }
}

/**
 * Die Zeile, die den Block `Fuer den Abschlussbericht:` eroeffnet (Issue #1069, Plan
 * #1066, A7, E4): die Wartezeit dieses Laufs und, mit Kartennummer, die Summe aller
 * Laeufe der Karte. Sie steht nur im Block und nicht in `berichtszeilen` — das Feld
 * bleibt, was es war, die Zeilen je Pruefung.
 */
export function wartezeitZeile(wartezeitMs, wartezeitKarte) {
  const lauf = t("wartezeit", { dauer: dauerText(wartezeitMs) });
  if (!wartezeitKarte) return lauf;
  const { karte, summeMs, laeufe } = wartezeitKarte;
  return t("wartezeitKarte", { lauf, summe: dauerText(summeMs), laeufe, karte });
}

function berichtsblockSchreiben(zeilen, wartezeit) {
  aufStdout(["", t("berichtKopf"), wartezeit, ...zeilen, ""].join("\n"));
}

/**
 * Die Summe der Wartezeit je Karte nach diesem Lauf (Issue #1069, Plan #1066, E4) —
 * oder `undefined` ohne Kartennummer, dann fehlt das Feld.
 *
 * Traegt die vorige Zusammenfassung dieselbe Karte, wird weitergezaehlt, sonst beginnt
 * die Summe neu. `zuschlagMs` ist die Wartezeit dieses Laufs, bei einem uebernommenen
 * 0: Er zaehlt als Lauf, aber seine Zeit ist keine Pruefzeit. Im automatischen Lauf beginnt die Summe
 * mit jeder Session neu, weil der Runner die Zusammenfassung vor jeder Runde verwirft.
 */
function wartezeitKarteNach(vorige, karte, zuschlagMs) {
  if (karte === undefined) return undefined;
  const alt = vorige?.wartezeitKarte;
  const weiter = alt && alt.karte === karte && Number.isFinite(alt.summeMs) && Number.isInteger(alt.laeufe);
  return weiter
    ? { karte, summeMs: alt.summeMs + zuschlagMs, laeufe: alt.laeufe + 1 }
    : { karte, summeMs: zuschlagMs, laeufe: 1 };
}

/**
 * Die Wackler der Karte bis vorher (Issue #1397, Plan #1395, E11) — die Faelle aus der
 * vorigen Zusammenfassung, die dieselbe Karte tragen, oder `undefined` ohne Kartennummer:
 * Ein Lauf vor `push main` oder `merge production` erbt nie die Liste einer Karte, und
 * das Feld fehlt. Nach dem Muster von `wartezeitKarteNach`; bei anderer Karte leer.
 */
function gewackeltKarteVorher(vorige, karte) {
  if (karte === undefined) return undefined;
  const alt = Array.isArray(vorige?.gewackeltKarte) ? vorige.gewackeltKarte : [];
  return alt.filter((w) => w?.karte === karte && typeof w.cmd === "string");
}

/**
 * Die Wackler der Karte nach diesem Lauf: die von vorher und dahinter je gewackelter
 * Pruefung dieses Laufs ein Fall `{ cmd, zeitpunkt, karte }`. `undefined` ohne Kartennummer.
 */
function gewackeltKarteNach(vorher, karte, laufen, zeitpunkt) {
  if (vorher === undefined) return undefined;
  const neu = [];
  for (const e of laufen) {
    if (e?.gewackelt && !neu.some((w) => w.cmd === e.cmd)) neu.push({ cmd: e.cmd, zeitpunkt, karte });
  }
  return [...vorher, ...neu];
}

/**
 * Die vorige Zusammenfassung, wie sie liegt, oder `null` — anders als
 * `frueheresErgebnis` ohne Bedingung an den Stand: Die Summe je Karte laeuft ueber
 * geaenderte Staende hinweg weiter.
 */
function vorigeZusammenfassung() {
  try {
    const alt = JSON.parse(readFileSync(zusammenfassungPfad(), "utf-8"));
    return alt !== null && typeof alt === "object" ? alt : null;
  } catch {
    return null;
  }
}

/** Die Wanduhr seit `startNs` in ganzen Millisekunden. */
function msSeit(startNs) {
  return Math.round(Number(process.hrtime.bigint() - startNs) / 1e6);
}

function schreibeZusammenfassung(daten) {
  const pfad = zusammenfassungPfad();
  try {
    mkdirSync(dirname(pfad), { recursive: true });
    writeFileSync(pfad, JSON.stringify(daten, null, 2) + "\n", "utf-8");
  } catch (err) {
    // Die Datei ist die Datenquelle des Runners; ihr Ausfall darf nicht
    // stillschweigend durchgehen, auch nicht bei gruenen Checks.
    fail(t("zusammenfassungNichtGeschrieben", { pfad, grund: err.message }));
  }
  return pfad;
}

/**
 * Der Fingerabdruck der Pruefkonfiguration (Issue #863).
 *
 * Er steht in der Zusammenfassung, weil sich ohne ihn die Gleichheit der Config
 * nicht feststellen laesst: Eine Config aendert nicht zwangslaeufig den
 * Arbeitsbaum — im Kit-Repo ist sie versioniert, in anderen Projekten liegt sie
 * hinter der Ignore-Regel und erschiene dann in `geaendert` gar nicht. Ein
 * uebernommenes Ergebnis bezoege sich dort auf eine Auswahl, die es nicht mehr
 * gibt.
 *
 * Gehasht werden die NORMALISIERTEN Eintraege, die Bereiche und die pruefungsfreien
 * Muster (Issue #934), also genau das, woraus die Auswahl entsteht. Ueber die normalisierte Form, damit der Wechsel
 * von der String-Form zu `{ cmd }` — der nichts bedeutet — keinen Lauf erzwingt.
 * Alles uebrige in der Config (Trigger, Modelle, Pfade) bleibt draussen: Es
 * aendert an den Pruefungen nichts.
 */
function configFingerabdruck() {
  const config = ladeConfig();
  const inhalt = JSON.stringify({
    buildChecks: (config.buildChecks ?? []).map((c) => normalisiere(c)),
    checkAreas: config.checkAreas ?? {},
    ohnePruefung: config.ohnePruefung ?? [],
    // Marke und Strenge entscheiden, ob der Mutationstest anhaelt (Issue #2108): Ein gruenes
    // Ergebnis gilt nach einer angehobenen Marke nicht mehr. Nur wenn gesetzt — so bleibt der
    // Fingerabdruck jeder Config ohne diese Felder unveraendert.
    ...(config.mutationGuete !== undefined ? { mutationGuete: config.mutationGuete } : {}),
    ...(config.strenge !== undefined ? { strenge: config.strenge } : {}),
    ...(config.strengeUebersteuerung !== undefined ? { strengeUebersteuerung: config.strengeUebersteuerung } : {}),
  });
  return createHash("sha256").update(inhalt).digest("hex");
}

function listenGleich(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((wert, i) => wert === b[i]);
}

// Exportiert fuer das Notfall-Gate in board/schutz.mjs (Plan #1405, E9): Wann ein Stand
// derselbe ist, legt nur diese Stelle fest.
export function hashesGleich(a, b) {
  if (a === null || typeof a !== "object" || b === null || typeof b !== "object") return false;
  const alt = Object.keys(a);
  const neu = Object.keys(b);
  return alt.length === neu.length && neu.every((pfad) => Object.hasOwn(a, pfad) && a[pfad] === b[pfad]);
}

/**
 * Die Zusammenfassung des letzten Laufs (`alt`, aus `vorigeZusammenfassung`), WENN sie
 * denselben Stand bezeugt wie der jetzige — sonst `null` (Issue #863).
 *
 * Derselbe Stand heisst: derselbe Anker, dieselbe Stufe, dieselbe Dateiliste mit
 * denselben Blob-Hashes und dieselbe Config. Die Liste steht neben den Hashes,
 * obwohl deren Schluessel sie wiederholen — eine Datei, die ohne Aenderung aus
 * `geaendert` verschwindet, gibt es nicht, und ein Vergleich, der sich auf diese
 * Ableitung verlaesst, muesste sie bei jeder kuenftigen Aenderung an
 * `geaenderteDateien` neu belegen.
 *
 * Bewusst KEIN Zeitfenster („juenger als n Minuten"): Nur der Inhalt macht ein
 * Ergebnis gueltig, nicht die Uhr. Und bewusst nur eine ABGESCHLOSSENE
 * Zusammenfassung — die eines abgebrochenen Laufs bezeugt keinen fertigen Stand,
 * sie ist gerade der Nachweis, dass eine Pruefung ihr Ende nicht erreicht hat.
 *
 * Und bewusst nur ein GRUENES Ergebnis (Issue #1742): Jeder Eintrag in `laufen` muss
 * `gruen` sein — Ausgelassenes steht nicht in `laufen`, ein `nicht gestartet` zaehlt
 * nicht als gruen. Die Uebernahme sieht nur versionierte Dateien und die Config; ein
 * Rot, dessen Ursache ausserhalb liegt (installierte Kopie, Abhaengigkeiten,
 * Umgebung), bliebe sonst stehen, bis jemand `--fresh` kennt. Ein Rot zu uebernehmen
 * spart ohnehin nichts: Nach einer Korrektur will man gerade neu messen.
 *
 * Jeder Zweifel faellt auf `null` zurueck und damit in den vollen Weg: fehlende
 * Datei, kaputtes JSON, fehlendes Feld, ein Stand aus einer aelteren Fassung ohne
 * `configHash`. Das ist dieselbe Richtung, in die dieses Kommando ueberall irrt —
 * lieber einmal zu viel pruefen.
 */
function frueheresErgebnis(alt, auswahl, hashes, configHash) {
  if (!gleicheAuswahlBasis(alt, auswahl, configHash)) return null;
  if (!alt.laufen.every((e) => e?.ergebnis === "gruen")) return null;
  // Ein haltender Mutationstest, der anhielt, ist ein rotes Ergebnis (Issue #2108).
  if (mutationHaeltAn(alt.mutation)) return null;
  if (!listenGleich(alt.geaendert, auswahl.geaendert)) return null;
  if (!hashesGleich(alt.hashes, hashes)) return null;
  return alt;
}

/**
 * Was ein frueherer Lauf mit dem jetzigen gemeinsam haben muss, damit sein Ergebnis etwas
 * ueber diesen sagt — alles ausser der Dateiliste und den Hashes. Geteilt von
 * `frueheresErgebnis` (derselbe Stand) und `zuletztRote` (dieselbe Auswahl, anderer
 * Stand, Issue #1072).
 */
function gleicheAuswahlBasis(alt, auswahl, configHash) {
  if (alt === null || typeof alt !== "object") return false;
  if (alt.abgeschlossen !== true || !Array.isArray(alt.laufen)) return false;
  if (alt.basis !== auswahl.basis || alt.stufe !== auswahl.stufe) return false;
  // Die Eingrenzung gehoert in den Vergleich (Issue #922, Code-Review): Ohne sie
  // uebernimmt ein uneingeschraenkter Lauf das Ergebnis eines vorangegangenen
  // `--area`-Laufs, weil Basis, Stufe, Dateien und Hashes identisch sind — die
  // faelligen Pruefungen der uebrigen Bereiche liefen dann nie. `?? null` liest eine
  // Zusammenfassung aus einer Fassung vor diesem Feld als uneingeschraenkt.
  if ((alt.bereichWahl ?? null) !== (auswahl.bereichWahl ?? null)) return false;
  // Aus demselben Grund die Abschlussmarke (Issue #946): Ein Abschlusslauf faehrt eine
  // kleinere Auswahl, bei gleicher Basis, gleicher Stufe, gleichen Dateien und gleichen
  // Hashes. Ohne diesen Vergleich uebernaehme er die Kommandoliste des vollen Laufs — und
  // umgekehrt liesse der volle Lauf die verschobenen Pruefungen fuer immer aus. `?? false`
  // liest eine Zusammenfassung aus einer Fassung vor diesem Feld als vollen Lauf.
  if ((alt.abschluss ?? false) !== (auswahl.abschluss ?? false)) return false;
  // Ebenso der Integrationslauf (Issue #1982): Er traegt intern die Stufe `push`, laesst deren
  // Pruefungen aber aus — ein Push-Lauf duerfte sein Ergebnis nie uebernehmen.
  if (Boolean(alt.integration) !== Boolean(auswahl.integration)) return false;
  // Ebenso der Hotfix (Issue #2051): Er laesst die verschobenen Pruefungen aus, und ein
  // gewoehnlicher Push-Lauf duerfte sein Ergebnis nie uebernehmen — und umgekehrt.
  if (Boolean(alt.hotfix) !== Boolean(auswahl.hotfix)) return false;
  // Ebenso der Teil (Issue #2188): Jeder Teil faehrt andere Pruefungen, und der ganze Lauf alle.
  if (teilText(alt.teil) !== teilText(auswahl.teil)) return false;
  // Ebenso das Nachholen (Issue #2107): Es faehrt mehr als ein Push-Lauf in Leicht, bei gleichem
  // Stand und gleicher Config.
  if ((alt.nachholen?.anlass ?? null) !== (auswahl.nachholen?.anlass ?? null)) return false;
  // Ebenso der lokale Beleg (Issue #2249): Er faehrt eine andere Auswahl als die Stufe merge.
  if ((alt.releaseOnly?.stufe ?? null) !== (auswahl.releaseOnly?.stufe ?? null)) return false;
  if (typeof alt.configHash !== "string" || alt.configHash !== configHash) return false;
  return typeof alt.zeitpunkt === "string";
}

/**
 * Die zuletzt roten Kommandos, WENN der vorige Lauf dieselbe Auswahl bei geaendertem
 * Stand bezeugt — sonst `null` (Issue #1072, Plan #1066, A3).
 *
 * Dieselbe Auswahl heisst: dieselben Vergleiche wie beim Uebernehmen ausser Dateiliste und
 * Hashes, dazu dieselben ausgewaehlten Kommandos in derselben Reihenfolge. Dann liegt
 * zwischen beiden Laeufen eine Korrektur, und es lohnt, zuerst nur die roten zu fahren —
 * der volle Lauf folgt ohnehin, sobald sie gruen sind. Aendert sich die Auswahl, sagt das
 * alte Rot nichts mehr ueber die neue, und es laeuft sofort alles.
 *
 * Bei unveraendertem Stand greift `frueheresErgebnis`, bei einem gruenen Vorlauf gibt es
 * nichts zuerst zu fahren. Ein `nicht gestartet` zaehlt nicht als rot: Es wurde nie
 * gemessen und laeuft im vollen Lauf mit.
 */
function zuletztRote(alt, auswahl, hashes, configHash) {
  if (!gleicheAuswahlBasis(alt, auswahl, configHash)) return null;
  if (!listenGleich(alt.laufen.map((e) => e?.cmd), auswahl.laufen.map((e) => e.cmd))) return null;
  if (listenGleich(alt.geaendert, auswahl.geaendert) && hashesGleich(alt.hashes, hashes)) return null;
  const rote = alt.laufen.filter((e) => e?.ergebnis === "rot").map((e) => e.cmd);
  return rote.length > 0 ? rote : null;
}

/**
 * Das Kommando, das ein Lauf als rot nennt (Issue #1072): das erste `rot`, erst ohne ein
 * solches das erste ungruene. Nach einem roten Teillauf stehen vor der roten Gruppe
 * nicht gestartete — die zu nennen, schickte den Leser zur falschen Pruefung.
 */
// SYNC: dieselbe Regel steht in .githooks/gate.mjs und in `lesePruefung` (kit/night.mjs);
// beide laden checks.mjs nicht als Bibliothek. Der Abgleich ist test/checks-rote-zuerst.test.mjs.
function rotesKommando(laufen) {
  return laufen.find((e) => e.ergebnis === "rot") ?? laufen.find((e) => e.ergebnis !== "gruen") ?? null;
}

/**
 * Der Satzteil, an dem eine Uebernahme in der Ausgabe erkennbar ist (Issue #926).
 *
 * Er steht als Konstante, weil ihn ein zweiter Leser braucht: Der Prueflauf-Zaehler des
 * Runners sieht vom Abschlussversuch nur den Bash-Aufruf und seine Ausgabe, und ein
 * uebernommener Lauf soll dort als Versuch OHNE Dauer zaehlen — `uebernehmen` reicht die
 * Werte des frueheren Laufs weiter, eine Spanne waere geerbt und nicht gemessen.
 */
// SYNC: dieselbe Marke steht in kit/night.mjs als UEBERNAHME_MARKE; der Abgleich ist ein
// Test in test/ablauf-night-prueflaeufe.test.mjs. Ein Import waere die bessere Kopplung, aber
// night.mjs laeuft in Projekten, die checks.mjs nicht mitinstalliert haben muessen.
export const UEBERNAHME_MARKE = "Ergebnis uebernommen";

/**
 * Schreibt das uebernommene Ergebnis als frischen Nachweis und gibt den Exit-Code
 * des Originals zurueck (Issue #863).
 *
 * Die Datei entsteht NEU, obwohl sie inhaltlich gleich bliebe: Das Commit-Gate
 * verlangt einen Nachweis fuer genau den Stand, der committet wird, und eine
 * liegengebliebene Datei waere kein Nachweis dieses Aufrufs. `uebernommen` traegt
 * dabei den Zeitpunkt des ECHTEN Laufs und wird ueber mehrere Uebernahmen hinweg
 * weitergereicht — er sagt, wann zuletzt wirklich geprueft wurde, und genau das
 * will lesen, wer der Datei misstraut.
 *
 * Rot wird ebenso uebernommen wie gruen: Derselbe Stand liefert dasselbe Rot, und
 * ein erneuter Lauf kostete dieselben Minuten fuer dieselbe Antwort. Ungruen zaehlt
 * dabei wie ueberall hier alles, was nicht `gruen` ist — auch ein `nicht
 * gestartet` nach rotem Abbruch.
 */
function uebernehmen(auswahl, frueher, { zeitpunkt, hashes, configHash, startNs, vorige, karte }) {
  const ungruen = rotesKommando(frueher.laufen);
  const original = typeof frueher.uebernommen === "string" ? frueher.uebernommen : frueher.zeitpunkt;
  // Die Zeilen tragen die Dauer des URSPRUNGSLAUFS aus der frueheren Zusammenfassung
  // (Issue #1003, E12): Auch ein uebernommener Lauf gehoert in den Bericht, und ohne
  // Block muesste die Session ihn aus Einzelfeldern nachbauen.
  // Die Wackler der Karte gehen unveraendert weiter (Issue #1397, E11): Eine Uebernahme
  // faehrt nichts. Die Faelle des uebernommenen Laufs stehen schon an seinen Eintraegen.
  const gewackeltKarte = gewackeltKarteVorher(vorige, karte);
  const formatFix = frueher.formatFix && typeof frueher.formatFix === "object" ? frueher.formatFix : null;
  // Der Mutationstest gehoert zum gemessenen Stand (Issue #1673): uebernommen, nicht neu gefahren.
  const mutation = mutationFeld(frueher);
  const zeilen = [
    ...(frueher.teillauf === true ? [t("teillauf")] : []),
    ...formatFixZeilen(formatFix),
    ...berichtszeilen(auswahl, frueher.laufen, {
      uebernommen: true, grenzeMs: pruefdauerObergrenzeMs(),
      frueher: (gewackeltKarte ?? []).filter((w) => w.zeitpunkt !== original),
    }),
    ...mutationZeilen(mutation, mutationEntfaellt(auswahl, ungruen !== null)),
    ...strengeLueckeZeilen(auswahl),
  ];
  // Ein uebernommener Lauf zaehlt als Lauf ohne Zeit (Issue #1069): Seine Wanduhr steht
  // in `wartezeitMs`, in die Summe der Karte geht sie nicht ein.
  const wartezeitMs = msSeit(startNs);
  const wartezeitKarte = wartezeitKarteNach(vorige, karte, 0);
  const pfad = schreibeZusammenfassung({
    ...auswahl,
    laufen: frueher.laufen,
    zeitpunkt,
    hashes,
    configHash,
    abgeschlossen: true,
    dauerGesamtMs: frueher.dauerGesamtMs ?? null,
    ...(frueher.guete ? { guete: frueher.guete } : {}),
    // Die Verursacher werden mitgereicht wie die Guete (Issue #947): Derselbe Stand hat
    // dieselben Karten hinter sich, und ein uebernommener roter Lauf ohne das Feld sahe
    // aus, als waere die Frage nie gestellt worden.
    ...(frueher.verursacher ? { verursacher: frueher.verursacher } : {}),
    // Ein uebernommener roter Teillauf bleibt ein Teillauf (Issue #1072): Die nicht
    // gestarteten Eintraege darin sind nie gemessen worden.
    ...(frueher.teillauf === true ? { teillauf: true } : {}),
    // Das Nachformatieren gehoert zum uebernommenen Lauf (Issue #1672): Seine Aenderungen
    // liegen noch im Baum und gehoeren weiter in den Commit.
    ...(formatFix ? { formatFix } : {}),
    // `undefined` faellt beim Schreiben weg: ohne Mutationstest kein Feld.
    mutation,
    uebernommen: original,
    hinweise: hinweiseVon(frueher.laufen),
    berichtszeilen: zeilen,
    wartezeitMs,
    ...(wartezeitKarte ? { wartezeitKarte } : {}),
    // Eine Uebernahme faehrt nichts und zaehlt darum nicht (Issue #1388, E3): unveraendert weiter.
    ...(vorige?.festgefahren ? { festgefahren: vorige.festgefahren } : {}),
    ...(gewackeltKarte ? { gewackeltKarte } : {}),
    // Der Abgleich gehoert zum gemessenen Stand (Issue #1719): weitergetragen, nicht neu erhoben.
    ...(frueher.bereichsabgleich ? { bereichsabgleich: frueher.bereichsabgleich } : {}),
  });
  const befund = ungruen === null ? "gruen" : `rot: ${ungruen.cmd}`;
  aufStdout(`${t("standUnveraendert", { zeitpunkt: original, marke: UEBERNAHME_MARKE, befund })}\n`);
  bereichsabgleichMelden(frueher.bereichsabgleich);
  berichtsblockSchreiben(zeilen, wartezeitZeile(wartezeitMs, wartezeitKarte));
  aufStdout(`\n${t("zusammenfassung", { pfad })}\n`);
  return ungruen === null ? 0 : 1;
}

/**
 * Das Urteil ueber ein gelaufenes Kommando — aus drei Quellen, in dieser
 * Reihenfolge: Rueckgabewert, Fehlermerkmal in der Ausgabe (Issue #858) und, wo
 * das Projekt eine Messung benannt hat, die Guete. Die Zeilen, die zum Befund
 * gehoeren, schreibt die Funktion selbst — ueber `schreibe`, damit ein gleichzeitig
 * gelaufenes Kommando sie in seinen Block sammeln kann (Issue #1071).
 *
 * Die MERKMAL-PRUEFUNG steht VOR dem guete-Zweig (Plan #810, E4): Eine Ausgabe,
 * die ihr Scheitern selbst ausweist, ist kein Messstand — ein darin gefundener
 * Anteil bescheinigte eine Messung, die es nicht gab. Das Ergebnis bleibt `rot`,
 * es gibt keinen dritten Ergebniswert (E5): Gate und Runner lesen
 * `ergebnis !== "gruen"`, und ein neuer Wert brauchte an jeder dieser Stellen
 * eine zweite Bahn. Auch die HINWEIS-ART (Issue #1155, Plan #1150, E11, E12) hat
 * keinen eigenen Wert: Ein Eintrag mit `art: "hinweis"` bekommt keines der drei
 * Urteile, er ist immer bestanden — mit Fund, ohne Fund und beim Absturz. Seine
 * Funde traegt er in `hinweise`, nicht im Ergebnis (siehe `hinweisBewerten`).
 *
 * Eigene Funktion und nicht in der Schleife von `ausfuehren`, damit die Schleife
 * ihren Ablauf zeigt (ausfuehren, bewerten, festhalten) und nicht drei Urteile in
 * einer Verzweigungskette traegt.
 */
function bewerten(eintrag, gruen, ausgabe, schreibe = (text) => aufStdout(text), code = null) {
  if (eintrag.art === "hinweis") return hinweisBewerten(eintrag, ausgabe, code, schreibe);
  const merkmal = fehlermerkmal(ausgabe);
  if (merkmal !== null) {
    eintrag.fehlermerkmal = merkmal;
    schreibe(`${t("merkmalRot", { merkmal })}\n`);
  }
  const bestanden = gruen && merkmal === null;
  if (!eintrag.guete) return { bestanden, guete: null };

  // Die Guetemessung faerbt ihr eigenes Kommando: Ein Anteil unter der Marke oder
  // ein nicht auswertbares Ergebnis ist derselbe rote Lauf wie jeder rote
  // Pflichtcheck — kein eigener Stop-Punkt (Issue #763).
  const grund = merkmal === null
    ? t("gueteKommandoRot")
    : t("gueteMerkmal", { merkmal });
  const guete = gueteErgebnis(eintrag, bestanden, ausgabe, grund);
  schreibe(`${gueteZeile(guete)}\n`);
  return { bestanden: bestanden && guete.erfuellt, guete };
}

/**
 * Die Funde einer Hinweis-Pruefung (Issue #1155, Plan #1150, E11): jede Ausgabezeile
 * `Hinweis: <text>` als `<text>` in `eintrag.hinweise`. Ein Rueckgabewert ab
 * `HINWEIS_ABSTURZ_AB` oder ein Ende ohne Rueckgabewert (Signal, Haenger) ist ein
 * Absturz und steht als genau eine Zeile `Hinweis-Pruefung gescheitert` mit dem
 * Kommando dabei — gemeldet, nicht gewertet: Der Befund haelt weder Fertigmeldung noch
 * Veroeffentlichung an (E12). Exit 1 ist bei Pruefwerkzeugen der Fund selbst.
 */
function hinweisBewerten(eintrag, ausgabe, code, schreibe) {
  eintrag.hinweise = ausgabe
    .split("\n")
    .map((zeile) => HINWEIS_ZEILE.exec(zeile.replace(/\r$/, "")))
    .filter((treffer) => treffer !== null)
    .map((treffer) => treffer[1]);
  if (code === null || code >= HINWEIS_ABSTURZ_AB) {
    const wie = code === null ? t("ohneRueckgabewert") : `Exit ${code}`;
    const zeile = t("hinweisGescheitert", { cmd: eintrag.cmd, wie });
    eintrag.hinweise.push(zeile);
    schreibe(`${zeile}\n`);
  }
  return { bestanden: true, guete: null };
}

/** Die Hinweise eines Laufs je Kommando fuer die Zusammenfassung (Issue #1155). */
function hinweiseVon(laufen) {
  return laufen
    .filter((e) => Array.isArray(e.hinweise) && e.hinweise.length > 0)
    .map((e) => ({ cmd: e.cmd, zeilen: e.hinweise }));
}

// --- Verursachersuche (Issue #947) -----------------------------------------

/**
 * Trennzeichen fuer die Ausgabe von `git log`. Zwei Steuerzeichen und kein Text:
 * Betreff und Rumpf einer Commit-Botschaft sind frei geschriebene Prosa, und jedes
 * druckbare Trennzeichen kaeme darin irgendwann selbst vor. Der Rumpf traegt eigene
 * Zeilenumbrueche — deshalb braucht es neben dem Feldtrenner einen Satztrenner.
 */
const LOG_FELD = "\x1f";
const LOG_SATZ = "\x1e";

/** Der Grund eines gescheiterten git-Aufrufs; ein stummes Scheitern nennt seinen Rueckgabewert. */
function gitGrund(res) {
  const text = (res.stderr || "").trim();
  return text !== "" ? text : t("rueckgabewert", { status: res.status });
}

/**
 * Die Kartennummer einer Commit-Botschaft oder `null` (Plan #944, E6).
 *
 * Zwei Muster, in dieser Reihenfolge: `(Issue #<n>)` im Betreff, wie der
 * implement-Skill ihn schreibt, und ergaenzend `Refs #<n>` im Rumpf. Der Betreff
 * gewinnt — er ist die Zeile, die den Commit benennt, waehrend ein `Refs` im Rumpf
 * auch auf ein Nachbar-Issue zeigen kann.
 *
 * Bewusst KEIN Blick aufs Board (E6): `checks.mjs` laeuft im Commit-Gate und in jeder
 * Session und kommt ohne Board und ohne Netz aus. Der Preis ist der Commit ohne
 * erkennbare Nummer — und der verschwindet nicht, sondern erscheint mit seiner Kurz-SHA.
 */
export function kartennummerAusBotschaft(betreff, rumpf) {
  const imBetreff = /\(Issue #(\d+)\)/.exec(betreff);
  if (imBetreff !== null) return imBetreff[1];
  const imRumpf = /(?:^|\s)Refs #(\d+)/.exec(rumpf);
  return imRumpf === null ? null : imRumpf[1];
}

/** Die Commits des Fensters `<basis>..HEAD`, juengster zuerst — oder ein Grund, warum nicht. */
function commitsSeit(basis, cwd) {
  const res = gitIn(cwd, "log", `--format=%h${LOG_FELD}%s${LOG_FELD}%b${LOG_SATZ}`, `${basis}..HEAD`);
  if (res.status !== 0) return { fehler: t("gitLogGescheitert", { basis, grund: gitGrund(res) }) };
  const commits = [];
  for (const satz of res.stdout.split(LOG_SATZ)) {
    if (satz.trim() === "") continue;
    const [sha, betreff, rumpf = ""] = satz.replace(/^\n+/, "").split(LOG_FELD);
    commits.push({ sha, karte: kartennummerAusBotschaft(betreff, rumpf) });
  }
  return { commits };
}

/**
 * Die Dateien eines Commits. `-z` statt der zitierten Vorgabeform, damit ein Pfad mit
 * Umlaut oder Leerzeichen roh ankommt und sein Muster findet.
 *
 * Ein Merge-Commit listet hier nichts (der Diff haette zwei Eltern) und beruehrt damit
 * keinen Bereich. Das ist hingenommen: Ein Merge traegt keine Kartennummer, und die
 * Aenderungen, die er zusammenfuehrt, stehen als eigene Commits im Fenster.
 */
function dateienDesCommits(sha, cwd) {
  const res = gitIn(cwd, "show", "--name-only", "--format=", "-z", sha);
  if (res.status !== 0) return { fehler: t("gitShowGescheitert", { sha, grund: gitGrund(res) }) };
  const dateien = res.stdout
    .split("\0")
    .filter((pfad) => pfad !== "")
    .map((pfad) => pfad.replaceAll("\\", "/"));
  return { dateien };
}

/**
 * Fasst die Commits des Fensters zu Karten zusammen: eine Gruppe je Kartennummer, und
 * ein Commit ohne Nummer bildet seine eigene. Die Reihenfolge ist die von `git log` —
 * juengster zuerst, weil der letzte Stand der naechstliegende Verdacht ist.
 *
 * `cwd` waehlt das Repository, Vorgabe ist die Projektwurzel. Die Auswertung der
 * Sicherheitspruefung (kit/board/sicherheit.mjs, Issue #1992) ruft sie im Worktree der
 * Veroeffentlichung, dessen Commits seit dem Anker die Verursacher nennen.
 */
export function kartenGruppen(basis, { cwd } = {}) {
  const log = commitsSeit(basis, cwd);
  if (log.fehler !== undefined) return { fehler: log.fehler };
  const gruppen = [];
  const nachKarte = new Map();
  for (const { sha, karte } of log.commits) {
    let gruppe = karte === null ? undefined : nachKarte.get(karte);
    if (gruppe === undefined) {
      gruppe = { karte, shas: [], dateien: new Set() };
      gruppen.push(gruppe);
      if (karte !== null) nachKarte.set(karte, gruppe);
    }
    gruppe.shas.push(sha);
    const stand = dateienDesCommits(sha, cwd);
    if (stand.fehler !== undefined) return { fehler: stand.fehler };
    for (const pfad of stand.dateien) gruppe.dateien.add(pfad);
  }
  return { gruppen };
}

/**
 * Ob eine Karte als Verursacherin der roten Pruefung gilt (Plan #944, E7).
 *
 * Grosszuegig, in derselben Richtung wie der Prueflauf selbst: Eine Pruefung ohne
 * Bereichszuordnung ist von jeder Aenderung betroffen — das ist die Bedeutung der Form —,
 * und eine Karte mit einer Datei ohne Muster loest im Prueflauf den vollen Umfang aus,
 * gilt hier also fuer jede rote Pruefung als beruehrt. Keine Karte zu nennen behauptete,
 * es gebe keinen Verdaechtigen; AK 4 verlangt bei Mehrdeutigkeit ausdruecklich alle.
 *
 * `gruppe.beruehrt` traegt dieselbe Ableitung wie die Auswahl (Issue #1208, Plan #1199,
 * E15): Eine Karte, die Teil A aendert, beruehrt auch die Teile, die A importieren. Liessen
 * sich die Importe nicht erheben, gilt die Karte wie bei einer Datei ohne Muster als beruehrt.
 */
function gruppeTrifft(check, gruppe) {
  if (gruppe.ohneMuster !== null || gruppe.importeUnbekannt) return true;
  if (check.always || !check.areas) return true;
  return check.areas.some((name) => gruppe.beruehrt.has(name));
}

/**
 * Die Karten, die eine rote Pruefung des Push-Laufs beruehrt haben (Issue #947, AK 4
 * des Fachplans #938).
 *
 * Nur bei `--stage push`, und nur zu einem roten Befund:
 *   - Der Anker ist der `--since`-Wert des Laufs, den `/push-main` schon heute als
 *     `git merge-base HEAD origin/<mainBranch>` uebergibt (E5). Eine eigene Marke im
 *     Projekt waere dieselbe Wahrheit an einem zweiten Ort und liefe auseinander.
 *   - Die Freigabestufe hat keinen solchen Anker (E5): `/merge-production` legt den
 *     Worktree auf `origin/<mainBranch>`, die Basis ist `HEAD` selbst, und
 *     `<basis>..HEAD` waere leer. Dort brauchte die Suche `origin/<productionBranch>`,
 *     und das ist eine andere Frage als diese.
 *   - Ohne roten Befund gibt es nichts zu erklaeren.
 *
 * Je roter Pruefung steht entweder eine nichtleere Kartenliste oder ein `hinweis` —
 * nie eine leere Liste: "keine gefunden" und "nicht bestimmbar" sind Verschiedenes, und
 * eine leere Liste liesse sich als beides lesen.
 *
 * Bei `vollerUmfang` laeuft die Suche nicht (E7): An der Push-Stufe entsteht das Feld
 * allein aus einem nicht aufloesbaren Anker, und dann hat `<basis>..HEAD` keinen linken
 * Rand — es gibt keine Menge "seit dem Anker", aus der alle genannt werden koennten.
 * `auswahl.basis` traegt in diesem Fall den `refText` des Aufrufs.
 *
 * Die Config wird hier erneut gelesen, weil die Eintraege der Zusammenfassung ihre
 * `areas` nicht tragen — derselbe Weg wie in `configFingerabdruck`. Findet sich zu einem
 * Kommando kein Eintrag, gilt es als nicht zugeordnet und damit als von jeder Karte
 * beruehrt: die sichere Richtung, mehr nennen.
 */
function verursacherKarten(auswahl, roteEintraege) {
  if (auswahl.stufe !== "push" || roteEintraege.length === 0) return null;
  const alle = (hinweis) => roteEintraege.map((e) => ({ cmd: e.cmd, hinweis }));
  if (auswahl.vollerUmfang) {
    return alle(t("verursacherAnker", { basis: auswahl.basis }));
  }

  const ermittelt = kartenGruppen(auswahl.basis);
  if (ermittelt.fehler !== undefined) return alle(t("verursacherFehler", { fehler: ermittelt.fehler }));

  const config = ladeConfig();
  const checks = (config.buildChecks ?? []).map((c) => normalisiere(c));
  const bereichsdefinition = bereicheVorbereiten(config.checkAreas ?? {});
  const freistellungen = freistellungenVorbereiten(config.ohnePruefung);
  const importGraph = einmal(importeureErheben);
  const gruppen = ermittelt.gruppen.map((gruppe) => {
    const dateien = [...gruppe.dateien];
    return {
      karte: gruppe.karte,
      shas: gruppe.shas,
      ...umAbhaengigeErweitern(zuordnen(dateien, bereichsdefinition, freistellungen), dateien, new Set(), bereichsdefinition, importGraph),
    };
  });

  return roteEintraege.map((e) => {
    const check = checks.find((c) => c.cmd === e.cmd) ?? {};
    const karten = gruppen
      .filter((gruppe) => gruppeTrifft(check, gruppe))
      .map((gruppe) => ({ karte: gruppe.karte, shas: gruppe.shas }));
    return karten.length > 0
      ? { cmd: e.cmd, karten }
      : { cmd: e.cmd, hinweis: t("verursacherKeine", { basis: auswahl.basis }) };
  });
}

/** Die Verursacher einer roten Pruefung als eine Zeile fuer Menschen. */
function verursacherText(eintrag) {
  if (eintrag.hinweis !== undefined) return eintrag.hinweis;
  return eintrag.karten
    .map((k) => (k.karte === null ? t("commitOhneKarte", { shas: k.shas.join(", ") }) : `Issue #${k.karte} (${k.shas.join(", ")})`))
    .join(", ");
}

// --- Integrationslauf (Issue #1982, Plan #1969, E5, E6, E8) -------------------

/** `origin/<mainBranch>`, der Rueckfall des Nullpunkts. */
function originRef(config) {
  return `origin/${config.mainBranch ?? "main"}`;
}

/** Der volle Hash zu `ref` oder `null`, wenn er sich nicht aufloesen laesst. */
function commitAufloesen(ref) {
  const res = git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`);
  const sha = res.stdout.trim();
  return res.status === 0 && sha ? sha : null;
}

/** `.claude/integration.json` als Objekt, `null`, wenn sie fehlt oder kein Objekt ist. */
export function integrationLesen(root = wurzel()) {
  try {
    const daten = JSON.parse(readFileSync(join(root, ...INTEGRATION_DATEI.split("/")), "utf-8"));
    return daten !== null && typeof daten === "object" && !Array.isArray(daten) ? daten : null;
  } catch {
    return null;
  }
}

/**
 * Schreibt das Ergebnis eines Integrationslaufs: Commit, Zeitpunkt, Ergebnis, Verursacher.
 * Der letzte gruene Lauf bleibt unter `gruen` stehen, bis ein neuer gruener ihn ersetzt —
 * ein roter oder offener Lauf verschiebt den Nullpunkt nicht. Scheitert das Schreiben, bleibt
 * es bei einem Hinweis: Buchhaltung, keine Bedingung, wie das Ausfuehrungsprotokoll.
 */
export function integrationSchreiben({ commit, zeitpunkt, ergebnis, verursacher = [], ...rest }, root = wurzel()) {
  const pfad = join(root, ...INTEGRATION_DATEI.split("/"));
  const vorher = integrationLesen(root);
  const gruen = ergebnis === "gruen" ? { commit, zeitpunkt } : vorher?.gruen;
  const daten = { commit, zeitpunkt, ergebnis, verursacher, ...rest, ...(gruen ? { gruen } : {}) };
  try {
    mkdirSync(dirname(pfad), { recursive: true });
    writeFileSync(pfad, `${JSON.stringify(daten, null, 2)}\n`, "utf-8");
  } catch (err) {
    aufStderr(`${t("integrationNichtGeschrieben", { pfad, grund: err.message })}\n`);
  }
}

/**
 * Ob `a` juenger ist als `b`: `b` ein Vorfahr von `a`, sonst — bei getrennten Linien — der
 * spaetere Commit-Zeitpunkt.
 */
function juenger(a, b) {
  if (git("merge-base", "--is-ancestor", b, a).status === 0) return true;
  if (git("merge-base", "--is-ancestor", a, b).status === 0) return false;
  const zeit = (sha) => Number(git("show", "-s", "--format=%ct", sha).stdout.trim());
  return zeit(a) > zeit(b);
}

/**
 * Der Nullpunkt „seit dem letzten gruenen Integrationslauf" (E6): der juengere von zwei
 * Commits, dem gruenen in `.claude/integration.json` und `origin/<mainBranch>` als Rueckfall
 * fuer einen gruenen `push main`. `{ commit, quelle: "integration" | "origin", ref? }` oder
 * `null`, wenn sich keiner aufloesen laesst. Zeigen beide auf denselben Commit, zaehlt der
 * gruene Lauf.
 */
function nullpunktBestimmen(config) {
  const kandidaten = [];
  const gruen = integrationLesen()?.gruen?.commit;
  const ausLauf = typeof gruen === "string" ? commitAufloesen(gruen) : null;
  if (ausLauf !== null) kandidaten.push({ commit: ausLauf, quelle: "integration" });
  const ref = originRef(config);
  const ausOrigin = commitAufloesen(ref);
  if (ausOrigin !== null) kandidaten.push({ commit: ausOrigin, quelle: "origin", ref });
  if (kandidaten.length < 2) return kandidaten[0] ?? null;
  const [lauf, origin] = kandidaten;
  return lauf.commit !== origin.commit && juenger(origin.commit, lauf.commit) ? origin : lauf;
}

/**
 * Die Pakete seit `basis`: die Commits mit Kartennummer zwischen `basis` und `HEAD`, je Karte
 * eine Gruppe, juengste zuerst. Ein Commit ohne Nummer ist kein Paket.
 */
function paketeSeit(basis) {
  const log = commitsSeit(basis);
  if (log.fehler !== undefined) fail(log.fehler);
  const nachKarte = new Map();
  for (const { sha, karte } of log.commits) {
    if (karte === null) continue;
    if (!nachKarte.has(karte)) nachKarte.set(karte, { karte, shas: [] });
    nachKarte.get(karte).shas.push(sha);
  }
  return [...nachKarte.values()];
}

/** Das Alter des letzten `fetch` aus `FETCH_HEAD`, `null` ohne einen. */
function fetchAlter() {
  const res = git("rev-parse", "--git-path", "FETCH_HEAD");
  if (res.status !== 0) return null;
  try {
    const zeit = statSync(resolve(wurzel(), res.stdout.trim())).mtime;
    return { zeitpunkt: zeit.toISOString(), alterSekunden: Math.max(0, Math.round((Date.now() - zeit.getTime()) / 1000)) };
  } catch {
    return null;
  }
}

/**
 * `integration`: Nullpunkt, Pakete seitdem, letztes Ergebnis und Alter des letzten `fetch`
 * als JSON (E6). Aendert nichts.
 */
function integrationAusgeben(rest) {
  const stelle = rest.indexOf("--pushed");
  if (stelle !== -1) return gepushtEintragen(rest[stelle + 1], rest.filter((_, i) => i !== stelle && i !== stelle + 1));
  for (const arg of rest) fail(t("unbekanntesArgument", { arg }));
  const config = ladeConfig();
  const nullpunkt = nullpunktBestimmen(config);
  const letzte = integrationLesen();
  const ausgabe = {
    nullpunkt,
    pakete: nullpunkt === null ? [] : paketeSeit(nullpunkt.commit),
    letztesErgebnis: letzte === null ? null : { ergebnis: letzte.ergebnis, commit: letzte.commit, zeitpunkt: letzte.zeitpunkt },
    fetch: fetchAlter(),
  };
  aufStdout(`${JSON.stringify(ausgabe, null, 2)}\n`);
  return 0;
}

/**
 * `integration --pushed <commit>`: Nach einem gruenen `push main` traegt `/push-main` den
 * gepushten Commit als gruen ein (Issue #1983, E6) — er wird zum Nullpunkt, auch wenn
 * `origin/<mainBranch>` mangels `fetch` aelter ist.
 */
function gepushtEintragen(ref, rest) {
  for (const arg of rest) fail(t("unbekanntesArgument", { arg }));
  if (ref === undefined || ref.startsWith("--")) fail(t("integrationGepushtOhneWert"));
  const commit = commitAufloesen(ref);
  if (commit === null) fail(t("integrationGepushtUnbekannt", { commit: ref, datei: INTEGRATION_DATEI }));
  integrationSchreiben({ commit, zeitpunkt: new Date().toISOString(), ergebnis: "gruen", quelle: "push" });
  aufStdout(`${JSON.stringify(integrationLesen(), null, 2)}\n`);
  return 0;
}

/** Die Zeile vor dem ersten Kommando des Integrationslaufs: Nullpunkt und Pakete seitdem. */
function integrationStartZeile(integration) {
  const { nullpunkt, pakete } = integration;
  const liste = pakete.length > 0 ? pakete.map((p) => `Issue #${p.karte}`).join(", ") : t("integrationKeinePakete");
  return t("integrationStart", { commit: nullpunkt.commit.slice(0, 12), quelle: nullpunkt.quelle, pakete: liste });
}

/** Der Anlass der Zeilen eines Laufs im Ausfuehrungsprotokoll (Issue #948, #1982). */
function anlassVon(auswahl) {
  if (auswahl.integration) return "integration";
  return auswahl.abschluss ? "abschluss" : auswahl.stufe;
}

/**
 * Der Beginn eines Integrationslaufs, `null` fuer jeden anderen Lauf: Kopf-Commit, Zeitpunkt,
 * Obergrenze und ihr Ende. Ab hier steht er in integration.json als `offen`, bis ein Urteil
 * feststeht — stirbt der Lauf, bleibt er offen und nie gruen.
 */
function integrationBeginnen(auswahl, zeitpunkt) {
  if (!auswahl.integration) return null;
  const obergrenzeMs = integrationObergrenzeMs();
  const lauf = { kopf: git("rev-parse", "HEAD").stdout.trim(), zeitpunkt, obergrenzeMs, ende: Date.now() + obergrenzeMs };
  auswahl.integration.ergebnis = "offen";
  integrationSchreiben({ commit: lauf.kopf, zeitpunkt, ergebnis: "offen", nullpunkt: auswahl.integration.nullpunkt });
  return lauf;
}

/**
 * Die Verursacher am Ende eines Laufs. Ein Integrationslauf, der an seiner Obergrenze abbrach,
 * hat kein Urteil (E8): offen, ohne Verursacher — was abgebrochen wurde, ist nicht als Fehler
 * belegt.
 */
function verursacherNachLauf(auswahl, stand, integrationsLauf) {
  if (stand.obergrenze) {
    aufStdout(`\n${t("integrationObergrenze", { dauer: dauerText(integrationsLauf.obergrenzeMs) })}\n`);
    return null;
  }
  return verursacherKarten(auswahl, stand.laufen.filter((e) => e.ergebnis === "rot"));
}

/** Das Urteil eines Integrationslaufs: `offen` an der Obergrenze, sonst `rot` oder `gruen`. */
function integrationsErgebnis(stand) {
  if (stand.obergrenze) return "offen";
  return stand.rot ? "rot" : "gruen";
}

/** Schreibt das Urteil eines Integrationslaufs nach integration.json und in die Auswahl. */
function integrationAbschliessen(auswahl, integrationsLauf, stand) {
  if (integrationsLauf === null) return;
  const ergebnis = integrationsErgebnis(stand);
  auswahl.integration.ergebnis = ergebnis;
  integrationSchreiben({
    commit: integrationsLauf.kopf, zeitpunkt: integrationsLauf.zeitpunkt, ergebnis, verursacher: stand.verursacher ?? [],
    nullpunkt: auswahl.integration.nullpunkt, pakete: auswahl.integration.pakete,
  });
}

/** Die wirksame Obergrenze des Integrationslaufs: die Konstante, im Test herabgesetzt. */
function integrationObergrenzeMs(env = umgebungsVariablen()) {
  return positiveZahl(env, INTEGRATION_OBERGRENZE_ENV, INTEGRATION_OBERGRENZE_MS);
}

/**
 * Fuehrt die Auswahl aus `planen` aus und gibt den Exit-Code zurueck.
 *
 * Der Rueckgabewert je gelaufenem Kommando steht in der Zusammenfassung: `gruen`,
 * `rot` oder `nicht gestartet`. Ohne dieses Feld koennte der Runner einen
 * Fehlschlag nicht dem ausloesenden Paket zuordnen (Kriterium 9 aus Issue #420).
 *
 * Die Dauer je Kommando entsteht hier und nicht aus der Werkzeugzeit des
 * Session-Stroms (Issue #747, Plan #745, E3): Der Strom kennt nur "ein
 * Bash-Aufruf dauerte n Sekunden", nicht welches konfigurierte Kommando darin
 * lief — die Zuordnung braeuchte genau die inhaltliche Deutung, die das
 * Nicht-Ziel "Keine inhaltliche Deutung der Aufrufe" ausschliesst. `checks.mjs`
 * kennt seine Kommandos dagegen beim Namen.
 */
/**
 * Die Ankuendigung vor dem Lauf (Issue #758): der Nullpunkt des Integrationslaufs, oder oberhalb
 * der Paketstufe, was zusaetzlich laeuft, und an der Push-Stufe die Strenge (Issue #2107).
 */
function ankuendigen(auswahl) {
  if (auswahl.integration?.nullpunkt) {
    aufStdout(`${integrationStartZeile(auswahl.integration)}\n`);
  } else if (auswahl.stufe !== STUFEN[0] && !auswahl.integration) {
    const hinzu = auswahl.laufen.filter((e) => e.stufe !== STUFEN[0]).map((e) => e.cmd);
    const liste = hinzu.length > 0 ? hinzu.join(", ") : t("keineWeitere");
    // Der Mutationstest an `push` (Issue #1673) gehoert in dieselbe Zeile: Er kommt dazu.
    // Haelt er an (Issue #2108), nennt die Zeile die Marke statt „nur berichtet".
    const mutationCmd = mutationFaellig(auswahl);
    const haltMarke = mutationHaltMarke(auswahl);
    const angekuendigt = haltMarke === null
      ? t("mutationAngekuendigt", { cmd: mutationCmd })
      : t("mutationAngekuendigtHalt", { cmd: mutationCmd, marke: haltMarke.marke });
    const danach = mutationCmd === null ? "" : `, ${angekuendigt}`;
    aufStdout(`${t("stufeZusaetzlich", { stufe: auswahl.stufe, liste })}${danach}\n`);
  }
  if (auswahl.strenge) aufStdout(`${strengeAnkuendigung(auswahl)}\n`);
}

/**
 * `run`. Rueckgabe: ein Promise auf den Exitcode (Issue #1070) — auch beim uebernommenen
 * Ergebnis, damit der Aufrufer nur einen Fall kennt.
 */
async function ausfuehren(args) {
  if (umgebung.signale !== false) gruppenHandlerSetzen();
  // Die Wartezeit laeuft ab dem Aufruf (Issue #1069, Plan #1066).
  const startNs = process.hrtime.bigint();
  // Gelesen, bevor dieser Lauf die Datei zum ersten Mal ueberschreibt — sie traegt die
  // bisherige Summe der Karte.
  const vorige = vorigeZusammenfassung();
  const auswahl = await planen(args);
  // Nach der Auswahl und vor Uebernahme und `--fresh` (Issue #1388, Plan #1386, E6): Eine
  // festgefahrene Pruefung bekommt unbeaufsichtigt kein Ergebnis mehr, auch kein uebernommenes.
  const gebremst = bremsen(auswahl, vorige);
  if (gebremst !== null) return gebremst;
  // Ohne die Variablen des automatischen Laufs (Issue #1282): Was ein Pruefkommando misst,
  // haengt nicht davon ab, ob es unbeaufsichtigt laeuft. settings.json und die Kommandozeile setzen weiter.
  const env = { ...ohneLaufVariablen(umgebungsVariablen()), ...settingsEnv() };

  // VOR dem ersten Kommando (Issue #469): Der Hash bezeugt den Inhalt, der in die
  // Pruefung ging. Danach gehasht, bescheinigte er einen Stand, den kein Check
  // gesehen hat, sobald ein Kommando eine Datei anfasst — ein Formatter mit
  // `--fix` genuegt. Veraendert ein Check die Datei, passt der Hash beim Commit
  // nicht mehr und das Gate weist ab: die sichere Richtung.
  //
  // Der Zeitstempel steht unmittelbar daneben und aus demselben Grund (Issue #655):
  // Er bezeugt denselben Moment wie die Hashes — den Stand, der in die Pruefung
  // ging, nicht den Zeitpunkt, zu dem sie endete. Die Nachweiszeile der
  // Release-Skills nennt Hash und Zeitpunkt gemeinsam; stammte der eine aus dem
  // Lauf und der andere aus der Sitzung, bezeugten sie Verschiedenes.
  const zeitpunkt = new Date().toISOString();
  const hashes = blobHashes(auswahl.geaendert);
  const configHash = configFingerabdruck();

  // Die Ankuendigung steht im Kommando und nicht in den Skills (Issue #758): Eine
  // Regel im Prompt wirkt nicht unter Druck — dieselbe Begruendung, aus der
  // checks.mjs ueberhaupt entstand. Das Kommando kennt die Liste ohnehin.
  //
  // Nur oberhalb der Paketstufe: Dort kommt nichts hinzu, und der haeufigste Lauf
  // bleibt still. Eine Zeile, die in jedem Lauf steht, liest bald niemand mehr.
  ankuendigen(auswahl);

  // VOR den Auslassungen (Issue #934): Eine Datei, zu der ausdruecklich nichts
  // geprueft wird, ist die einzige Ausnahme von der Regel „im Zweifel laeuft alles".
  // Sie muss in jedem Lauf dastehen, samt Grund — eine stille Ausnahme waere genau
  // die Sorte Auslassung, die niemandem auffaellt.
  for (const e of auswahl.ohnePruefung) {
    aufStdout(`${t("ableitungOhnePruefung", { pfad: e.pfad, grund: e.grund })}\n`);
  }

  // Vorab in den Bericht: Was nicht laeuft, ist genauso ein Ergebnis wie was laeuft.
  for (const e of auswahl.ausgelassen) {
    aufStdout(`${t("ausgelassenVorab", { cmd: e.cmd, grund: e.grund })}\n`);
  }

  // Nach den Auslassungen und vor dem ersten Kommando (Issue #863): Was nicht
  // laeuft, steht auch im uebernommenen Bericht — sonst saehe ein uebernommener
  // Lauf aus wie ein verkuerzter. Hier und nicht vor `blobHashes`, weil der
  // Vergleich genau diese Hashes braucht.
  // Der Integrationslauf misst immer (Issue #1982): Sein Ergebnis geht nach integration.json.
  const frisch = args.frisch || auswahl.integration !== undefined;
  const frueher = frisch ? null : frueheresErgebnis(vorige, auswahl, hashes, configHash);
  if (frueher !== null) {
    return uebernehmen(auswahl, frueher, { zeitpunkt, hashes, configHash, startNs, vorige, karte: args.karte });
  }
  // Nach einer Korrektur zuerst die zuletzt roten (Issue #1072); `--fresh` faehrt sofort alles.
  const rote = frisch ? null : zuletztRote(vorige, auswahl, hashes, configHash);
  // Vor dem ersten Kommando, damit er denselben Stand misst wie die Hashes (Issue #1719). Ein
  // eigenes Feld und nie ein Eintrag in `laufen` (Vertrag V1): Er haelt nie an.
  const bereichsabgleich = await bereichsabgleichErheben(auswahl);

  // Ab hier laufen Kommandos. Statt der einen Sperre vor Issue #1241 zaehlen Plaetze (Issue
  // #1785, Plan #1404, E11): Ein voller Lauf belegt einen, interaktiv ohne zu warten, und
  // gibt ihn im `finally` frei — auch nach einem Wurf.
  // Ohne den Pro-Teil `check-slots` (Issue #2016) belegt kein Lauf einen Platz.
  const plaetze = await pruefplaetzeLaden();
  const platz = await pruefplatzFuerLauf(plaetze, auswahl);
  const envLauf = plaetze ? plaetze.umgebungMitPlatz(env, platz) : env;
  try {
    return await kommandosFahren({ auswahl, args, env: envLauf, zeitpunkt, hashes, configHash, startNs, vorige, rote, bereichsabgleich, platz, plaetze });
  } finally {
    plaetze?.pruefplatzFreigeben(platz);
  }
}

/**
 * Faehrt die ausgewaehlten Kommandos und hinterlaesst den Bericht. Rueckgabe: der
 * Exitcode des Laufs.
 *
 * Eigene Funktion, damit `ausfuehren` zeigt, wo die Kommandos beginnen: Ein
 * uebernommenes Ergebnis endet vorher und faehrt keines.
 */
async function kommandosFahren({ auswahl, args, env, zeitpunkt, hashes, configHash, startNs, vorige, rote = null, bereichsabgleich = null, platz = null, plaetze = null }) {
  const grenzeMs = pruefdauerObergrenzeMs();
  // Einmal je Lauf gelesen (Issue #1077): Die Abbruchgrenze jedes Kommandos folgt
  // seiner Historie, und die Zeilen dieses Laufs sollen sie nicht mehr verschieben.
  const historie = ausfuehrungenLesen();
  // Die Dateiliste fuer die Dateizahl der Haengegrenze, einmal je Lauf (Issue #2216).
  const baum = einmal(baumDateien);

  // Woher die Zeilen dieses Laufs im Protokoll stammen (Issue #948). Einmal gebildet und
  // an jede Zeile gegeben, damit alle Zeilen EINES `run`-Aufrufs dieselbe Laufkennung
  // tragen — daran haengt die Trennung von "je Lauf" und "je Kommando". Ein Teillauf und
  // der volle Lauf danach sind ein Aufruf und teilen sie (Issue #1072).
  //
  // Der Anlass kommt aus der Auswahl und nicht aus den rohen Argumenten: `--finish`
  // schlaegt die Stufe, weil ein Abschlusslauf genau der Lauf ist, der Pruefungen
  // auslaesst — und ohne den Schalter ist die Stufe der Anlass (`paket`, `push`, `merge`).
  // Die Laufkennung ist derselbe `zeitpunkt`, den die Zusammenfassung traegt; ein zweiter,
  // eigener Zeitstempel bezeugte einen anderen Moment als sie.
  const herkunft = {
    anlass: anlassVon(auswahl),
    lauf: zeitpunkt,
    karte: args.karte ?? "",
  };
  // Die Eintraege von `laufen` tragen ihre `areas` nicht; der Ausloeser braucht sie
  // (Issue #1004). Derselbe Weg wie in `verursacherKarten`: die Config erneut lesen.
  const konfiguriert = (ladeConfig().buildChecks ?? []).map((c) => normalisiere(c));
  const ausloeserVon = (cmd) => ausloeserBestimmen(auswahl, konfiguriert.find((c) => c.cmd === cmd) ?? null);
  const gekennzeichnet = new Set(konfiguriert.filter((c) => c.gleichzeitig).map((c) => c.cmd));
  // Der Beleg von `--release-only` laeuft vor allen Pruefungen (Issue #2249).
  const vorab = new Set([...konfiguriert.filter((c) => c.vorab === true), ...auswahl.laufen.filter((e) => e.beleg)].map((c) => c.cmd));
  const grenze = gleichzeitigGrenze(env);
  // Der Integrationslauf endet spaetestens an seiner Obergrenze (Issue #1982, E8): Jedes
  // Kommando bekommt hoechstens die Restzeit, und wer an ihr abbricht, macht den Lauf `offen`.
  const integrationsLauf = integrationBeginnen(auswahl, zeitpunkt);
  const integrationsEnde = integrationsLauf?.ende ?? null;
  const weiterNachRot = weiterNachRotIn(auswahl);

  // Die Zusammenfassung BEGLEITET den Lauf (Issue #857, Plan #810, E1): Sie entsteht
  // vor dem ersten Kommando und wird vor jedem weiteren ueberschrieben, statt erst am
  // Ende zu entstehen.
  //
  // Der Grund ist der Abbruch. Ein Lauf, der an der Uhr, durch ein Signal oder mit der
  // Session endet, hinterliess vorher keine Datei — und eine fehlende Datei ist fuer
  // den Runner "ungeprueft", also ungemessen statt beanstandet. Oder es blieb
  // eine aeltere liegen, die wie das Ergebnis dieses Laufs aussah. Jetzt liegt in jedem
  // Moment eine Fassung, und jede, die ein Abbruch hinterlassen kann, traegt mindestens
  // einen Eintrag `nicht gestartet` (Fachplan #769, AK 3 und 4).
  //
  // VOR dem Kommando und nicht danach, weil Gate (.githooks/gate.mjs) und Runner
  // (`lesePruefung` in night.mjs) allein `ergebnis !== "gruen"` auswerten und
  // `abgeschlossen` nicht sehen: Das laufende Kommando muss in der Datei noch
  // ungruen stehen, sonst saehe ein Abbruch mittendrin gruen aus.
  //
  // Die Wartezeit steht nur in der abgeschlossenen Fassung (Issue #1069) — vorher ist
  // der Lauf nicht zu Ende. Die Summe der Karte reicht jede fruehere Fassung unveraendert
  // weiter: Stirbt der Lauf, beginnt der naechste nicht bei null.
  //
  // Ein Teillauf (Issue #1072) fuehrt alle ausgewaehlten Kommandos in `laufen`, die nicht
  // gefahrenen auf `nicht gestartet` — darum steht er in keiner Fassung gruen, auch nicht
  // in der letzten. Die Marke `teillauf` und die Zeile davor sagen, warum.
  let wartezeit = {};
  if (args.karte !== undefined && vorige?.wartezeitKarte?.karte === args.karte) {
    wartezeit = { wartezeitKarte: vorige.wartezeitKarte };
  }
  // Die Folgen gleicher Fehlschlaege (Issue #1388, Plan #1386, E2, E3), fortgeschrieben aus
  // der vorigen Zusammenfassung wie die Wartezeit der Karte. Jede Fassung rechnet sie aus der
  // Basis und dem Stand neu — ein noch nicht gefahrenes Kommando aendert nichts. Nach einem
  // Teillauf ruecken dessen Ergebnisse in die Basis, damit der volle Lauf danach auf ihnen
  // aufsetzt und nicht auf dem Stand vor dem Aufruf.
  let festgefahrenBasis = vorige?.festgefahren;
  // Die Wackler der Karte (Issue #1397, Plan #1395, E11): die aus frueheren Laeufen
  // derselben Karte, dahinter die dieses Aufrufs — die des Teillaufs eingeschlossen, auch
  // in den Fassungen, bevor der volle Lauf sie an seine Eintraege uebernommen hat.
  const gewackeltVorher = gewackeltKarteVorher(vorige, args.karte);
  let wacklerTeillauf = [];
  // Das Nachformatieren dieses Aufrufs (Issue #1672, Plan #1671, E1): `{ cmd, gereicht }`,
  // solange keiner lief `null`.
  let formatFix = null;
  // Der Mutationstest dieses Aufrufs (Issue #1673, Plan #1671, E3): `{ cmd, ergebnis, exit,
  // dauerMs }`, solange keiner lief `undefined` — das Feld faellt dann beim Schreiben weg.
  // `mutationEntfallen` haelt fest, dass er wegen des roten Laufs nicht lief.
  let mutation;
  let mutationEntfallen = false;
  // Nur der erste Durchgang wiederholt; der nach dem Fix laeuft genau einmal (E1).
  let wiederholen = auswahl.wiederholen === true;
  const zeilenVon = (stand) => [
    ...(stand.teillauf ? [t("teillauf")] : []),
    ...formatFixZeilen(formatFix),
    ...berichtszeilen(auswahl, stand.laufen, { grenzeMs, frueher: gewackeltVorher ?? [] }),
    ...mutationZeilen(mutation, mutationEntfallen),
    ...strengeLueckeZeilen(auswahl),
  ];
  const schreibeStand = (stand, abgeschlossen) => schreibeZusammenfassung({
    ...auswahl, laufen: stand.laufen, zeitpunkt, hashes, configHash, abgeschlossen,
    dauerGesamtMs: dauerGesamt(stand.laufen), ...(stand.guete ? { guete: stand.guete } : {}),
    ...(stand.verursacher ? { verursacher: stand.verursacher } : {}),
    ...(stand.teillauf ? { teillauf: true } : {}),
    ...(formatFix ? { formatFix } : {}),
    mutation,
    hinweise: hinweiseVon(stand.laufen),
    berichtszeilen: zeilenVon(stand),
    ...wartezeit,
    ...pruefplatzFelderVon(plaetze, platz),
    festgefahren: festgefahrenNach(festgefahrenBasis, stand.laufen),
    ...(gewackeltVorher
      ? { gewackeltKarte: gewackeltKarteNach(gewackeltVorher, args.karte, [...stand.laufen, ...wacklerTeillauf], zeitpunkt) }
      : {}),
    ...(bereichsabgleich ? { bereichsabgleich } : {}),
  });

  // Ein Durchgang ueber die ausgewaehlten Kommandos — alle oder, beim Teillauf, nur die
  // in `nur`. Beide folgen denselben Achsen (Plan #1066, E5): Mehrere rote Testgruppen
  // sind der Normalfall eines roten Laufs, und nacheinander kosteten sie die Minuten, die
  // der Teillauf sparen soll.
  const durchgang = async (nur) => {
    // Die Verursacher stehen erst am Ende fest (Issue #947): Vor dem roten Befund gibt es
    // nichts zu erklaeren, und `schreibeStand` liest das Feld, statt es zu bekommen —
    // so traegt jede Fassung der Zusammenfassung den Stand, den sie bezeugt.
    const stand = {
      laufen: auswahl.laufen.map((e) => ({ ...e, ergebnis: "nicht gestartet", dauerMs: null })),
      rot: false, guete: null, verursacher: null, teillauf: nur !== null, obergrenze: false,
    };
    const restzeit = () => (integrationsEnde === null ? Infinity : integrationsEnde - Date.now());
    // Vor jedem Start: Nach einem Rot oder an der Obergrenze beginnt keine weitere Pruefung.
    // In der Push-Stufe und im Integrationslauf haelt allein die Obergrenze (Issue #2133,
    // #2089); mit `--finish` und `--hotfix` bleibt der Abbruch beim ersten Rot.
    const anGrenze = () => {
      if (restzeit() <= 0) stand.obergrenze = true;
      return stand.obergrenze;
    };
    const halt = () => {
      if (anGrenze()) stand.rot = true;
      return weiterNachRot ? stand.obergrenze : stand.rot;
    };
    schreibeStand(stand, false);

    // Ein Kommando einmal fahren und bewerten. `haengend` und `fehlermerkmal` gelten dem Lauf,
    // der entscheidet — nach einer Wiederholung ihr, darum vorher geraeumt.
    const fahren = async (eintrag, schreibe) => {
      delete eintrag.haengend;
      delete eintrag.fehlermerkmal;
      const start = process.hrtime.bigint();
      const laufDauern = stand.laufen.filter((e) => e.ergebnis === "gruen").map((e) => e.dauerMs);
      const eigeneMs = haengeGrenzeMs(eintrag.cmd, historie, env, laufDauern, herkunft.anlass,
        dateizahl(befehlszeile(eintrag), baum()), baum());
      const restMs = Math.max(1, restzeit());
      const haengeMs = Math.min(eigeneMs, restMs);
      // Ein Teilaufruf faehrt seine Teilzeile; Grenze und Protokoll bleiben bei `cmd` (Issue #1980).
      // Der Beleg der Release-Ableitung ist kein Shell-Kommando (Issue #2249).
      const { gruen, ausgabe, haengend, code } = eintrag.beleg
        ? await belegFahren(eintrag, auswahl.basis, env)
        : await kommandoAusfuehren(befehlszeile(eintrag), env, { grenzeMs: haengeMs, fristMs: haengenFristMs(env) });
      // Abgebrochen an der Restzeit des Integrationslaufs und nicht an der eigenen Grenze.
      if (haengend && restMs < eigeneMs) stand.obergrenze = true;
      const dauerMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
      // Das Feld fehlt ohne Abbruch (Issue #1077) — wie `ueberObergrenzeMs`.
      if (haengend) eintrag.haengend = { grenzeMs: haengeMs };
      schreibe(ausgabe);
      const haengeText = haengend ? `${haengendText(haengeMs)}\n` : "";
      if (haengend) schreibe(haengeText);
      const bewertung = bewerten(eintrag, gruen, ausgabe, schreibe, code);
      stand.guete = bewertung.guete ?? stand.guete;
      return { bestanden: bewertung.bestanden, dauerMs, ausgabe, abgelegt: ausgabe + haengeText };
    };

    // Ablage und Fehlerabdruck eines roten Ergebnisses.
    const rotFesthalten = (eintrag, nummer, lauf, schreibe) => {
      const ablage = protokollAblegen(nummer, eintrag.cmd, lauf.abgelegt);
      if (ablage) {
        eintrag.protokoll = ablage;
        schreibe(`${t("ausgabeAbgelegt", { pfad: ablage })}\n`);
      }
      // Der Fehlerabdruck (Issue #1388, E4): woran der naechste Lauf erkennt, ob dieselbe
      // Pruefung auf dieselbe Weise scheitert — nach einer Wiederholung der ihre (E7).
      eintrag.fehler = fehlschlagAbdruck(lauf.ausgabe);
      // Fund im Wortlaut, Abdruck und Art (Issue #2090, Plan #2087, A2, A3): woraus eine
      // Reparaturkarte entsteht. `fehler` bleibt fuer bestehende Leser.
      delete eintrag.handgriff;
      Object.assign(eintrag, { abdruck: eintrag.fehler, ...fundVon(lauf.ausgabe) });
    };

    // Ein Kommando fahren, bewerten und festhalten — fuer beide Phasen dieselbe Bahn.
    // `schreibe` nimmt alles auf, was zum Kommando gehoert: in der nachfolgenden Phase
    // geht es sofort nach stdout, in der gleichzeitigen in den Block des Kommandos.
    //
    // Ist der erste Lauf rot und `auswahl.wiederholen` gesetzt, faehrt es im selben
    // Ablaufplatz genau einmal erneut (Issue #1396, Plan #1395, E4, E6) — vor jeder
    // Entscheidung ueber Abbruch oder Weiterlauf, damit ein Wackler den Rest der Phase nicht
    // anhaelt. Der Eintrag behaelt ein einziges `ergebnis`, das der Wiederholung (E5).
    const einKommando = async (eintrag, schreibe, nebenAnderen) => {
      const nummer = stand.laufen.indexOf(eintrag) + 1;
      // Das Feld fehlt, wenn das Kommando allein lief (Issue #1071) — wie `ueberObergrenzeMs`.
      if (nebenAnderen) eintrag.gleichzeitig = true;
      // Je beendetem Lauf und nicht am Ende (Issue #785): So traegt auch das rote Kommando
      // seine Zeile, das den Rest abbricht. Beide Laeufe einer Wiederholung bekommen eine
      // eigene, markiert in Spalte 12 (E8).
      const zeile = (lauf, wiederholung) => ausfuehrungSchreiben(eintrag.cmd, lauf.bestanden ? "gruen" : "rot",
        lauf.dauerMs, herkunft, ausloeserVon(eintrag.cmd), { gleichzeitig: nebenAnderen, wiederholung, teil: eintrag.gefahren ?? "" });
      const erster = await fahren(eintrag, schreibe);
      let lauf = erster;
      let erstlauf = null;
      if (!erster.bestanden && wiederholen && !stand.obergrenze) {
        // Die rote Ausgabe bleibt liegen (E17): Wer die Pruefung spaeter repariert, braucht sie.
        erstlauf = protokollAblegen(nummer, eintrag.cmd, erster.abgelegt, "-erstlauf");
        if (erstlauf) schreibe(`${t("erstlaufAbgelegt", { pfad: erstlauf })}\n`);
        zeile(erster, "erstlauf");
        schreibe(`${t("wiederholung", { cmd: eintrag.cmd })}\n`);
        lauf = await fahren(eintrag, schreibe);
      }
      const wiederholt = lauf !== erster;
      // Beide Laeufe kosten Zeit (E5): die Summe.
      eintrag.dauerMs = wiederholt ? erster.dauerMs + lauf.dauerMs : lauf.dauerMs;
      // Nur vermerkt, nie rot (Issue #1003, E4): Das Feld fehlt unter der Grenze ganz.
      if (eintrag.dauerMs > grenzeMs) eintrag.ueberObergrenzeMs = eintrag.dauerMs - grenzeMs;
      eintrag.ergebnis = lauf.bestanden ? "gruen" : "rot";
      schreibe(`-> ${ausgangText(eintrag.ergebnis, wiederholt)}\n`);
      if (!lauf.bestanden) rotFesthalten(eintrag, nummer, lauf, schreibe);
      zeile(lauf, wiederholt ? "wiederholung" : "");
      // Hinten angehaengt (E5): Gate und Runner lesen weiter allein `ergebnis`.
      if (wiederholt && lauf.bestanden) eintrag.gewackelt = { erstDauerMs: erster.dauerMs, protokoll: erstlauf };
      if (wiederholt && !lauf.bestanden) eintrag.wiederholt = true;
      if (!lauf.bestanden) stand.rot = true;
    };

    // Zwei Phasen (Issue #1071, Plan #1066, A1, A2, A6): zuerst die mit `gleichzeitig`
    // gekennzeichneten, hoechstens `grenze` auf einmal, danach die uebrigen nacheinander.
    // Ohne gekennzeichnete bleibt die erste Phase leer, und der Ablauf ist der bisherige.
    // Davor die Vorphase (Issue #1519): die mit `vorab` gekennzeichneten, nacheinander.
    const faellig = nur === null ? stand.laufen : stand.laufen.filter((e) => nur.has(e.cmd));
    const vorphase = faellig.filter((e) => vorab.has(e.cmd));
    const erste = faellig.filter((e) => gekennzeichnet.has(e.cmd));
    const danach = faellig.filter((e) => !gekennzeichnet.has(e.cmd) && !vorab.has(e.cmd));
    // "Neben anderen gemessen" nur, wenn wirklich mehrere zugleich laufen konnten: Mit der
    // Grenze 1 oder einer einzigen gekennzeichneten ist die Dauer eine allein gemessene.
    const nebenAnderen = grenze > 1 && erste.length > 1;

    // Die Vorphase laeuft wie die nachfolgende. An der Paketstufe, mit `--finish` und mit
    // `--hotfix` bricht sie beim ersten Rot ab, und keine weitere Pruefung startet: So ist
    // das Rot einer schnellen Pruefung nach Sekunden bekannt und nicht erst nach den langen
    // gleichzeitigen. In der Push-Stufe und im Integrationslauf beendet ein Rot sie nicht
    // (`weiterNachRot`, Issue #2089): Dort haelt allein die Obergrenze.
    for (const eintrag of vorphase) {
      if (halt()) break;
      schreibeStand(stand, false);
      aufStdout(`\n$ ${befehlszeile(eintrag)} — ${eintrag.grund}\n`);
      await einKommando(eintrag, (text) => aufStdout(text), false);  // eslint-disable-line no-await-in-loop -- NOSONAR S9382: die Vorphase laeuft allein vor den gleichzeitigen Pruefungen, ein Rot beendet sie
    }

    // Die erste Phase laeuft VOLLSTAENDIG durch, auch nach einem Rot: Wer korrigiert, soll
    // alle roten auf einmal sehen und nicht eine nach der anderen. Die Ausgabe jedes
    // Kommandos wird gesammelt und als geschlossener Block geschrieben, sobald er und alle
    // davor fertig sind — so steht sie in Config-Reihenfolge, gleich wer zuerst endet.
    // Nach einem Rot der Vorphase startet sie nur in der Push-Stufe und im Integrationslauf.
    const bloecke = new Map();
    let naechsterBlock = 0;
    const warteschlange = halt() ? [] : [...erste];
    const arbeiter = async () => {
      for (let eintrag = warteschlange.shift(); eintrag && !anGrenze(); eintrag = warteschlange.shift()) {
        let block = `\n$ ${befehlszeile(eintrag)} — ${eintrag.grund}\n`;
        await einKommando(eintrag, (text) => { block += text; }, nebenAnderen);  // eslint-disable-line no-await-in-loop -- NOSONAR S9382: ein Arbeiter nimmt eine Pruefung nach der anderen, gleichzeitig laufen die Arbeiter
        bloecke.set(eintrag, block);
        // Nach jedem Ende (Issue #857): Die noch laufenden stehen darin weiter auf
        // `nicht gestartet` — ein Abbruch mittendrin sieht damit nie gruen aus.
        schreibeStand(stand, false);
        while (naechsterBlock < erste.length && bloecke.has(erste[naechsterBlock])) {
          aufStdout(bloecke.get(erste[naechsterBlock]));
          naechsterBlock += 1;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(grenze, warteschlange.length) }, arbeiter));

    // Die nachfolgende Phase startet nach einem Rot davor nicht und bricht beim ersten
    // eigenen Rot ab; der Rest bleibt "nicht gestartet". In der Push-Stufe und im
    // Integrationslauf startet sie trotzdem und laeuft bis zum Ende (Issue #2133, Plan
    // #2131, A4): Eine Reparaturrunde sieht alle Funde und nicht nur den ersten.
    for (const eintrag of danach) {
      if (halt()) break;
      schreibeStand(stand, false);
      aufStdout(`\n$ ${befehlszeile(eintrag)} — ${eintrag.grund}\n`);
      await einKommando(eintrag, (text) => aufStdout(text), false);  // eslint-disable-line no-await-in-loop -- NOSONAR S9382: die Nachphase laeuft allein nach den gleichzeitigen Pruefungen, ein Rot beendet sie
    }
    // Was an der Obergrenze nicht startete, macht den Lauf unvollstaendig und damit nicht
    // gruen (Issue #2089) — auch wenn danach keine Phase mehr kam, die `halt()` fragte.
    if (stand.obergrenze) stand.rot = true;
    stand.guete ??= gueteOhneLauf(stand.laufen, auswahl.ausgelassen);
    return stand;
  };

  // Zuerst die zuletzt roten (Issue #1072, Plan #1066, A3): Bleiben sie rot, endet der
  // Aufruf damit — der volle Lauf braechte dasselbe Rot erst nach allen anderen. Werden
  // sie gruen, folgt im selben Aufruf genau einmal der volle Lauf als Nachweis.
  // Nur ein echter Lauf leert die Ablage (Issue #1196); ein uebernommener endet vorher in
  // `uebernehmen` und reicht die Pfade mit `laufen` weiter.
  protokolleLeeren();
  let stand = null;
  // Die Wackler des Teillaufs (Issue #1396, E4): Teillauf und voller Lauf sind je ein
  // Durchgang mit hoechstens einer Wiederholung; was im Teillauf gewackelt hat, geht in den
  // vollen Lauf ueber wie `festgefahrenBasis` — sonst verschwaende er mit dessen Eintraegen.
  if (rote !== null) {
    aufStdout(`\n${t("teillauf")}: ${rote.join(", ")}\n`);
    stand = await durchgang(new Set(rote));
    if (!stand.rot) {
      aufStdout(`\n${t("teillaufGruen")}\n`);
      festgefahrenBasis = festgefahrenNach(festgefahrenBasis, stand.laufen);
      wacklerTeillauf = stand.laufen.filter((e) => e.gewackelt);
      stand = null;
    }
  }
  if (stand === null) {
    stand = await durchgang(null);
    wacklerUebernehmen(stand.laufen, wacklerTeillauf);
  }

  // Das Nachformatieren (Issue #1672, Plan #1671, E1): An der Paketstufe laeuft nach einem
  // roten Durchgang — mit `--finish` also erst nach der Wiederholung — `formatFixCommand`
  // genau einmal, danach ein zweiter Durchgang ueber alles, nie ein dritter. So geschieht
  // es interaktiv wie unbeaufsichtigt, ohne dass jemand einen eigenen Schritt aufruft. An `push` und
  // `merge` nicht: Dort wird der Stand gemessen, der hinausgeht, und ein Fix aenderte ihn
  // ungesehen.
  //
  // Der zweite Durchgang bezeugt den Stand NACH dem Fix: neue Blob-Hashes, neuer
  // `zeitpunkt` — sonst wiese das Gate den Commit wegen der geaenderten Blobs ab. Die
  // Laufkennung (`herkunft.lauf`) bleibt die des Aufrufs: Im Ausfuehrungsprotokoll und in
  // der Wartezeit ist es ein Lauf. Der Fix selbst ist keine Pruefung und bekommt keine Zeile.
  const fixCmd = formatFixKommando();
  if (stand.rot && auswahl.stufe === STUFEN[0] && fixCmd !== null) {
    aufStdout(`\n${t("formatFixStart", { cmd: fixCmd })}\n\n$ ${fixCmd}\n`);
    const fix = await kommandoAusfuehren(fixCmd, env);
    aufStdout(fix.ausgabe);
    zeitpunkt = new Date().toISOString();
    hashes = blobHashes(auswahl.geaendert);
    // Die Bremse zaehlt den Aufruf als einen Versuch: Die Basis rueckt nicht weiter.
    wacklerTeillauf = [...wacklerTeillauf, ...stand.laufen.filter((e) => e.gewackelt)];
    wiederholen = false;
    stand = await durchgang(null);
    wacklerUebernehmen(stand.laufen, wacklerTeillauf);
    formatFix = { cmd: fixCmd, gereicht: !stand.rot };
  }

  // Nach dem roten Befund und vor der letzten Fassung (Issue #947): Die Suche erklaert
  // einen Befund, der schon gefallen ist, und aendert am Ausgang des Laufs nichts — auch
  // dann nicht, wenn ein git-Aufruf dabei scheitert. Dieselbe Haltung wie beim
  // Ausfuehrungsprotokoll: Buchhaltung, keine Bedingung.
  ausgaengeSetzen(stand);
  stand.verursacher = verursacherNachLauf(auswahl, stand, integrationsLauf);
  for (const e of stand.verursacher ?? []) {
    aufStdout(`${t("verursacherZeile", { cmd: e.cmd, text: verursacherText(e) })}\n`);
  }
  fundZeilenSchreiben(stand.laufen);

  // Der Mutationstest (Issue #1673, Plan #1671, E3): an `push` nach allen `buildChecks`
  // genau einmal — auch mit `--retry` nie ein zweites Mal —, mit der Obergrenze als
  // Abbruchgrenze. Er ist kein `buildChecks`-Eintrag: keine Zeile im Ausfuehrungsprotokoll.
  // Den Exit-Code beeinflusst er nur, wenn er anhaelt (`mutation halt` mit Marke, Issue #2108).
  // Nach einem roten Lauf entfaellt er.
  mutationEntfallen = mutationEntfaellt(auswahl, stand.rot);
  if (!stand.rot && mutationFaellig(auswahl) !== null) {
    schreibeStand(stand, false);
    const zeile = mutationEinsetzen(mutationFaellig(auswahl), auswahl);
    mutation = zeile === null
      ? { cmd: mutationFaellig(auswahl), ausgelassen: true }
      : await mutationFahren(zeile, env, grenzeMs, { guete: mutationMarke(), haelt: mutationHaltMarke(auswahl) !== null });
  }

  // Die letzte Fassung, und die einzige mit `abgeschlossen: true`: Hier ist der Lauf
  // zu Ende gefahren. Auch bei rotem Abbruch geschrieben — und beim leeren Paket
  // ebenso: "keine Pruefung, weil nichts veraendert wurde" ist ein Ergebnis und kein
  // Loch. Rot und abgeschlossen sind Verschiedenes: Das eine sagt, wie die Pruefung
  // ausging, das andere, ob sie ihr Ende erreicht hat.
  //
  // Das guete-Feld steht nur da, wenn das Projekt eine Messung benannt hat — dann
  // aber immer, auch beim gruenen Lauf (Issue #763).
  //
  // Die Wartezeit laeuft ab dem Aufruf und umfasst damit Teillauf und vollen Lauf
  // (Issue #1072) — beide sind Warten desselben Pakets.
  const wartezeitMs = msSeit(startNs);
  const wartezeitKarte = wartezeitKarteNach(vorige, args.karte, wartezeitMs);
  wartezeit = { wartezeitMs, ...(wartezeitKarte ? { wartezeitKarte } : {}) };
  integrationAbschliessen(auswahl, integrationsLauf, stand);
  const pfad = schreibeStand(stand, true);
  festgefahrenMelden(stand.laufen, festgefahrenNach(festgefahrenBasis, stand.laufen));
  bereichsabgleichMelden(bereichsabgleich);
  berichtsblockSchreiben([...(plaetze?.pruefplatzZeilen(platz) ?? []), ...zeilenVon(stand)], wartezeitZeile(wartezeitMs, wartezeitKarte));
  aufStdout(`\n${t("zusammenfassung", { pfad })}\n`);
  // Ein haltender Mutationstest unter der Marke oder ohne auswertbaren Wert macht den Lauf rot
  // (Issue #2108, Plan #2102, A6), ohne Eintrag in `laufen`: Er bleibt kein buildChecks-Eintrag.
  return stand.rot || mutationHaeltAn(mutation) ? 1 : 0;
}

/** Die Werte von `ausgang` in `laufen[]` (Issue #2133), fest wie `ergebnis` und ohne Uebersetzung. */
export const AUSGAENGE = Object.freeze(["bestanden", "rot", "ohne Ergebnis", "nicht gelaufen"]);

/**
 * Der Ausgang jedes Eintrags mit Grund (Issue #2133, Plan #2131, A4): `bestanden`, `rot`,
 * `ohne Ergebnis` (abgebrochen) oder `nicht gelaufen`. `ergebnis` bleibt daneben, wie es ist —
 * Gate und Runner lesen allein dieses Feld. Ein abgebrochener steht dort `rot`, ein nicht
 * gelaufener `nicht gestartet`; beides ist nicht gruen.
 */
function ausgaengeSetzen(stand) {
  for (const e of stand.laufen) {
    const { gewackelt } = e;
    [e.ausgang, e.ausgangGrund] = ausgangVon(e, stand);
    // `gewackelt` bleibt hinten (Issue #1396, E5).
    if (gewackelt) {
      delete e.gewackelt;
      e.gewackelt = gewackelt;
    }
  }
}

/** `[ausgang, grund]` eines Eintrags am Ende des Laufs. */
function ausgangVon(e, stand) {
  const [bestanden, rot, ohneErgebnis, nichtGelaufen] = AUSGAENGE;
  if (e.ergebnis === "gruen") return [bestanden, t("ausgangBestanden")];
  if (e.haengend) return [ohneErgebnis, t("ausgangHaengend", { haengt: haengendText(e.haengend.grenzeMs) })];
  if (e.ergebnis === "rot") return [rot, t(e.wiederholt ? "ausgangRotWiederholt" : "ausgangRot")];
  if (stand.obergrenze) return [nichtGelaufen, t("ausgangObergrenze")];
  return [nichtGelaufen, t(stand.teillauf ? "teillauf" : "ausgangNachRot")];
}

/**
 * Ob der Lauf nach einem Rot weiterprueft (Issue #2133, #2089, Plan #2087, A1; #2079,
 * Kriterium 1): in der Push-Stufe und im Integrationslauf. Der Abschluss eines Pakets hoert
 * beim ersten Fund auf (Kriterium 2), der Hotfix ebenso (Nicht-Ziel Hotfix); `merge` bleibt
 * unveraendert (E3).
 */
function weiterNachRotIn(auswahl) {
  if (auswahl.abschluss || auswahl.hotfix) return false;
  return Boolean(auswahl.integration) || auswahl.stufe === "push";
}

/** `formatFixCommand` aus der Config, getrimmt, oder `null`, wenn keines gesetzt ist. */
function formatFixKommando() {
  return configKommando("formatFixCommand");
}

/** Ein Kommando-Feld der Config, getrimmt, oder `null`, wenn keines gesetzt ist. */
function configKommando(feld) {
  const wert = ladeConfig()[feld];
  return typeof wert === "string" && wert.trim() !== "" ? wert.trim() : null;
}

/**
 * `mutationCommand`, wenn der Lauf ihn faehrt (Issue #1673, Plan #1671, E3): allein an der
 * Stufe `push`, nie an der Paketstufe und nie an `merge`, und an `push` nicht, wenn die Strenge
 * ihn ausschaltet und nichts nachgeholt wird. Sonst `null`.
 */
function mutationFaellig(auswahl) {
  // Mit `--part` faehrt ihn allein der letzte Teil (Issue #2188, Plan #2176, E13).
  if (auswahl.teil && auswahl.teil.nummer !== auswahl.teil.von) return null;
  return mutationDerStufe(auswahl);
}

/** `mutationCommand`, wenn die Stufe ihn faehrt, gleich in welchem Teil; sonst `null`. */
function mutationDerStufe(auswahl) {
  // Der Integrationslauf traegt die Stufe nur intern (Issue #1982, E5): kein Mutationstest.
  if (auswahl.stufe !== "push" || auswahl.integration) return null;
  // `mutation aus` laesst ihn weg (Issue #2107, Plan #2102, A4), ausser beim Nachholen (A7, A9).
  if (!auswahl.nachholen && auswahl.strenge?.mutation === "aus") return null;
  return configKommando("mutationCommand");
}

/**
 * Die Markdown-Tabelle der Dauern je Pruefung (Issue #2189, Plan #2176, E6): Ueberschrift mit
 * Stufe und Teil, je Pruefung Ergebnis und Dauer, die laengste zuerst, nicht gemessene zuletzt,
 * darunter die Summe. Die Dauer steht wie in der Zeile `gelaufen:`, damit beide vergleichbar sind.
 */
export function dauerTabelle({ stufe, teil = null, laufen = [] }) {
  const dauer = (e) => (typeof e.dauerMs === "number" ? e.dauerMs : -1);
  const sortiert = laufen.map((e, i) => ({ e, i })).sort((x, y) => dauer(y.e) - dauer(x.e) || x.i - y.i).map((x) => x.e);
  const kopf = t("dauerTabelleKopf", { stufe }) + (teilText(teil) ? t("dauerTabelleTeil", { teil: teilText(teil) }) : "");
  const zeilen = [`### ${kopf}`, "", t("dauerTabelleSpalten"), "| --- | --- | ---: |"];
  for (const e of sortiert) {
    const cmd = String(e.cmd).replaceAll("|", String.raw`\|`);
    zeilen.push(`| \`${cmd}\` | ${e.ergebnis} | ${dauerText(typeof e.dauerMs === "number" ? e.dauerMs : null)} |`);
  }
  zeilen.push(`| **${t("dauerTabelleSumme")}** | | **${dauerText(dauerGesamt(laufen))}** |`);
  return `${zeilen.join("\n")}\n\n`;
}

/**
 * Haengt die Tabelle der Dauern an `pfad` an — die einzige Stelle, die sie schreibt. Gelesen wird
 * die Zusammenfassung dieses Laufs. Ein leerer Pfad und ein Schreibfehler geben eine Warnzeile
 * und lassen Exitcode und Ergebnis des Laufs unberuehrt.
 */
function dauerTabelleAnhaengen(pfad, basis, args) {
  try {
    if (pfad === "") throw new Error(t("dauerTabellePfadLeer"));
    let daten = {};
    try {
      daten = JSON.parse(readFileSync(join(wurzel(), SUMMARY_DATEI), "utf-8"));
    } catch { /* ohne Zusammenfassung: leere Tabelle */ }
    const stufe = daten.stufe ?? args.stufe ?? STUFEN[0];
    appendFileSync(resolve(basis, pfad), dauerTabelle({ stufe, teil: daten.teil ?? args.teil ?? null, laufen: daten.laufen ?? [] }), "utf-8");
  } catch (err) {
    aufStderr(`${t("dauerTabelleNichtGeschrieben", { pfad, grund: err.message })}\n`);
  }
}

/**
 * `run` mit der Tabelle der Dauern danach (Issue #2189). Der Pfad wird gegen das Verzeichnis des
 * Aufrufs aufgeloest, nicht gegen `--in`; der Exitcode bleibt der des Laufs.
 */
function runAufrufen(rest) {
  const aufruf = wurzel();
  const { dauerTabelle: tabellenPfad, ...args } = parseArgs(rest);
  const code = ausfuehren(arbeitsverzeichnisSetzen(args));
  if (tabellenPfad === undefined) return code;
  return Promise.resolve(code).then((c) => {
    dauerTabelleAnhaengen(tabellenPfad, aufruf, args);
    return c;
  });
}

/** Der Teil als `i/n` (Issue #2188), ohne Teil `null`. */
function teilText(teil) {
  return teil && typeof teil === "object" ? `${teil.nummer}/${teil.von}` : null;
}

/**
 * Die Zeilen eines Teils (Issue #2188, Plan #2176, E13): ein leerer Teil sagt, dass er leer ist,
 * und ein Teil vor dem letzten nennt den Mutationstest der Stufe mit dem Teil, der ihn faehrt.
 */
function teilZeilen(auswahl) {
  if (!auswahl.teil) return [];
  const zeilen = auswahl.laufen.length === 0 ? [t("teilLeer", { teil: teilText(auswahl.teil) })] : [];
  const mutationCmd = mutationDerStufe(auswahl);
  if (mutationCmd !== null && mutationFaellig(auswahl) === null) {
    zeilen.push(t("mutationInTeil", { cmd: mutationCmd, teil: `${auswahl.teil.von}/${auswahl.teil.von}` }));
  }
  return zeilen;
}

/**
 * Die Zeile des Mutationstests mit dem Platzhalter `{files:<Ausdruck>}` (Issue #2051, Plan #2038,
 * E1). Mit `--hotfix` traegt er die Dateien seit `--since` unter dem Ausdruck, unabhaengig von
 * `--finish`; liegt unter einem Platzhalter keine, ist das Ergebnis `null`, und der Test
 * entfaellt mit Grund. Ohne `--hotfix` und ohne aufloesbaren Anker steht der Ausdruck selbst
 * da — die sichere Richtung, wie bei `ausdruckEinsetzen`. Ohne Platzhalter bleibt die Zeile.
 * `dateienEinsetzen` fuer die `buildChecks` bleibt davon unberuehrt.
 */
function mutationEinsetzen(cmd, auswahl) {
  if (!cmd.includes("{files:")) return cmd;
  if (!auswahl.hotfix || auswahl.vollerUmfang) return ausdruckEinsetzen(cmd);
  let leer = false;
  const zeile = cmd.replaceAll(DATEI_PLATZHALTER, (_, ausdruck) => {
    const dateien = dateienUnter(ausdruck, auswahl.geaendert);
    if (dateien.length === 0) leer = true;
    return dateien.map(shellPfad).join(" ");
  });
  return leer ? null : zeile;
}

/** Ob der Mutationstest wegen eines roten Laufs entfaellt (Issue #1673): nur, wo er faellig waere. */
function mutationEntfaellt(auswahl, rot) {
  return rot && mutationFaellig(auswahl) !== null;
}

/**
 * `mutationGuete` der Config als `{ muster, marke }` (Issue #2108, Plan #2102, A6), oder `null`,
 * wenn das Projekt keine Marke fuer den Mutationstest gesetzt hat.
 */
function mutationMarke() {
  const guete = ladeConfig().mutationGuete;
  if (guete === null || typeof guete !== "object") return null;
  return typeof guete.muster === "string" && typeof guete.marke === "number" ? { muster: guete.muster, marke: guete.marke } : null;
}

/**
 * Die Marke, wenn der Mutationstest dieses Laufs anhaelt — `mutation halt` aus der Strenge und
 * eine gesetzte Marke —, sonst `null` (Issue #2108; #2100, Kriterium 5): Ohne Marke haelt er
 * nicht an, die Luecke nennt `strengeLueckeZeilen`.
 */
function mutationHaltMarke(auswahl) {
  return auswahl.strenge?.mutation === "halt" ? mutationMarke() : null;
}

/** Ob ein gefahrener Mutationstest den Lauf anhaelt: haltend und rot (Issue #2108). */
function mutationHaeltAn(mutation) {
  return mutation?.haelt === true && mutation.ergebnis === "rot";
}

/**
 * Faehrt den Mutationstest einmal (Issue #1673, E3) — die Obergrenze ist seine Abbruchgrenze —
 * und gibt `{ cmd, ergebnis, exit, dauerMs }` zurueck. Abgebrochen ist er rot, `exit` dann `null`.
 *
 * Mit Marke (`guete`, Issue #2108, Plan #2102, A6) wertet `gueteAuswerten` seine Ausgabe aus,
 * dieselbe Wertung wie bei der Guetemessung, und das Feld traegt `anteil`, `marke`, `erfuellt`
 * und `grund`. Endet er mit Exit ungleich 0 oder abgebrochen, wird nichts ausgewertet — ein
 * Ausfall, wie bei `gueteErgebnis`. Haelt er an (`haelt`), ist er unter der Marke und beim
 * Ausfall rot und traegt `haelt: true`; sonst bleibt `ergebnis` beim Rueckgabewert.
 */
async function mutationFahren(cmd, env, grenzeMs, { guete = null, haelt = false } = {}) {
  const start = haelt && guete !== null ? t("mutationStartHalt", { marke: guete.marke }) : t("mutationStart");
  aufStdout(`\n$ ${cmd} — ${start}\n`);
  const beginn = process.hrtime.bigint();
  const lauf = await kommandoAusfuehren(cmd, env, { grenzeMs, fristMs: haengenFristMs(env) });
  const dauerMs = Math.round(Number(process.hrtime.bigint() - beginn) / 1e6);
  aufStdout(lauf.haengend ? `${lauf.ausgabe}${haengendText(grenzeMs)}\n` : lauf.ausgabe);
  const mutation = { cmd, ergebnis: lauf.gruen ? "gruen" : "rot", exit: lauf.code, dauerMs };
  if (guete !== null) {
    const wie = lauf.code === null ? t("ohneRueckgabewert") : `Exit ${lauf.code}`;
    const auswertung = lauf.gruen
      ? gueteAuswerten(guete, lauf.ausgabe)
      : { anteil: null, erfuellt: false, grund: t("mutationAusfall", { wie }) };
    Object.assign(mutation, { anteil: auswertung.anteil, marke: guete.marke, erfuellt: auswertung.erfuellt, grund: auswertung.grund });
    if (haelt) {
      mutation.haelt = true;
      if (!auswertung.erfuellt) mutation.ergebnis = "rot";
    }
  }
  aufStdout(`-> ${mutation.ergebnis}\n`);
  return mutation;
}

/** Das Feld `mutation` einer frueheren Zusammenfassung, sonst `undefined`. */
function mutationFeld(daten) {
  return daten.mutation && typeof daten.mutation === "object" ? daten.mutation : undefined;
}

/** Die Berichtszeile des Mutationstests (Issue #1673): sein Ergebnis oder sein Wegfall. */
function mutationZeilen(mutation, entfallen) {
  if (entfallen) return [t("mutationAusgelassen")];
  if (!mutation) return [];
  if (mutation.ausgelassen === true) return [t("mutationOhneDatei", { cmd: mutation.cmd })];
  const wie = mutation.exit === null ? t("ohneRueckgabewert") : `Exit ${mutation.exit}`;
  const felder = { cmd: mutation.cmd, ergebnis: mutation.ergebnis, wie, dauer: dauerText(mutation.dauerMs) };
  if (typeof mutation.marke !== "number") return [t("mutationZeile", felder)];
  // Mit Marke (Issue #2108): Wert und Marke, dahinter, ob er berichtet, genuegt oder anhaelt.
  const haelt = mutation.haelt === true;
  let wert;
  if (mutation.anteil === null) wert = t("mutationOhneWert", { grund: mutation.grund, marke: mutation.marke });
  else wert = t(haelt && !mutation.erfuellt ? "mutationWertUnter" : "mutationWert", { anteil: mutation.anteil, marke: mutation.marke });
  let folge = t("mutationFolgeBericht");
  if (haelt) folge = t(mutation.erfuellt ? "mutationFolgeGenuegt" : "mutationFolgeHalt");
  return [t("mutationZeileWert", { ...felder, wert, folge })];
}

/**
 * Die Luecke der Strenge (Issue #2108, Plan #2102, A6; #2100, Kriterium 5): Verlangt sie die
 * Guetemessung (`guete pflicht`) und fehlt `mutationCommand`, `mutationGuete` oder ein
 * `guete`-Eintrag an einem buildCheck, nennt eine Zeile, was fehlt. Sie haelt nicht an.
 */
function strengeLueckeZeilen(auswahl) {
  if (auswahl.strenge?.guete !== "pflicht") return [];
  const fehlt = [];
  if (configKommando("mutationCommand") === null) fehlt.push(t("lueckeOhneMutation"));
  if (mutationMarke() === null) fehlt.push(t("lueckeOhneMarke"));
  if (!(ladeConfig().buildChecks ?? []).some((c) => normalisiere(c).guete)) fehlt.push(t("lueckeOhneGuete"));
  if (fehlt.length === 0) return [];
  const zeile = strengeModul.strengeZeile(auswahl.strenge, namen ? namen.prozessSprache() : "de");
  return [t("strengeLuecke", { zeile, fehlt: fehlt.join(", ") })];
}

/**
 * Die Berichtszeilen des Nachformatierens (Issue #1672): dass es lief, ob es nicht gereicht
 * hat, und dass seine Aenderungen in den Commit gehoeren. Ohne Fix keine.
 */
function formatFixZeilen(formatFix) {
  if (!formatFix) return [];
  return [
    t("formatFixAusgefuehrt", { cmd: formatFix.cmd }),
    ...(formatFix.gereicht ? [] : [t("formatFixNichtGereicht")]),
    t("berichtHinweis", { text: t("formatFixArbeitsbaum") }),
  ];
}

/**
 * Haengt die Wackler des Teillaufs an die Eintraege des vollen Laufs (Issue #1396, E4) —
 * an jeden, der nicht selbst gewackelt hat.
 */
function wacklerUebernehmen(laufen, wackler) {
  for (const w of wackler) {
    const e = laufen.find((x) => x.cmd === w.cmd);
    if (e && !e.gewackelt) e.gewackelt = w.gewackelt;
  }
}

/** Was hinter `-> ` steht (Issue #1396, E12): nach einer Wiederholung mit beiden Ergebnissen. */
function ausgangText(ergebnis, wiederholt) {
  if (!wiederholt) return ergebnis;
  return ergebnis === "gruen" ? t("gewackeltAusgang") : t("rotWiederholt");
}

// --- CLI -------------------------------------------------------------------

/**
 * Die optionale Kartennummer hinter `--finish` oder `null` (Issue #946).
 *
 * Sie ist OPTIONAL: Der Schalter wirkt auch ohne sie, und ein Aufruf ohne Nummer soll
 * nicht daran scheitern, dass die Auswertung je Karte ihn nicht zuordnen kann. Ein Wert,
 * der keine Nummer ist, ist dagegen ein Fehler — er waere entweder ein vertipptes Flag
 * oder eine Nummer, die niemand je zuordnet. Ein folgendes `--…` ist das naechste Flag
 * und keine fehlende Nummer.
 */
function kartennummer(wert) {
  if (wert === undefined || wert.startsWith("--")) return null;
  if (!/^\d+$/.test(wert)) {
    fail(t("keineKartennummer", { wert }));
  }
  return wert;
}

/**
 * Die Kombinationen, die `--finish` ausschliesst (Issue #946) — geprueft NACH der
 * Schleife, damit die Meldung nicht an der Stellung der Flags haengt. Beides ist ein
 * Fehler und keine stille Wahl:
 *   - `--finish` mit einer Veroeffentlichungsstufe waere zweierlei zugleich (AK 3).
 *     Der Abschluss misst ein Arbeitspaket, `push` und `merge` messen den Stand, der
 *     hinausgeht — und dort laeuft gerade das, was der Abschluss auslaesst.
 *   - `--finish` mit `--area` waere eine doppelte Eingrenzung (E13): Der
 *     Bereichslauf ist der begruendete Gruppenlauf mitten in der Arbeit, nicht der
 *     Abschluss einer Karte. Zusammen liesse sich aus dem Lauf nicht mehr ablesen,
 *     welche der beiden Verkuerzungen eine Pruefung weggelassen hat.
 */
function pruefeKombinationen(args) {
  pruefeIntegration(args);
  pruefeHotfix(args);
  pruefeNachholen(args);
  pruefeReleaseOnly(args);
  if (args.abschluss !== true) return;
  if (args.stufe === "push" || args.stufe === "merge") {
    fail(t("abschlussMitStufe", { stufe: args.stufe, paket: configWert("buildChecks[].stufe", STUFEN[0]) }));
  }
  if (args.bereich !== undefined) {
    fail(t("abschlussMitBereich"));
  }
}

/**
 * Was neben `--integration` nicht stehen darf (Issue #1982, Plan #1969, E5): `--since`, weil
 * der Lauf seinen Nullpunkt selbst als Anker setzt, und jede Eingrenzung — `--stage`,
 * `--area`, `--finish` —, weil er den vollen Umfang der Paketstufe faehrt. Ein Fehler und
 * keine stille Wahl: Wer den Anker vorgibt, meinte einen anderen Lauf.
 */
function pruefeIntegration(args) {
  if (args.integration !== true) return;
  if (args.since !== undefined) fail(t("integrationMitSince"));
  for (const [feld, schalter] of [["stufe", "--stage"], ["bereich", "--area"], ["abschluss", "--finish"]]) {
    if (args[feld] !== undefined) fail(t("integrationMitEingrenzung", { schalter }));
  }
}

/**
 * Was `--hotfix` verlangt (Issue #2051, Plan #2038, E2): `--stage push`, denn verschoben wird
 * allein aus der Push-Auswahl, und keine Eingrenzung mit `--area` — der Hotfix faehrt jede
 * faellige Pruefung ausser den verschobenen. `--finish` und `--integration` schliesst schon die
 * Stufe aus. Ein Fehler und keine stille Wahl: Ohne Stufe liefe die Paketstufe, und der Lauf
 * saehe aus wie der Nachweis eines Hotfix.
 */
function pruefeHotfix(args) {
  if (args.hotfix !== true) return;
  if (args.stufe !== "push") fail(t("hotfixOhnePush"));
  if (args.bereich !== undefined) fail(t("hotfixMitBereich"));
}

/**
 * Was `--catch-up` verlangt (Issue #2107, Plan #2102, A7): `--stage push`, denn nachgeholt wird
 * der Umfang der Veroeffentlichung, und weder `--hotfix` noch `--area` — beide grenzen ein, und
 * das Nachholen faehrt den vollen Umfang. `--finish` und `--integration` schliesst die Stufe aus.
 */
function pruefeNachholen(args) {
  if (args.nachholen !== true) return;
  if (args.stufe !== "push") fail(t("nachholenOhnePush"));
  for (const [feld, schalter] of [["hotfix", "--hotfix"], ["bereich", "--area"]]) {
    if (args[feld] !== undefined) fail(t("nachholenMitEingrenzung", { schalter }));
  }
}

/**
 * Was `--release-only` verlangt (Issue #2249, Plan #2242 E4): `--release-stage` und `--since`,
 * denn ohne Stufe und Basis gibt es keinen Beleg, und keine andere Eingrenzung — der Lauf faehrt
 * den Beleg und die Stufe merge, nichts sonst. `--release-stage` allein ist ein Irrtum.
 */
function pruefeReleaseOnly(args) {
  if (args.releaseOnly !== true) {
    if (args.releaseStufe !== undefined) fail(t("releaseStufeOhneReleaseOnly"));
    return;
  }
  if (args.releaseStufe === undefined || args.since === undefined) fail(t("releaseOnlyOhneStufe"));
  for (const [feld, schalter] of [["stufe", "--stage"], ["bereich", "--area"], ["abschluss", "--finish"], ["hotfix", "--hotfix"], ["nachholen", "--catch-up"], ["integration", "--integration"], ["teil", "--part"]]) {
    if (args[feld] !== undefined) fail(t("releaseOnlyMitEingrenzung", { schalter }));
  }
}

/**
 * Die Schalter ohne Wert, die nur bei `run` wirken: `--fresh` und `--retry` (Issue
 * #1396, E3). Bei `plan` angenommen und ohne Wirkung — kein Fehler dort, weil beide nur in
 * die sichere Richtung zeigen: mehr pruefen.
 */
const NUR_RUN_SCHALTER = { "--fresh": "frisch", "--retry": "wiederholen" };

/**
 * Alle Schalter ohne Wert: dazu `--integration`, der Integrationslauf (Issue #1982, Plan #1969,
 * E5) — Anker und Umfang bestimmt er selbst. Bei `plan` zeigt er dieselbe Auswahl. Ebenso
 * `--hotfix` (Issue #2051, Plan #2038, A2): der verkuerzte Push-Lauf eines Hotfix.
 */
const WERTLOSE_SCHALTER = { ...NUR_RUN_SCHALTER, "--integration": "integration", "--hotfix": "hotfix", "--catch-up": "nachholen", "--release-only": "releaseOnly" };

/**
 * Die frueheren deutschen Namen des Befehls, der Optionen und des Stufenwerts, je Eintrag
 * deutsch -> englisch (Issue #1564, Plan #1548 E5). Seit Version 5 nimmt checks.mjs nur die
 * englischen an; diese Tabellen dienen allein der Meldung, die einen deutschen Namen abweist
 * und den englischen nennt — zum Ausfuehren werden sie nie benutzt.
 */
const ALTE_BEFEHLE = Object.freeze({ bereiche: "areas" });
const ALTE_OPTIONEN = Object.freeze({
  "--stufe": "--stage",
  "--bereich": "--area",
  "--abschluss": "--finish",
  "--frisch": "--fresh",
  "--wiederholen": "--retry",
});
const ALTE_STUFEN = Object.freeze({ paket: "package" });

/** Wirft die Abweisung, wenn `name` ein frueherer deutscher Name aus `tabelle` ist. */
function altnameAbweisen(tabelle, name) {
  if (typeof name === "string" && Object.hasOwn(tabelle, name)) {
    fail(t("altname", { name, englisch: tabelle[name] }));
  }
}

/** Der getippte Wert von `--stage` als Stufe der Config; ein unbekannter Wert bricht ab. */
function stufeLesen(wert) {
  altnameAbweisen(ALTE_STUFEN, wert);
  const stufe = STUFEN.find((s) => stufeGetippt(s) === wert);
  if (stufe === undefined) {
    fail(t("unbekannteStufe", { wert, liste: STUFEN.map(stufeGetippt).join(", ") }));
  }
  return stufe;
}

/** `<i>/<n>` aus `--part` als `{ nummer, von }`; ganze Zahlen mit `1 <= i <= n`, sonst Abbruch. */
function teilLesen(wert) {
  const treffer = /^(\d+)\/(\d+)$/.exec(wert);
  const nummer = treffer ? Number(treffer[1]) : 0;
  const von = treffer ? Number(treffer[2]) : 0;
  if (nummer < 1 || nummer > von) fail(t("teilUngueltig", { wert }));
  return { nummer, von };
}

function parseArgs(rest) {
  const args = {};
  let i = 0;
  while (i < rest.length) {
    altnameAbweisen(ALTE_OPTIONEN, rest[i]);
    const option = rest[i];
    if (option === "--since") {
      // Fehlt der Wert ganz, ist das derselbe Fall wie ein leerer: nicht
      // aufloesbar, also voller Umfang.
      args.since = rest[i + 1] ?? "";
      i += 1;
    } else if (option === "--stage") {
      // Ein unbekannter Wert ist ein Fehler und nicht stillschweigend die
      // Paketstufe (Issue #758): Ein Tippfehler liesse sonst genau die
      // Pruefungen aus, um deren Zeitpunkt es beim Aufruf ging — weniger
      // pruefen, ohne dass es auffaellt. Der fehlende Wert zaehlt wie ein
      // falscher; anders als bei `--since` gibt es hier keine sichere Deutung.
      // Getippt wird der englische Wert, gefahren die Stufe der Config (E5: `package` -> `paket`).
      args.stufe = stufeLesen(rest[i + 1] ?? "");
      i += 1;
    } else if (option === "--area") {
      // Der fehlende Wert zaehlt wie ein falscher (wie bei `--stage`): Die
      // Pruefung gegen `checkAreas` steht in `planen`, wo die Config liegt, und
      // der leere Name faellt dort mit derselben nennenden Meldung durch.
      args.bereich = rest[i + 1] ?? "";
      i += 1;
    } else if (option === "--finish") {
      // Dieser Lauf schliesst genau ein Arbeitspaket ab (Issue #946). Die Kartennummer
      // liest `kartennummer`, samt ihrer Begruendung.
      args.abschluss = true;
      const karte = kartennummer(rest[i + 1]);
      if (karte !== null) {
        args.karte = karte;
        i += 1;
      }
    } else if (option === "--part") {
      // Der Teil der Auswahl (Issue #2188, Plan #2176, E3). Ein fehlender oder falscher Wert
      // bricht ab wie bei `--stage`: Ein still gewaehlter Teil liesse Pruefungen aus.
      args.teil = teilLesen(rest[i + 1] ?? "");
      i += 1;
    } else if (Object.hasOwn(WERTLOSE_SCHALTER, option)) {
      args[WERTLOSE_SCHALTER[option]] = true;
    } else if (option === "--summary-file") {
      // Die Tabelle der Dauern (Issue #2189, Plan #2176, E6). Ein leerer Wert ist kein Abbruch:
      // Er zaehlt nach dem Lauf wie ein Schreibfehler.
      args.dauerTabelle = rest[i + 1] ?? "";
      i += 1;
    } else if (option === "--release-stage") {
      // Die Stufe des lokalen Belegs (Issue #2249, Plan #2242 E4); geprueft im Beleg selbst.
      args.releaseStufe = rest[i + 1] ?? "";
      i += 1;
    } else if (option === "--in") {
      // Das Arbeitsverzeichnis des Laufs (Issue #1372). Ein fehlender oder ungueltiger
      // Wert bricht ab: Der Lauf maesse sonst still den falschen Baum.
      args.in = rest[i + 1] ?? "";
      i += 1;
    } else {
      fail(t("unbekanntesArgument", { arg: rest[i] }));
    }
    i += 1;
  }
  pruefeKombinationen(args);
  return args;
}

/**
 * Setzt das Arbeitsverzeichnis des Laufs auf `--in` (Issue #1372), aufgeloest gegen das
 * bisherige. Alles, was der Lauf liest und schreibt, geht ueber `wurzel()`.
 */
function arbeitsverzeichnisSetzen(args) {
  if (args.in === undefined) return args;
  const ziel = resolve(wurzel(), args.in);
  let istVerzeichnis = false;
  try {
    istVerzeichnis = args.in !== "" && lstatSync(realpathSync(ziel)).isDirectory();
  } catch { /* fehlt -> Fehler unten */ }
  if (!istVerzeichnis) fail(t("keinVerzeichnis", { pfad: args.in }));
  umgebung.cwd = ziel;
  return args;
}

// --- areas suggest und areas compare (Issue #1718, Plan #1713 A1, A10, A13, E11) ------------

const BEREICHE_UNTERBEFEHLE = new Set(["suggest", "compare"]);

// Die Laeufer, deren Vorgabesuche die Testdateien liefert, wenn kein Kommando beurteilbar ist:
// Jest fuer JavaScript und TypeScript (`__tests__/`, `*.test.*`, `*.spec.*`), Maven fuer Java.
// Gelesen von derselben Testauswahl wie jedes Kommando der Config, keine zweite Suche.
const VORGABE_LAEUFER = ["jest", "mvn verify"];

/**
 * Ein Eintrag ohne `areas` und ohne `always` — die Stringform und `{ cmd }` — laeuft heute
 * immer, weil ihm noch niemand Bereiche gegeben hat. Genau dafuer ist der Vorschlag da: Er misst
 * ihn, als bekaeme er Bereiche. `always: true` und die spaeteren Stufen bleiben, wie sie sind.
 */
function alsKandidat(eintrag) {
  const objekt = typeof eintrag === "string" ? { cmd: eintrag } : eintrag;
  if (objekt.always === true || objekt.areas?.length > 0) return objekt;
  return { ...objekt, areas: ["(vorschlag)"] };
}

/** Die vereinigten, sortierten Tests der beurteilbaren Urteile. */
function testsDerUrteile(urteile, beurteilbar) {
  return [...new Set(urteile.filter((u) => u.urteil === beurteilbar).flatMap((u) => u.tests))].sort(vergleicheText);
}

/**
 * Die Messung fuer Vorschlag und Abgleich: die Dateien des Arbeitsstands, je Test die geladenen
 * und genannten Dateien und je Eintrag von `buildChecks` das Urteil der Testauswahl. Gemessen
 * werden die Tests der beurteilbaren Kommandos; gibt es keines, die der Vorgabe-Laeufer, deren
 * Ordner dann die Gruppen sind (A7). Bricht die Messung ab, wird jedes beurteilbare Kommando
 * „nicht beurteilbar" mit dem Grund — ein Abbruch ist nie eine Entwarnung (Kriterium 8).
 */
function bereichsmessung(config, { verflechtung, testauswahl }, { vorschlag }) {
  const repoRoot = wurzel();
  const { URTEIL } = testauswahl;
  const eintraege = config.buildChecks ?? [];
  let dateien;
  try {
    dateien = verflechtung.imArbeitsstand(repoRoot);
  } catch (error) {
    const grund = t("messungAbgebrochen", { grund: error.message });
    return { dateien: [], tabelle: new Map(), kommandos: eintraege.map(() => ({ urteil: URTEIL.nichtBeurteilbar, grund, tests: [] })) };
  }
  const urteilVon = (eintrag) => testauswahl.testsVon(eintrag, { repoRoot, dateien });
  const kommandos = eintraege.map((eintrag) => urteilVon(vorschlag ? alsKandidat(eintrag) : eintrag));
  let testdateien = testsDerUrteile(kommandos, URTEIL.beurteilbar);
  if (testdateien.length === 0 && vorschlag) {
    testdateien = testsDerUrteile(VORGABE_LAEUFER.map((cmd) => urteilVon(alsKandidat(cmd))), URTEIL.beurteilbar);
  }
  const nurGeruest = (config.nurGeruest ?? []).map((eintrag) => (typeof eintrag === "string" ? eintrag : eintrag.muster));
  try {
    return { dateien, tabelle: verflechtung.verflechtungErheben({ repoRoot, nurGeruest, testdateien }), kommandos };
  } catch (error) {
    const grund = t("messungAbgebrochen", { grund: error.message });
    const ohneMessung = (k) => (k.urteil === URTEIL.beurteilbar ? { ...k, urteil: URTEIL.nichtBeurteilbar, grund, tests: [] } : k);
    return { dateien, tabelle: new Map(), kommandos: kommandos.map(ohneMessung) };
  }
}

/**
 * `areas suggest [--json]` und `areas compare [--json]`: Vorschlag oder Abgleich der
 * Pruefbereiche, als Text in der Projektsprache oder mit `--json` dieselben Daten. Beide aendern
 * nichts und enden immer mit Exit 0 (A10). Die Teile unter `checks/` laedt erst dieser Aufruf,
 * dynamisch (A1): Ein `checks.mjs`, das allein in einem Projekt liegt, laeuft fuer `plan`, `run`
 * und `areas` weiter.
 */
/**
 * Laedt den Vergleich der Pruefbereiche aus `checks/abgleich.mjs`, dynamisch wie die anderen
 * Teile unter `checks/` (A1). Er gehoert seit Issue #2012 zu Community (Plan #2008 A1) und
 * kommt nicht mehr ueber den Lader der Pro-Teile; ein Ladefehler geht weiter.
 */
function abgleichLaden() {
  return import("./checks/abgleich.mjs");
}

async function bereicheRechnen(unterbefehl, rest) {
  for (const arg of rest) if (arg !== "--json") fail(t("unbekanntesArgument", { arg }));
  const vorschlag = unterbefehl === "suggest";
  const config = ladeConfig({ ohneDateiLeer: vorschlag });
  const rechnung = vorschlag ? await import("./checks/bereiche.mjs") : await abgleichLaden();
  await bereicheAusgeben(config, { rechnung, vorschlag }, rest.includes("--json"));
  return 0;
}

/**
 * Misst und gibt Vorschlag oder Abgleich aus, als Text oder JSON. `rechnung` ist das Modul, das
 * rechnet (`checks/bereiche.mjs` fuer den Vorschlag, `checks/abgleich.mjs` fuer den Abgleich).
 */
async function bereicheAusgeben(config, { rechnung, vorschlag }, json) {
  const [verflechtung, testauswahl] = await Promise.all([
    import("./checks/verflechtung.mjs"),
    import("./checks/testauswahl.mjs"),
  ]);
  const messung = bereichsmessung(config, { verflechtung, testauswahl }, { vorschlag });
  const ergebnis = vorschlag ? rechnung.vorschlagErheben(config, messung) : rechnung.abgleichErheben(config, messung);
  if (json) aufStdout(rechnung.alsJson(ergebnis));
  else aufStdout(vorschlag ? rechnung.vorschlagText(ergebnis) : rechnung.abgleichText(ergebnis));
}

/**
 * Die Testhilfe-Ordner aus Plan #1713 A4 auf jeder Ebene, damit auch `**\/src/test/` (E7) —
 * dieselbe Regel wie die Durchgangsstationen in `checks/verflechtung.mjs`.
 */
const TESTORDNER = /(?:^|\/)(?:test|tests|__tests__)\//;

/**
 * Die gemessenen Tests, die eine geaenderte Testhilfe ueber Importe erreichen (E1): rueckwaerts
 * durch die Importeure, bis zu jedem Test der Tabelle. Die Suche liest JavaScript-Importe wie die
 * Ableitung aus Importen; scheitert sie, erreicht die Hilfe keinen Test.
 */
function testsUeberHilfen(hilfen, tests) {
  if (hilfen.length === 0) return [];
  const importeure = importeureErheben() ?? new Map();
  const erreicht = new Set();
  const besucht = new Set(hilfen);
  const offen = [...hilfen];
  while (offen.length > 0) {
    for (const importeur of importeure.get(offen.shift()) ?? []) {
      if (besucht.has(importeur)) continue;
      besucht.add(importeur);
      if (tests.has(importeur)) erreicht.add(importeur);
      offen.push(importeur);
    }
  }
  return [...erreicht];
}

/** Laedt die drei Teile des Abgleichs; ein Ladefehler wirft (Issue #2233). */
async function abgleichTeileLaden() {
  const verflechtung = await import("./checks/verflechtung.mjs");
  const testauswahl = await import("./checks/testauswahl.mjs");
  const abgleich = await abgleichLaden();
  return { verflechtung, testauswahl, abgleich, ladefehler: null };
}

/**
 * Der Abgleich der Pruefbereiche im Prueflauf eines Pakets (Issue #1719, Plan #1713 A11, E1,
 * E2, E7). Liefert das Feld `bereichsabgleich` oder `null`, wenn kein Abgleich laeuft: an `push`
 * und `merge` nie, an der Paketstufe nur, wenn das Paket eine
 * Testdatei angelegt oder geaendert hat — eine, die ein Kommando faehrt, oder eine unter den
 * Testhilfe-Ordnern (E7).
 *
 * Abgeglichen werden nur die geaenderten Tests und die, die eine geaenderte Testhilfe erreichen
 * (E1); „zu viel" meldet der Prueflauf nicht (E2). Der Abgleich haelt nie an: Jeder Fehler,
 * auch ein Ladefehler der Teile unter `checks/`, wird zu `fehler` und aendert weder Farbe noch
 * Exit-Code. Ohne die Teile laesst sich ein Test nur am Ordner erkennen; ein Ladefehler zaehlt
 * darum nur, wenn ein geaenderter Pfad dort liegt — sonst stuende er in jedem Paket.
 */
async function bereichsabgleichErheben(auswahl) {
  if (auswahl.stufe !== STUFEN[0]) return null;
  const imOrdner = auswahl.geaendert.filter((p) => TESTORDNER.test(p));
  const mitFehler = (fehler) => ({ luecken: [], nichtBeurteilbar: [], fehler: fehler.message });
  // Die drei Teile einzeln benannt (Issue #2233): Nach dem `catch` ist jedes gesetzt, und die
  // statische Analyse sieht das, was sie bei der Zerlegung eines Arrays nicht sah.
  const geladen = await abgleichTeileLaden().catch((error) => ({ ladefehler: error }));
  if (geladen.ladefehler) return imOrdner.length > 0 ? mitFehler(geladen.ladefehler) : null;
  const { verflechtung, testauswahl, abgleich } = geladen;
  try {
    const config = ladeConfig();
    const messung = bereichsmessung(config, { verflechtung, testauswahl }, { vorschlag: false });
    const gefahren = new Set(messung.kommandos.flatMap((k) => k.tests ?? []));
    const testdateien = auswahl.geaendert.filter((p) => TESTORDNER.test(p) || gefahren.has(p));
    if (testdateien.length === 0) return null;
    const gemessen = new Set(messung.tabelle.keys());
    const hilfen = testdateien.filter((p) => !gemessen.has(p));
    const nurTests = [...testdateien.filter((p) => gemessen.has(p)), ...testsUeberHilfen(hilfen, gemessen)];
    const { luecken, nichtBeurteilbar } = abgleich.abgleichErheben(config, messung, { nurTests });
    return { luecken, nichtBeurteilbar, fehler: null };
  } catch (error) {
    return mitFehler(error);
  }
}

/** Der Block des Abgleichs auf der Konsole: je Luecke eine Zeile, dazu ein Fehler; sonst nichts. */
function bereichsabgleichMelden(bereichsabgleich) {
  if (!bereichsabgleich) return;
  const zeilen = [
    ...(bereichsabgleich.fehler ? [t("bereichsabgleichFehler", { grund: bereichsabgleich.fehler })] : []),
    ...(bereichsabgleich.luecken ?? []).map((l) => t("bereichsabgleichLuecke", l)),
  ];
  if (zeilen.length > 0) aufStdout(`\n${t("bereichsabgleichKopf")}\n${zeilen.join("\n")}\n`);
}

// --- release-only (Issue #2248, Plan #2242 A1 bis A4, E3) ------------------------------------

/** Die Optionen von `release-only` mit ihrem Feld. */
const RELEASE_ONLY_OPTIONEN = Object.freeze({ "--base": "basis", "--head": "kopf", "--merge-ref": "merge" });

/**
 * `release-only [--base <sha>] [--head <sha>] [--merge-ref <ref>] [--json]`: der Beleg der
 * Release-Ableitung aus `checks/release.mjs` fuer den Build-Dienst. Exit 0 nur bei `belegt: true`.
 * Den Code-Host loest erst die Frage nach dem Urteil auf: Ein Beleg, der schon an Stufe, Version
 * oder Baum scheitert, fragt ihn nie. Der Teil unter `checks/` gehoert zu Pro (Achse `card-check`);
 * fehlt er, endet der Aufruf mit einer Meldung.
 */
async function releaseOnly(rest) {
  const werte = { basis: "HEAD^", kopf: "HEAD", merge: null };
  let json = false;
  if (rest.includes("--decide")) return kurzwegAufrufen(rest);
  for (let i = 0; i < rest.length; i += 1) {
    const feld = RELEASE_ONLY_OPTIONEN[rest[i]];
    if (rest[i] === "--json") json = true;
    else if (feld && rest[i + 1] !== undefined) werte[feld] = rest[++i];
    else fail(t("unbekanntesArgument", { arg: rest[i] }));
  }
  // Fehlen ist erlaubt (Community), kaputt sein nicht: Nur ein fehlendes Modul wird zur Meldung.
  const release = await import("./checks/release.mjs").catch((err) => (err?.code === "ERR_MODULE_NOT_FOUND" ? null : Promise.reject(err)));
  if (!release) fail(t("releaseOnlyOhnePro"));
  const config = ladeConfig({ ohneDateiLeer: true });
  const host = verzoegerterHost(config);
  const repoRoot = wurzel();
  const ergebnis = werte.merge === null
    ? await release.releaseAbleitung({ repoRoot, basis: werte.basis, kopf: werte.kopf, host })
    : await release.vorschlagBeleg({ repoRoot, merge: werte.merge, kopf: werte.kopf, host });
  if (json) aufStdout(JSON.stringify(ergebnis, null, 2) + "\n");
  else aufStdout(`${ergebnis.grund}\n`);
  return ergebnis.belegt ? 0 : 1;
}

/**
 * Der Code-Host, erst bei der Frage nach dem Urteil aufgeloest: Ein Aufruf, der vorher scheitert,
 * fragt ihn nie.
 */
function verzoegerterHost(config) {
  let geloest = null;
  return {
    getCiStatus: async (...args) => {
      geloest ??= (await import(new URL("./board/adapter.mjs", import.meta.url).href)).resolveCodeHost(config);
      return geloest.getCiStatus(...args);
    },
  };
}

/**
 * `release-only --decide [--json]` (Issue #2249, Plan #2242 A8, A9): ob `merge production` den
 * kurzen Weg gehen darf. Der Skill liest nur das Ergebnis; die Bedingungen stehen in
 * `kurzwegEntscheiden` (checks/release.mjs). Exit 0 nur bei `kurzweg: true`.
 */
async function kurzwegAufrufen(rest) {
  let json = false;
  for (const arg of rest) {
    if (arg === "--json") json = true;
    else if (arg !== "--decide") fail(t("releaseOnlyDecideArgument", { arg }));
  }
  const release = await import("./checks/release.mjs").catch((err) => (err?.code === "ERR_MODULE_NOT_FOUND" ? null : Promise.reject(err)));
  if (!release) fail(t("releaseOnlyOhnePro"));
  const config = ladeConfig({ ohneDateiLeer: true });
  const repoRoot = wurzel();
  const ausgabeModul = await import(new URL("./board/ausgabe.mjs", import.meta.url).href).catch(() => null);
  const pro = ausgabeModul === null ? true : ausgabeModul.ausgabe({ wurzel: repoRoot }) !== "community";
  const ergebnis = await release.kurzwegEntscheiden({ repoRoot, config, host: verzoegerterHost(config), pro });
  if (json) aufStdout(JSON.stringify(ergebnis, null, 2) + "\n");
  else aufStdout(`${ergebnis.grund}\n`);
  return ergebnis.kurzweg ? 0 : 1;
}

/** Die Befehle, die ihre Argumente unveraendert an eine Funktion geben. */
const EINFACHE_BEFEHLE = Object.freeze({ run: runAufrufen, "release-only": releaseOnly });

/**
 * Rueckgabe: der Exitcode — fuer `run`, `areas suggest` und `areas compare` als Promise
 * (Issue #1070, #1718), fuer `plan` und `areas` wie bisher als Zahl.
 */
function main(argv = process.argv.slice(2)) {  // NOSONAR S3800: Zahl oder Promise mit Absicht, siehe oben
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    aufStdout(hilfe());
    return 0;
  }

  const [command, ...rest] = argv;
  altnameAbweisen(ALTE_BEFEHLE, command);
  if (command === "plan") {
    // `--retry` wirkt nur bei `run` (Issue #1396, E3): Die Auswahl von `plan` bleibt dieselbe.
    const { wiederholen, ...args } = parseArgs(rest);
    const ausgeben = (auswahl) => {
      aufStdout(JSON.stringify(auswahl, null, 2) + "\n");
      return 0;
    };
    // Mit `--finish` waehlt die Auswahl nach Tests und kommt als Promise (Issue #1980).
    const auswahl = planen(arbeitsverzeichnisSetzen(args));
    return auswahl instanceof Promise ? auswahl.then(ausgeben) : ausgeben(auswahl);
  }
  if (Object.hasOwn(EINFACHE_BEFEHLE, command)) return EINFACHE_BEFEHLE[command](rest);
  if (command === "integration") {
    // Nur `--in` vorweg (Issue #1982): jedes andere Argument ist ein Irrtum.
    const stelle = rest.indexOf("--in");
    const ohneIn = stelle === -1 ? rest : rest.filter((_, i) => i !== stelle && i !== stelle + 1);
    if (stelle !== -1) arbeitsverzeichnisSetzen({ in: rest[stelle + 1] ?? "" });
    return integrationAusgeben(ohneIn);
  }
  if (command === "areas") {
    if (BEREICHE_UNTERBEFEHLE.has(rest[0])) return bereicheRechnen(rest[0], rest.slice(1));
    // Kein Argument: Anteil und Inventar gelten fuer die Config und den versionierten
    // Stand, nicht fuer einen Anker. Jedes andere Argument ist ein Irrtum (E11).
    if (rest.length > 0) fail(t("unbekanntesArgument", { arg: rest[0] }));
    aufStdout(JSON.stringify(bereicheAuswerten(), null, 2) + "\n");
    return 0;
  }

  aufStdout(hilfe());
  return fail(t("unbekannterBefehl", { befehl: command }));
}

// Nur als CLI ausfuehren, nicht beim Import (z. B. durch die node:test-Suite, #135).
// realpathSync statt resolve: Node loest fuer import.meta.url Symlinks auf (macOS:
// /var -> /private/var), ein nur normalisierter argv[1] wuerde dann nie matchen (#146).
let runAsCli = false;
if (process.argv[1]) {
  try {
    runAsCli = realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch { /* argv[1] nicht aufloesbar -> kein CLI-Start */ }
}
if (runAsCli) {
  // Ohne await auf oberster Ebene (Issue #1718): Die Teile unter checks/ importieren
  // checks.mjs zurueck. Wartete dieses Modul auf `main`, wartete deren dynamischer Import auf
  // das Ende dieses Moduls — beide warteten fuer immer.
  // exitCode statt process.exit: `run` faerbt den Lauf rot, ohne ihn abzuschneiden.
  Promise.resolve()
    .then(() => main())
    .then((code) => {  // eslint-disable-line unicorn/prefer-top-level-await -- NOSONAR S7785: await auf oberster Ebene verklemmte den Import der Teile unter checks/
      process.exitCode = code;
    }, (err) => {
      fehlerMelden(err);
      process.exit(1);
    });
}
