// SPDX-License-Identifier: MIT
/**
 * board/adapter.mjs — die Adapter des Board-Werkzeugs (Issue #1217, Plan #1199, E17):
 * GitHub, CI-Status, GitLab, Local, Toolbox und die Adapter-Auswahl.
 *
 * Ein Teil von kit/board.mjs. Der Einstieg laedt ihn erst nach der Auskunft ueber
 * --version und --help und exportiert seine Namen unveraendert weiter. Dieser Teil
 * importiert nie aus dem Einstieg: Der Einstieg laedt die Teile, ein Rueckimport waere
 * ein Zyklus.
 *
 * Der Runner laedt diesen Teil als Nachbarn ueber einen nicht literalen Pfad
 * (NACHBAR_DIR, #498) fuer TOOLBOX_BUDGET_NACHT_MS. Die Importanalyse sieht das nicht;
 * die Kopplung steht darum von Hand in den `areas` der Pruefkommandos (E3).
 *
 * Bewusst ohne eigene KIT_VERSION (Plan #1199, E19): Die Teile kommen im selben
 * Verzeichnis-Blob wie der Einstieg und werden nie einzeln verteilt.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

import { VALID_STATUSES, columnLabels, isStateColumn, execJSON, exec, gitRemoteUrl, normalizeRepoName,
  RUECKMELDUNG, BoardError, fail, sleep, labelNamesFrom, labelMapFrom, withLabels, normalizeComments,
  labelToStatus, createdFrom } from "./grundlagen.mjs";
import { toolboxBudgetMs, toolboxVersuchMs, proxyGesetzt, proxyHinweis, netzfehlerArt, darfWiederholen,
  rueckmeldungFuer, wartezeitMs, VERLAUF_GLEICHZEITIG, hoechstensGleichzeitig, wiederholKommando } from "./wiederholung.mjs";
import { text } from "./namen.mjs";
import { normalisiereConfig } from "./config-namen.mjs";
import { strengeVorgaben } from "./strenge.mjs";

// Das Budget unbeaufsichtigter Board-Aufrufe steht im Teil wiederholung. Der Runner
// holt es von hier (Issue #1217): Fuer ihn ist dieser Teil die Adresse der Adapter.
export { TOOLBOX_BUDGET_NACHT_MS } from "./wiederholung.mjs";

// Die Texte an den Menschen liegen unter kit/texte/board-adapter.mjs (Issue #1526).
import { TEXTE } from "../texte/board-adapter.mjs";

export { TEXTE };

/** Ein Text dieses Teils in der Projektsprache (Issue #1480, E13). */
const t = (schluessel, werte) => text(TEXTE, schluessel, werte);

// ============================================================
// Fehlende Labels (Issue #1428, Plan #1420 E6; ohne Rueckfall seit Issue #1552, Plan #1548 E2)
// ============================================================

/**
 * Ein Label fehlt als Definition am Board — der Tracker hat nichts gesetzt. GitHub und das
 * Toolbox-Board melden das so; GitLab legt ein unbekanntes Label beim Setzen selbst an, der
 * lokale Tracker kennt keine Definitionen. Die Meldung bleibt die des Trackers.
 */
export class LabelFehltError extends BoardError {}

// ============================================================
// Einrichtung lesen (Issue #1776, Plan #1767, E5, E8)
// ============================================================

/**
 * `einrichtung()` je Tracker liefert `{ adresse, erreichbar, angemeldet, spalten, labels }`,
 * bei einem Mangel dazu `grund`. Ein Feld traegt seinen Wert, `EINRICHTUNG_ENTFAELLT` (gilt
 * fuer dieses Board nicht) oder `{ nichtPruefbar: <grund> }`. Die Bewertung liegt beim Aufruf
 * `doctor`, nicht hier. Keine der Methoden schreibt, auch nicht in einen Cache.
 */
export const EINRICHTUNG_ENTFAELLT = "entfaellt";

const nichtPruefbar = (grund) => ({ nichtPruefbar: grund });

/** Ein Fehlschlag von `auth status`, der am Weg zum Server liegt und nicht an der Anmeldung (E8). */
const NETZFEHLER_TEXT = /error connecting|could not resolve|no such host|dial tcp|connection (refused|reset)|network is unreachable|timed? ?out|deadline exceeded|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/i;

function einrichtungUnerreichbar(adresse, grund) {
  const offen = nichtPruefbar(grund);
  return { adresse, erreichbar: false, angemeldet: offen, spalten: offen, labels: offen, grund };
}

function einrichtungOhneAnmeldung(adresse, grund, erreichbar = true) {
  const offen = nichtPruefbar(grund);
  return { adresse, erreichbar, angemeldet: false, spalten: offen, labels: offen, grund };
}

/** `<cli> auth status`: null, wenn angemeldet, sonst die fertige Antwort mit dem Mangel. */
function cliAnmeldung(datei, adresse) {
  try {
    exec(datei, ["auth", "status"]);
    return null;
  } catch (e) {
    return NETZFEHLER_TEXT.test(e.message)
      ? einrichtungUnerreichbar(adresse, e.message)
      : einrichtungOhneAnmeldung(adresse, e.message);
  }
}

/** Ein Lesezugriff nach bestandener Anmeldung: sein Wert, oder bei einem Fehlschlag nicht pruefbar. */
function gelesen(lesen) {
  try {
    return lesen();
  } catch (e) {
    return nichtPruefbar(e.message);
  }
}

// ============================================================
// GitHub-Adapter
// ============================================================

export class GitHubIssueTracker {
  constructor(config) {
    this._cfg = config;
    this._repoName = null;
    this._projectId = null;
    this._statusField = null; // { id, options: { [status]: optionId } }
    this._projectNumberCache = null;
  }

  _repo() {
    if (!this._repoName) {
      this._repoName = exec("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
    }
    return this._repoName;
  }

  _owner() {
    return this._repo().split("/")[0];
  }

  // Ohne konfigurierte github.projectNumber wird versucht, die Nummer automatisch zu
  // erkennen: gibt es fuer den Owner genau ein GitHub Project, wird dieses verwendet
  // (mit Hinweis, kein stiller Schreibzugriff auf workflow.config.json). Bei keinem
  // oder mehreren Projects bleibt es beim harten Fehler mit Projekt-Liste. Ergebnis
  // wird pro Prozess memoisiert und die Auto-Erkennung zusaetzlich prozessuebergreifend
  // gecacht (siehe _readAutoProjectNumberCache), damit nicht jeder Aufruf ohne
  // konfigurierte Nummer erneut gh project list kostet.
  _projectNumber() {
    if (this._projectNumberCache) return this._projectNumberCache;

    const configured = this._cfg.github?.projectNumber;
    if (configured) {
      this._projectNumberCache = configured;
      return configured;
    }

    const owner = this._owner();
    const cachedAuto = this._readAutoProjectNumberCache(owner);
    if (cachedAuto) {
      this._projectNumberCache = cachedAuto;
      return cachedAuto;
    }

    const projekt = this._einzigesProjekt(owner);
    const num = projekt.number;
    process.stderr.write(`${t("projektAutomatisch", { num, titel: projekt.title, owner })}\n`);
    this._writeAutoProjectNumberCache(owner, num);
    this._projectNumberCache = num;
    return num;
  }

  /** Das einzige GitHub Project des Owners; bei keinem oder mehreren ein harter Fehler. Schreibt nichts. */
  _einzigesProjekt(owner) {
    const projects = execJSON("gh", ["project", "list", "--owner", owner, "--format", "json"]).projects || [];
    if (projects.length === 1) return projects[0];
    if (projects.length === 0) {
      throw new BoardError(t("projektKeines", { owner }));
    }
    const list = projects.map((p) => `#${p.number} (${p.title})`).join(", ");
    throw new BoardError(t("projektMehrere", { owner, liste: list }));
  }

  /**
   * Die Projektnummer wie `_projectNumber`, aber ohne Cache zu schreiben und ohne Hinweis
   * (Issue #1776, E5): `einrichtung()` darf nichts veraendern.
   */
  _projektNummerLesend() {
    const configured = this._cfg.github?.projectNumber;
    if (configured) return configured;
    const owner = this._owner();
    return this._readAutoProjectNumberCache(owner) || this._einzigesProjekt(owner).number;
  }

  /** Anmeldung, Spalten aus dem Feld Status und Labels des Repos, rein lesend (Issue #1776, E5, E8). */
  async einrichtung() {
    const adresse = gitRemoteUrl();
    const mangel = cliAnmeldung("gh", adresse);
    if (mangel) return mangel;
    return {
      adresse,
      erreichbar: true,
      angemeldet: true,
      spalten: gelesen(() => Object.keys(this._statusFeld(this._projektNummerLesend()).options)),
      labels: gelesen(() => labelNamesFrom(execJSON("gh", ["label", "list", "--json", "name", "--limit", "1000"]))),
    };
  }

  _autoCacheKey(owner) {
    return `${owner}#auto`;
  }

  _readAutoProjectNumberCache(owner) {
    const p = this._metaCachePath();
    if (!existsSync(p)) return null;
    try {
      const all = JSON.parse(readFileSync(p, "utf-8"));
      return all[this._autoCacheKey(owner)]?.projectNumber || null;
    } catch {
      return null;
    }
  }

  _writeAutoProjectNumberCache(owner, num) {
    const p = this._metaCachePath();
    let all = {};
    if (existsSync(p)) {
      try { all = JSON.parse(readFileSync(p, "utf-8")); } catch { all = {}; }
    }
    all[this._autoCacheKey(owner)] = { projectNumber: num };
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(all, null, 2) + "\n");
  }

  // Project-ID, Status-Field-ID und Option-IDs aendern sich praktisch nie. Sie werden
  // deshalb persistent gecacht (.claude/board-meta-cache.json), damit nicht jeder
  // board.mjs-Aufruf zwei GraphQL-Abfragen (gh project list / field-list) kostet — der
  // In-Memory-Cache haelt nur innerhalb eines Prozesses, jeder CLI-Aufruf ist aber neu.
  _metaCachePath() {
    return resolve(".claude", "board-meta-cache.json");
  }

  _metaCacheKey() {
    return `${this._owner()}#${this._projectNumber()}`;
  }

  _readMetaCache() {
    const p = this._metaCachePath();
    if (!existsSync(p)) return null;
    let all;
    try {
      all = JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return null; // korrupte Cache-Datei wie Cache-Miss behandeln
    }
    const entry = all[this._metaCacheKey()];
    if (!entry?.projectId || !entry?.statusField) return null;
    // Bei geaenderten Spalten-Labels ist die Option-Zuordnung veraltet — neu aufbauen.
    if (JSON.stringify(entry.columnLabels) !== JSON.stringify(columnLabels(this._cfg))) return null;
    return entry;
  }

  _writeMetaCache() {
    const p = this._metaCachePath();
    let all = {};
    if (existsSync(p)) {
      try { all = JSON.parse(readFileSync(p, "utf-8")); } catch { all = {}; }
    }
    all[this._metaCacheKey()] = {
      projectId: this._projectId,
      statusField: this._statusField,
      columnLabels: columnLabels(this._cfg),
    };
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(all, null, 2) + "\n");
  }

  _invalidateMetaCache() {
    this._projectId = null;
    this._statusField = null;
    const p = this._metaCachePath();
    if (!existsSync(p)) return;
    try {
      const all = JSON.parse(readFileSync(p, "utf-8"));
      delete all[this._metaCacheKey()];
      writeFileSync(p, JSON.stringify(all, null, 2) + "\n");
    } catch {
      // korrupte Datei: der naechste _writeMetaCache ueberschreibt sie ohnehin
    }
  }

  _ensureProjectMeta() {
    if (this._projectId && this._statusField) return;

    const cached = this._readMetaCache();
    if (cached) {
      this._projectId = cached.projectId;
      this._statusField = cached.statusField;
      return;
    }

    this._loadProjectMetaFromApi();
    this._writeMetaCache();
  }

  _loadProjectMetaFromApi() {
    const owner = this._owner();
    const num = this._projectNumber();

    // Project-ID
    const projectList = execJSON("gh", ["project", "list", "--owner", owner, "--format", "json"]);
    const project = (projectList.projects || []).find((p) => p.number === num);
    if (!project) throw new BoardError(t("projektNichtGefunden", { num, owner }));
    this._projectId = project.id;
    this._statusField = this._statusFeld(num);
  }

  /** Das Feld Status des Projects mit seinen Optionen je Kit-Status. Schreibt nichts. */
  _statusFeld(num) {
    const owner = this._owner();
    const fields = execJSON("gh", ["project", "field-list", String(num), "--owner", owner, "--format", "json"]);
    const statusField = (fields.fields || []).find((f) => f.name === "Status");
    if (!statusField) throw new BoardError(t("statusFeldFehlt", { num }));

    const optionMap = {};
    for (const opt of statusField.options || []) {
      // Normalisiere den Option-Namen auf den Status-Enum
      const labels = columnLabels(this._cfg);
      const key = Object.keys(labels).find(
        (k) => labels[k].toLowerCase() === opt.name.toLowerCase()
      );
      if (key) {
        if (labels[key] !== opt.name) {
          process.stderr.write(`${t("spalteSchreibweise", { status: key, label: labels[key], option: opt.name })}\n`);
        }
        optionMap[key] = opt.id;
      }
    }
    return { id: statusField.id, options: optionMap };
  }

  // Gezielter Lookup der Project-Item-ID fuer genau dieses eine Issue via GraphQL-
  // Einzelabfrage (repository -> issue -> projectItems). Kostet ~1 Kontingentpunkt
  // unabhaengig von der Boardgroesse — statt eines paginierten `gh project item-list`
  // ueber alle bis zu 1000 Items, das je nach Board zweistellige Punktzahlen verbraucht.
  _getProjectItemId(issueNumber) {
    const owner = this._owner();
    const repoName = this._repo().split("/")[1];
    const num = this._projectNumber();
    const number = Number(issueNumber);

    const query = [
      "query($owner:String!,$repo:String!,$number:Int!){",
      "  repository(owner:$owner,name:$repo){",
      "    issue(number:$number){",
      "      projectItems(first:20){",
      "        nodes{",
      "          id",
      "          project{ number owner{ ... on User{ login } ... on Organization{ login } } }",
      "        }",
      "      }",
      "    }",
      "  }",
      "}",
    ].join("\n");

    const data = execJSON("gh", [
      "api", "graphql",
      "-f", `query=${query}`,
      "-f", `owner=${owner}`,
      "-f", `repo=${repoName}`,
      "-F", `number=${number}`,
    ]);

    const issue = data?.data?.repository?.issue;
    if (!issue) throw new BoardError(t("issueNichtImRepo", { id: issueNumber, repo: this._repo() }));

    const nodes = issue.projectItems?.nodes || [];
    const item = nodes.find(
      (n) => n.project?.number === num && n.project?.owner?.login === owner
    );
    if (!item) throw new BoardError(t("issueNichtImBoard", { id: issueNumber, num }));
    return item.id;
  }

  async createIssue({ title, body }) {
    const repo = this._repo();
    const output = exec("gh", ["issue", "create", "--repo", repo, "--title", title, "--body", body || ""]);
    // gh gibt ggf. Hinweiszeilen vor der URL aus — URL und ID per Regex extrahieren
    const match = output.match(/(https?:\/\/\S+\/issues\/(\d+))/);
    if (!match) throw new BoardError(t("ghUrlUnlesbar", { ausgabe: output }));
    const url = match[1];
    const id = match[2];

    // Ans Project Board haengen. _projectNumber() wirft, wenn weder konfiguriert
    // noch eindeutig automatisch erkennbar — dann bleibt die Zuordnung aus (Hinweis).
    try {
      const owner = this._owner();
      const num = this._projectNumber();
      exec("gh", ["project", "item-add", String(num), "--owner", owner, "--url", url]);
      // Status auf backlog setzen. item-list zeigt frisch hinzugefuegte Items
      // teils verzoegert (Eventual Consistency) — daher kurzer Retry.
      let lastErr = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (attempt > 1) await sleep(2500);  // eslint-disable-line no-await-in-loop -- NOSONAR S9382: ein Versuch wartet per Definition auf den vorigen
        try {
          await this.moveIssue(id, "backlog");  // eslint-disable-line no-await-in-loop -- NOSONAR S9382: ein Versuch wartet per Definition auf den vorigen
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (lastErr) throw lastErr;
    } catch (e) {
      process.stderr.write(`${t("boardZuordnungFehlgeschlagen", { grund: e.message })}\n`);
    }
    return { id, url };
  }

  async getIssue(id) {
    const repo = this._repo();
    // createdAt muss ausdruecklich angefordert werden — gh liefert nur die Felder aus
    // dieser Liste, ein Weglassen waere still zu "kein Anlagedatum" geworden (#457).
    const data = execJSON("gh", ["issue", "view", String(id), "--repo", repo, "--json", "number,title,body,state,comments,labels,createdAt"]);
    return {
      id: String(data.number),
      title: data.title,
      body: data.body,
      status: null, // Board-Status nicht im Issue-Objekt, erfordert Project-Abfrage
      labels: labelNamesFrom(data.labels),
      comments: normalizeComments(data.comments),
      ...createdFrom(data.createdAt),
    };
  }

  async listIssues(status) {
    const repo = this._repo();

    if (!status) {
      // `gh issue list` liefert Labels direkt mit, sobald das Feld angefordert wird
      // (verifiziert 2026-07-29, Issue #180).
      const items = execJSON("gh", ["issue", "list", "--repo", repo, "--state", "open", "--json", "number,title,body,labels"]);
      return items.map((i) => ({
        id: String(i.number), title: i.title, body: i.body, status: null, labels: labelNamesFrom(i.labels),
      }));
    }

    // Filterung nach Board-Status via Project
    let num;
    try {
      num = this._projectNumber();
    } catch {
      process.stderr.write(`${t("keinStatusFilter")}\n`);
      return this.listIssues(undefined);
    }

    this._ensureProjectMeta();
    const owner = this._owner();
    const items = execJSON("gh", ["project", "item-list", String(num), "--owner", owner, "--format", "json", "--limit", "1000"]);

    const optionId = this._statusField.options[status];
    if (!optionId) throw new BoardError(t("statusOhneOption", { status }));

    const wantedStatus = githubStatusName(status, this._cfg).toLowerCase();
    // Kein ID-Re-Sort: gh project item-list liefert die manuelle Projekt-Reihenfolge,
    // gefiltert auf eine Spalte ist das die Board-Reihenfolge (oben zuerst, #128).
    const gefiltert = (items.items || [])
      .filter((i) => (i.status || "").toLowerCase() === wantedStatus)
      .map((i) => ({
        id: String(i.content?.number),
        title: i.content?.title,
        body: null,
        status,
        labels: [],
      }));

    return this._mitLabels(gefiltert, repo);
  }

  /**
   * Alle Issues jedes Zustands mit Body, ohne Spalte (Issue #1024). `listIssues()` liefert
   * nur offene, `listIssues(status)` keinen Body — `issue auftrag` braucht fuer die
   * Geschwister eines Plans beides und legt die Spalte selbst aus den Spaltenlisten daneben.
   */
  async listAlleMitBody() {
    const items = execJSON("gh", ["issue", "list", "--repo", this._repo(), "--state", "all", "--json", "number,title,body", "--limit", "1000"]);
    return (Array.isArray(items) ? items : []).map((i) => ({ id: String(i.number), title: i.title, body: i.body ?? "" }));
  }

  // `gh project item-list` liefert keine Labels (Issue #180) — sie werden ueber einen
  // zweiten Aufruf nachgeschlagen. Schlaegt der fehl, bleibt es bei labels: [] und die
  // Liste selbst ueberlebt: Ein Netzwerkschluckauf darf einen automatischen Lauf nicht kippen.
  _mitLabels(items, repo) {
    if (items.length === 0) return items;
    try {
      const raw = execJSON("gh", ["issue", "list", "--repo", repo, "--state", "all", "--json", "number,labels", "--limit", "1000"]);
      return withLabels(items, labelMapFrom(raw));
    } catch (e) {
      process.stderr.write(`${t("labelsNichtNachgeschlagen", { grund: e.message })}\n`);
      return items;
    }
  }

  async moveIssue(id, to) {
    this._ensureProjectMeta();
    const itemId = this._getProjectItemId(id);
    this._optionIdFor(to); // wirft frueh, falls Status unbekannt

    try {
      this._editItemStatus(itemId, to);
    } catch (firstErr) {
      // Gecachte IDs koennten veraltet sein (z.B. Option-ID im Project entfernt) —
      // Cache verwerfen, Meta frisch aus der API laden und einmal wiederholen.
      this._invalidateMetaCache();
      this._ensureProjectMeta();
      try {
        this._editItemStatus(itemId, to);
      } catch (retryErr) {
        throw new BoardError(t("statusUpdateFehlgeschlagen", { grund: retryErr.message, erster: firstErr.message }));
      }
    }
  }

  _optionIdFor(status) {
    const optionId = this._statusField.options[status];
    if (!optionId) throw new BoardError(t("statusOhneOption", { status }));
    return optionId;
  }

  _editItemStatus(itemId, status) {
    exec("gh", [
      "project", "item-edit",
      "--id", itemId,
      "--project-id", this._projectId,
      "--field-id", this._statusField.id,
      "--single-select-option-id", this._optionIdFor(status),
    ]);
  }

  async commentIssue(id, text) {
    const repo = this._repo();
    exec("gh", ["issue", "comment", String(id), "--repo", repo, "--body", text]);
  }

  // Strenges Lesen fuer `issue report` (Issue #1021): Ein Fehler von gh wirft. Hier
  // war schon `getIssue` streng — die eigene Methode gibt es, damit alle vier
  // Adapter dieselbe Schnittstelle haben.
  async kommentareStreng(id) {
    const repo = this._repo();
    const data = execJSON("gh", ["issue", "view", String(id), "--repo", repo, "--json", "comments"]);
    return normalizeComments(data.comments);
  }

  // `kommentarId` ist die numerische REST-ID aus normalizeComments, nicht die
  // Knoten-ID. Der Pfad steht vor den Flags, weil gh nur so ihn als Positions-
  // argument liest.
  async ersetzeKommentar(id, kommentarId, text) {
    const repo = this._repo();
    exec("gh", ["api", `repos/${repo}/issues/comments/${kommentarId}`, "-X", "PATCH", "-f", `body=${text}`]);
  }

  async updateIssue(id, { body }) {
    const repo = this._repo();
    exec("gh", ["issue", "edit", String(id), "--repo", repo, "--body", body]);
  }

  // gh setzt und entfernt Labels namentlich und additiv: Die uebrigen Labels des
  // Issues bleiben unberuehrt, und beide Richtungen sind von sich aus idempotent.
  // Eine unbekannte Labeldefinition meldet gh mit Exit != 0 — das schlaegt bewusst
  // durch, damit eine nie gesetzte Zeichnung nicht als gesetzt gilt.
  // Das fehlende Label meldet gh als `'<name>' not found` (Issue #1428).
  async labelIssue(id, name, aktion) {
    const repo = this._repo();
    const flag = aktion === "add" ? "--add-label" : "--remove-label";
    try {
      exec("gh", ["issue", "edit", String(id), "--repo", repo, flag, name]);
    } catch (e) {
      if (aktion === "add" && e.message.includes(`'${name}' not found`)) throw new LabelFehltError(e.message);
      throw e;
    }
  }
}

function githubStatusName(status, config) {
  return columnLabels(config)[status] || status;
}

// ============================================================
// CI-Status (Achse `code ci-status`, Issue #316)
// ============================================================

// Ein lokal gruener Lauf sagt nichts ueber die CI: Die CI kann Jobs fahren, die lokal nicht
// laufen, und ein solcher Job war rot, als v1.37.0 und v1.38.0 nach production gingen.
// Die Auskunft gehoert in den Adapter und nicht als `gh`-Aufruf
// in einen Skill-Text — die Skills sind provider-unabhaengig, und `gh run list` gibt es
// bei GitLab und im lokalen Modus nicht.

const GITHUB_CI_GRUEN = new Set(["success", "neutral"]);
const GITHUB_CI_ROT = new Set(["failure", "timed_out", "cancelled", "startup_failure", "action_required"]);
const GITLAB_CI_GRUEN = new Set(["success"]);
// Ein uebersprungener Job heisst in der Jobliste `uebersprungen` und zaehlt fuer Gesamturteil
// und Pflichtjobs wie `gruen`, so wie der Host einen uebersprungenen Pflichtcheck wertet (Issue #2230).
const CI_UEBERSPRUNGEN = "skipped";
const GITLAB_CI_ROT = new Set(["failed", "canceled"]);
// Ein abgebrochener Job bleibt rot, traegt aber `abgebrochen: true` (Issue #2150, Plan #2145 E18):
// Die Pruefung je Karte wertet einen Lauf, dessen rote Jobs alle abgebrochen sind, als nicht
// geprueft. Das Feld steht nur an solchen Jobs, alle anderen bleiben wortgleich.
const CI_ABGEBROCHEN = new Set(["cancelled", "canceled"]);
const abgebrochenFeld = (wert) => (CI_ABGEBROCHEN.has(wert) ? { abgebrochen: true } : {});

// Ein unbekannter oder fehlender Zustand ist `laeuft`: Die Zustandslisten der beiden
// Hosts wachsen, und ein neuer Wert stillschweigend als `gruen` zu werten hiesse, ein
// Release auf eine Auskunft zu stuetzen, die es nicht gibt.
function ciErgebnis(wert, gruen, rot) {
  if (gruen.has(wert)) return "gruen";
  if (wert === CI_UEBERSPRUNGEN) return "uebersprungen";
  if (rot.has(wert)) return "rot";
  return "laeuft";
}

/**
 * Startzeit eines Jobs als ISO-Zeichenkette oder `null`, solange er nicht gestartet ist
 * (Issue #1151). Ab ihr zaehlt die Frist, mit der `push main` auf einen CI-Job wartet
 * (Plan #1150, E4). gh gibt fuer einen nie gestarteten Job die Null-Zeit
 * `0001-01-01T00:00:00Z` aus — sie ist kein Start.
 */
function ciStartzeit(wert) {
  if (typeof wert !== "string" || wert === "" || wert.startsWith("0001-01-01")) return null;
  return wert;
}

/**
 * Das Gesamturteil aus den Einzeljobs: rot vor laeuft vor gruen; `uebersprungen` zaehlt wie
 * `gruen`, auch in einer Liste nur aus uebersprungenen Jobs (Issue #2230).
 *
 * Eine LEERE Jobliste ist `laeuft`, nicht `gruen`: Unmittelbar nach einem Push ist der
 * Lauf fuer einige Sekunden unsichtbar, und ein `gruen` an dieser Stelle risse genau die
 * Luecke wieder auf, die diese Achse schliesst. `keine` gibt es nur bei codeHost `local`
 * — dort ist die Abwesenheit von CI der Dauerzustand und kein Zwischenschritt.
 */
function ciGesamturteil(jobs) {
  if (jobs.some((j) => j.ergebnis === "rot")) return "rot";
  if (jobs.length === 0 || jobs.some((j) => j.ergebnis === "laeuft")) return "laeuft";
  return "gruen";
}

/**
 * Wie execJSON, aber jeder Fehlweg endet als abfangbarer BoardError mit Klartext:
 * fehlendes CLI, fehlende Authentifizierung, Netzfehler und ungueltiges JSON. Ohne das
 * traegt die Meldung „Unerwarteter Fehler" und sieht aus wie ein Defekt des Adapters.
 */
function ciJSON(datei, args) {
  let roh;
  try {
    roh = exec(datei, args);
  } catch (e) {
    throw new BoardError(`${datei} ${args.join(" ")}: ${e.message}`);
  }
  try {
    return JSON.parse(roh);
  } catch {
    throw new BoardError(t("keinJson", { aufruf: `${datei} ${args.join(" ")}`, auszug: roh.slice(0, 200) }));
  }
}

class GitHubCodeHost {
  constructor(config) { this._cfg = config; }

  async getRepoName() {
    try {
      return exec("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
    } catch {
      // Frueher eine POSIX-Kommandozeile mit || und $(pwd) — unter cmd.exe gibt es
      // beides nicht (Issue #196). Dieselbe Logik in JavaScript.
      //
      // normalizeRepoName ist hier nicht optional: Ohne sie lieferte dieser Zweig die
      // volle Remote-URL statt owner/repo, und zwar still (Issue #214). Sichtbar wurde
      // das nur, wenn gh nicht durchkommt — etwa unter einer Sandbox, die die
      // TLS-Pruefung blockiert.
      return normalizeRepoName(gitRemoteUrl()) || basename(resolve("."));
    }
  }

  supportsPullRequests() { return true; }

  async createPullRequest({ from, to, title }) {
    const t = title || `${from} → ${to}`;
    const url = exec("gh", ["pr", "create", "--base", to, "--head", from, "--title", t, "--body", ""]);
    return { url };
  }

  // Der Hotfix merged seinen PR selbst (Issue #2054, Plan #2038, A6). `gh pr merge` endet
  // auch dann mit 0, wenn es bei ausstehenden Pflichtpruefungen still auf Auto-Merge
  // umschaltet — erst der Stand danach sagt, ob gemergt ist. Wirft mit dem Grund.
  //
  // `head` ist der gepruefte Kopf (Issue #2084): `--match-head-commit` laesst GitHub den
  // Merge atomar abweisen, wenn jemand den Quellzweig nach der Pruefung weitergeschoben
  // hat. Der Abgleich danach faengt eine CLI, die die Option still uebergeht.
  async mergePullRequest({ number, head }) {
    if (!head) throw new Error(t("kopfFehlt", { nummer: number }));
    exec("gh", ["pr", "merge", String(number), "--merge", "--match-head-commit", head]);
    const pr = execJSON("gh", ["pr", "view", String(number), "--json", "state,mergeCommit,headRefOid"]);
    const commit = pr.mergeCommit?.oid;
    if (pr.state !== "MERGED" || !commit) throw new Error(t("nichtGemergt", { nummer: number, stand: pr.state }));
    if (pr.headRefOid !== head) {
      throw new Error(t("kopfAbweichend", { nummer: number, kopf: pr.headRefOid, geprueft: head }));
    }
    return { commit };
  }

  // Das Urteil entsteht ausschliesslich aus jobs[]: `gh run list --json name` liefert den
  // WORKFLOW-Namen, nicht den Job — damit waere der rote Job nicht zu benennen, und genau
  // sein Name ist es, den das Gate in `/merge-production` ausgibt.
  //
  // Mit `zweig` zaehlen nur die Laeufe dieses Zweigs (Plan #1405, A3): Am Kopf von
  // `origin/main` haengen Laeufe anderer Ausloeser (SonarQube), die die Probe sonst zur
  // Pflichtpruefung machte. `--branch` filtert schon bei gh, `headBranch` noch einmal hier.
  // Ohne `zweig` bleibt der Aufruf wortgleich wie zuvor.
  //
  // `adresse` ist die Seite des Laufs (Plan #1965, E7): bei mehreren Laeufen die des roten,
  // sonst die des ersten, ohne Lauf `null`. Die Job-`id` ist die `databaseId` des Laufs —
  // `getVerursacher` liest das Protokoll laufweise (E6). Beide Felder sind additiv.
  async getCiStatus(commit, zweig) {
    const laeufe = zweig
      ? ciJSON("gh", [
        "run", "list", "--branch", zweig, "--commit", commit,
        "--json", "databaseId,workflowName,headBranch,conclusion,status,url",
      ])
      : ciJSON("gh", [
        "run", "list", "--commit", commit, "--json", "databaseId,workflowName,conclusion,status,url",
      ]);
    const passend = (Array.isArray(laeufe) ? laeufe : []).filter((l) => !zweig || l.headBranch === zweig);
    const jobs = [];
    let adresse = null;
    let roteAdresse = null;
    for (const lauf of passend) {
      const detail = ciJSON("gh", ["run", "view", String(lauf.databaseId), "--json", "jobs"]);
      const eigene = (Array.isArray(detail.jobs) ? detail.jobs : []).map((job) => ({
        name: job.name,
        ergebnis: ciErgebnis(job.conclusion, GITHUB_CI_GRUEN, GITHUB_CI_ROT),
        gestartet: ciStartzeit(job.startedAt),
        id: lauf.databaseId,
        ...abgebrochenFeld(job.conclusion),
      }));
      jobs.push(...eigene);
      adresse ??= lauf.url ?? null;
      if (!roteAdresse && eigene.some((j) => j.ergebnis === "rot")) roteAdresse = lauf.url ?? null;
    }
    return { status: ciGesamturteil(jobs), adresse: roteAdresse ?? adresse, jobs };
  }

  /** Die Zeilen `Verursacher (<cmd>): …` aus dem Protokoll der roten Jobs des Laufs `id` (E6). */
  async getVerursacher(id) {
    return verursacherZeilen(ciText("gh", ["run", "view", String(id), "--log-failed"]));
  }

  /**
   * Die roten Eintraege aus dem Protokoll des Laufs `id` (Issue #2094); `adresse` ist die aus
   * `getCiStatus`, der Link zeigt auf den Lauf `id`.
   */
  async getFunde(id, adresse) {
    const link = jobLink(adresse, /\/actions\/runs\/\d+/, `/actions/runs/${id}`);
    return fundeAusProtokoll(ciText("gh", ["run", "view", String(id), "--log-failed"]), link);
  }

  // --- Schutz von Haupt- und Veroeffentlichungszweig (Issue #1406, Plan #1405) ---

  schutzUnterstuetzt() { return { ja: true }; }

  _repo() {
    if (!this._repoName) {
      try {
        this._repoName = exec("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
      } catch (e) {
        throw new BoardError(`gh repo view: ${e.message}`);
      }
    }
    return this._repoName;
  }

  /**
   * Die Rulesets des Kits — nur die mit dem Namen `claude-workflow-kit: <zweig>` (A1).
   * Fremde Rulesets werden nicht einmal im Detail gelesen: Was das Kit nicht liest, kann
   * es auch nicht versehentlich aendern.
   */
  async getRulesets() {
    const repo = this._repo();
    const liste = ghApi(`repos/${repo}/rulesets`);
    const eigene = (Array.isArray(liste) ? liste : []).filter((r) => istKitRuleset(r.name));
    return eigene.map((r) => {
      const d = ghApi(`repos/${repo}/rulesets/${r.id}`);
      const regeln = Array.isArray(d.rules) ? d.rules : [];
      const ziel = d.conditions?.ref_name?.include?.[0] || "";
      const pruefregel = regeln.find((x) => x.type === "required_status_checks");
      return {
        id: d.id,
        name: d.name,
        zweig: ziel.replace(/^refs\/heads\//, ""),
        enforcement: d.enforcement,
        regeln,
        requiredStatusChecks: (pruefregel?.parameters?.required_status_checks || []).map((c) => c.context),
        bypassActors: Array.isArray(d.bypass_actors) ? d.bypass_actors : [],
      };
    });
  }

  /**
   * Legt das Ruleset des Zweigs an (POST) oder ersetzt das gleichnamige (PUT).
   * `soll` ist `{ zweig, regeln, enforcement? }`; `regeln` sind Regeln im Format der
   * Rulesets-API. Name und Zielzweig setzt der Adapter selbst. `bypass_actors` geht immer
   * leer mit (A6): Auch eine von Hand eingetragene Umgehung faellt beim Aendern weg, und
   * eine im Soll mitgegebene erreicht GitHub nie.
   */
  async upsertRuleset(soll) {
    const repo = this._repo();
    const name = rulesetName(soll.zweig);
    const koerper = {
      name,
      target: "branch",
      enforcement: soll.enforcement || "active",
      conditions: { ref_name: { include: [`refs/heads/${soll.zweig}`], exclude: [] } },
      rules: soll.regeln,
      bypass_actors: [],
    };
    const vorhanden = this._eigenesRuleset(repo, name);
    if (vorhanden) {
      ghApi(`repos/${repo}/rulesets/${vorhanden.id}`, { methode: "PUT", koerper });
      return { id: vorhanden.id, name, angelegt: false };
    }
    const neu = ghApi(`repos/${repo}/rulesets`, { methode: "POST", koerper });
    return { id: neu.id, name, angelegt: true };
  }

  /** Setzt ein Ruleset des Kits auf `active` oder `disabled` (A6). */
  async setRulesetEnforcement(name, wert) {
    if (wert !== "active" && wert !== "disabled") {
      throw new BoardError(t("enforcementUnbekannt", { wert }));
    }
    if (!istKitRuleset(name)) {
      throw new BoardError(t("rulesetFremd", { name, praefix: RULESET_PRAEFIX }));
    }
    const repo = this._repo();
    const vorhanden = this._eigenesRuleset(repo, name);
    if (!vorhanden) throw new BoardError(t("rulesetFehlt", { name, repo }));
    ghApi(`repos/${repo}/rulesets/${vorhanden.id}`, { methode: "PUT", koerper: { enforcement: wert } });
    return { id: vorhanden.id, name, enforcement: wert };
  }

  /** Ob der angemeldete Nutzer Admin-Rechte am Repository hat (A9). */
  async hatAdminRecht() {
    const daten = ghApi(`repos/${this._repo()}`);
    return daten?.permissions?.admin === true;
  }

  async pushRef(sha, zweig) { pushRefAufOrigin(sha, zweig); }

  async deleteRef(zweig, sha) { deleteRefMitLease(zweig, sha); }

  _eigenesRuleset(repo, name) {
    const liste = ghApi(`repos/${repo}/rulesets`);
    return (Array.isArray(liste) ? liste : []).find((r) => r.name === name) || null;
  }
}

// Am Namen erkennt das Kit seine Rulesets (Plan #1405, A1) — fremde fasst es nie an.
export const RULESET_PRAEFIX = "claude-workflow-kit: ";

export function rulesetName(zweig) { return `${RULESET_PRAEFIX}${zweig}`; }

function istKitRuleset(name) {
  return typeof name === "string" && name.startsWith(RULESET_PRAEFIX);
}

/**
 * Ein Aufruf von `gh api` mit JSON-Antwort; ein Koerper geht ueber die Standardeingabe.
 * Jeder Fehlweg endet wie bei ciJSON als BoardError im Klartext. Nennt gh einen HTTP-Status
 * (`(HTTP 403)`), steht er zusaetzlich in `httpStatus`: Aus einer 403 macht die
 * Schutz-Logik die Anleitung (A9) statt einer Fehlermeldung.
 */
function ghApi(endpunkt, { methode, koerper } = {}) {
  const args = ["api", endpunkt];
  if (methode) args.push("--method", methode);
  if (koerper !== undefined) args.push("--input", "-");
  let roh;
  try {
    roh = exec("gh", args, koerper === undefined ? {} : { input: JSON.stringify(koerper) });
  } catch (e) {
    const fehler = new BoardError(`gh ${args.join(" ")}: ${e.message}`);
    const status = /\(HTTP (\d{3})\)/.exec(e.message);
    if (status) fehler.httpStatus = Number(status[1]);
    throw fehler;
  }
  if (roh === "") return null;
  try {
    return JSON.parse(roh);
  } catch {
    throw new BoardError(t("keinJson", { aufruf: `gh ${args.join(" ")}`, auszug: roh.slice(0, 200) }));
  }
}

function gitPush(ziel, optionen = []) {
  const args = ["push", ...optionen, "origin", ...ziel];
  try {
    exec("git", args);
  } catch (e) {
    throw new BoardError(`git ${args.join(" ")}: ${e.message}`);
  }
}

/** Pusht `sha` auf `zweig` von origin, nie erzwungen (Plan #1965, E10). */
function pushRefAufOrigin(sha, zweig) {
  gitPush([`${sha}:refs/heads/${zweig}`]);
}

/**
 * Loescht `zweig` auf origin nur, solange er auf `sha` steht (Plan #1965, E8): Mit Lease
 * loescht nur, wer den Zweig angelegt hat, ein fremder Stand bleibt unberuehrt. Ohne `sha`
 * wird nicht geloescht.
 */
function deleteRefMitLease(zweig, sha) {
  if (!sha) throw new BoardError(t("deleteRefOhneLease", { zweig }));
  gitPush([`:refs/heads/${zweig}`], [`--force-with-lease=refs/heads/${zweig}:${sha}`]);
}

/** Wie ciJSON, aber fuer eine Textausgabe (Protokoll eines Jobs). */
function ciText(datei, args) {
  try {
    return exec(datei, args);
  } catch (e) {
    throw new BoardError(`${datei} ${args.join(" ")}: ${e.message}`);
  }
}

// Die Zeile schreibt `checks.mjs` im Build-Dienst in der Sprache des Projekts
// (`verursacherZeile`). gh setzt Job, Schritt und Zeitstempel davor, GitLab Farbcodes.
const VERURSACHER_ZEILE = /(?:Verursacher|Causers) \(.*?\): .*$/;
const ANSI = new RegExp(String.raw`${String.fromCodePoint(0x1b)}\[[0-9;]*[A-Za-z]`, "g");

/** Die Zeilen `Verursacher (<cmd>): …` eines Protokolls, ohne Praefix; ohne Treffer leer. */
function verursacherZeilen(protokoll) {
  const zeilen = [];
  for (const zeile of String(protokoll).replaceAll(ANSI, "").split(/\r?\n/)) {
    const treffer = VERURSACHER_ZEILE.exec(zeile);
    if (treffer) zeilen.push(treffer[0].trimEnd());
  }
  return zeilen;
}

// Die Zeilen, die checks.mjs je roter Pruefung schreibt (Issue #2090): `Fund (<cmd>): …` mit der
// ersten Zeile des Funds und bei einem Fund an der Umgebung `Umgebung (<cmd>): <Handgriff>`.
const FUND_ZEILE = /(?:Fund|Finding) \((.*?)\): (.*)$/;
const UMGEBUNG_ZEILE = /(?:Umgebung|Environment) \((.*?)\): (.*)$/;
const VERURSACHER_TEILE = /(?:Verursacher|Causers) \((.*?)\): (.*)$/;
// Was gh vor jede Zeile von --log-failed setzt: Job, Schritt, Zeitstempel.
const GH_PRAEFIX = /^[^\t\n]*\t[^\t\n]*\t\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/;
/** Die Laenge, auf die ein Fund gekuerzt wird — dieselbe wie `fund` in der Zusammenfassung (E2). */
const FUND_HOECHSTENS = 2000;

/** Ein Eintrag je Pruefung in der Reihenfolge ihres ersten Auftretens. */
function fundEintrag(eintraege, cmd, protokoll) {
  if (!eintraege.has(cmd)) {
    eintraege.set(cmd, { cmd, ergebnis: "rot", fund: null, art: "projekt", pakete: [], protokoll });
  }
  return eintraege.get(cmd);
}

/** Die Verursacher-Pakete aus `Issue #N (…)`; ohne Nummer ist der Text ein Hinweis. */
function verursacherEintragen(eintrag, text) {
  const nummern = [...text.matchAll(/Issue #(\d+)/g)].map((m) => m[1]);
  for (const nummer of nummern) if (!eintrag.pakete.includes(nummer)) eintrag.pakete.push(nummer);
  if (nummern.length === 0 && text.trim() !== "") eintrag.hinweis = text.trim();
}

/** Der Wortlaut eines Funds: die Zeile und die folgenden bis zur naechsten `$ `- oder Kit-Zeile. */
function fundWortlaut(zeilen, ab, erste) {
  const teile = [erste];
  for (const zeile of zeilen.slice(ab + 1)) {
    if (zeile.startsWith("$ ") || FUND_ZEILE.test(zeile) || UMGEBUNG_ZEILE.test(zeile) || VERURSACHER_TEILE.test(zeile)) break;
    teile.push(zeile);
  }
  while (teile.length > 1 && teile.at(-1).trim() === "") teile.pop();
  return teile.join("\n").slice(0, FUND_HOECHSTENS);
}

/**
 * Die roten Eintraege aus dem Protokoll eines Jobs (Issue #2094, Plan #2087, A5), in der Form
 * der roten Eintraege der Zusammenfassung: `cmd`, `fund` im Wortlaut, `art`, bei `umgebung`
 * der `handgriff`, die Verursacher-`pakete`, ein `hinweis` ohne Paket und der Link `protokoll`.
 */
function fundeAusProtokoll(protokoll, link) {
  const zeilen = String(protokoll).replaceAll(ANSI, "").split(/\r?\n/).map((z) => z.replace(GH_PRAEFIX, "").trimEnd());
  const eintraege = new Map();
  zeilen.forEach((zeile, i) => {
    const fund = FUND_ZEILE.exec(zeile);
    if (fund) {
      fundEintrag(eintraege, fund[1], link).fund ??= fundWortlaut(zeilen, i, fund[2]);
      return;
    }
    const umgebung = UMGEBUNG_ZEILE.exec(zeile);
    if (umgebung) {
      Object.assign(fundEintrag(eintraege, umgebung[1], link), { art: "umgebung", handgriff: umgebung[2].trim() });
      return;
    }
    const verursacher = VERURSACHER_TEILE.exec(zeile);
    if (verursacher) verursacherEintragen(fundEintrag(eintraege, verursacher[1], link), verursacher[2]);
  });
  return [...eintraege.values()].map(({ cmd, ergebnis, fund, art, handgriff, pakete, hinweis, protokoll: p }) => ({
    cmd, ergebnis, fund, art, ...(handgriff === undefined ? {} : { handgriff }), pakete,
    ...(hinweis === undefined ? {} : { hinweis }), protokoll: p,
  }));
}

/**
 * Der Link des Jobs `id` aus der Adresse des Laufs, die `getCiStatus` nennt: `muster` ist der
 * Pfadteil der Adresse, `ersatz` der des Jobs. Ohne Adresse `null`, eine fremde bleibt stehen.
 */
function jobLink(adresse, muster, ersatz) {
  if (typeof adresse !== "string" || adresse === "") return null;
  return muster.test(adresse) ? adresse.replace(muster, ersatz) : adresse;
}

// ============================================================
// GitLab-Adapter
// ============================================================

class GitLabIssueTracker {
  constructor(config) { this._cfg = config; }

  /**
   * Anmeldung und Labels, rein lesend (Issue #1776, E5, E8). Eine Spalte gibt es, wenn sie ein
   * GitLab-Zustand ist (`isStateColumn`) oder ihr Label aus `columnLabels` am Board steht.
   */
  async einrichtung() {
    const adresse = gitRemoteUrl();
    const mangel = cliAnmeldung("glab", adresse);
    if (mangel) return mangel;
    const labels = gelesen(() => labelNamesFrom(execJSON("glab", ["label", "list", "--output", "json", "--per-page", "100"])));
    const spalten = Array.isArray(labels)
      ? VALID_STATUSES.filter((s) => isStateColumn(s, this._cfg) || labels.includes(columnLabels(this._cfg)[s]))
      : labels;
    return { adresse, erreichbar: true, angemeldet: true, spalten, labels };
  }

  async createIssue({ title, body }) {
    const output = exec("glab", ["issue", "create", "--title", title, "--description", body || ""]);
    // glab gibt die Issue-URL aus, z.B. https://gitlab.com/owner/repo/-/issues/42
    const match = output.match(/\/issues\/(\d+)/);
    if (!match) throw new BoardError(t("glabIdUnlesbar", { ausgabe: output }));
    const id = match[1];
    // Backlog-Label nur setzen, wenn backlog per Config ueberhaupt ein Label ist
    // (nicht der native Open-Zustand) — sonst bleibt das neue Issue einfach offen.
    if (!isStateColumn("backlog", this._cfg)) {
      const label = columnLabels(this._cfg).backlog;
      try {
        exec("glab", ["issue", "update", String(id), "--label", label]);
      } catch (e) {
        process.stderr.write(`${t("backlogLabelFehlgeschlagen", { grund: e.message })}\n`);
      }
    }
    return { id, url: output.trim() };
  }

  async getIssue(id) {
    const data = execJSON("glab", ["issue", "view", String(id), "--output", "json"]);
    const labelNames = labelNamesFrom(data.labels);
    const status = labelToStatus(labelNames, this._cfg, data.state) || null;
    return {
      id: String(data.iid || data.id),
      title: data.title,
      body: data.description,
      status,
      labels: labelNames,
      comments: this._notes(id),
      ...createdFrom(data.created_at),
    };
  }

  // Kommentare liegen bei GitLab als "Notes" an einem eigenen Endpunkt (kanban-kit#449).
  // Ein Fehlschlag darf `issue get` nicht kippen — der Verlauf ist Zusatzinformation,
  // Titel/Body/Status sind die Hauptsache. Deshalb leeres Array statt Abbruch.
  _notes(id) {
    try {
      return this._notesStreng(id);
    } catch (e) {
      process.stderr.write(`${t("kommentareNichtAbrufbar", { grund: e.message })}\n`);
      return [];
    }
  }

  /**
   * Uebersetzt einen Board-Status in die CLI-Flags von `glab issue list` (Issue #404).
   *
   * Eigene Funktion, weil hier eine Uebersetzung stattfindet und keine Abfrage: Der
   * Status ist ein Kit-Begriff, die Flags sind GitLabs Modell aus Zustaenden und
   * Labels. listIssues fragt danach ab und formt das Ergebnis — zwei Aufgaben, die
   * ineinander nur schwer zu lesen waren.
   */
  _listArgs(status) {
    const args = ["issue", "list", "--output", "json"];
    if (!status) return args;
    // Board-Reihenfolge statt numerisch: relative_position ist GitLabs Feld fuer die
    // manuelle Board-Sortierung (oben zuerst, #128). Nur im Status-Filter-Pfad.
    args.push("--order", "relative_position", "--sort", "asc");
    if (!isStateColumn(status, this._cfg)) {
      const label = columnLabels(this._cfg)[status];
      if (!label) throw new BoardError(t("gitlabOhneLabel", { status }));
      args.push("--label", label);
      return args;
    }
    if (status === "done") {
      args.push("--closed");
      return args;
    }
    // backlog als Open-Zustand: offene Issues ohne die anderen Status-Labels.
    const otherLabels = Object.entries(columnLabels(this._cfg))
      .filter(([s]) => s !== "backlog" && !isStateColumn(s, this._cfg))
      .map(([, l]) => l);
    for (const l of otherLabels) args.push("--not-label", l);
    return args;
  }

  async listIssues(status) {
    const items = execJSON("glab", this._listArgs(status));
    const mapped = (Array.isArray(items) ? items : []).map((i) => {
      const labelNames = labelNamesFrom(i.labels);
      return {
        id: String(i.iid),
        title: i.title,
        body: i.description,
        status: labelToStatus(labelNames, this._cfg, i.state) || null,
        labels: labelNames,
      };
    });
    // Mit Status-Filter gilt die Board-Reihenfolge (relative_position, s. o.);
    // ungefiltert bleibt die stabile numerische Sortierung.
    return status ? mapped : mapped.sort((a, b) => Number(a.id) - Number(b.id));
  }

  async moveIssue(id, to) {
    const labels = columnLabels(this._cfg);
    const statusLabels = Object.values(labels);

    // backlog (falls als Open-Zustand konfiguriert) und done sind GitLab-Zustaende,
    // keine Labels: nur Status-Labels entfernen, Issue oeffnen bzw. schliessen, kein
    // Phantom-Label setzen.
    if (isStateColumn(to, this._cfg)) {
      const unlabelArgs = statusLabels.flatMap((l) => ["--unlabel", l]);
      exec("glab", ["issue", "update", String(id), ...unlabelArgs]);
      exec("glab", ["issue", to === "done" ? "close" : "reopen", String(id)]);
      return;
    }

    const label = labels[to];
    if (!label) throw new BoardError(t("gitlabOhneLabel", { status: to }));
    // Alle anderen Status-Labels entfernen, Ziel-Label setzen (Ziel-Label
    // NICHT im selben Aufruf unlabeln, sonst verrechnet glab beides gegeneinander).
    const unlabelArgs = statusLabels
      .filter((l) => l !== label)
      .flatMap((l) => ["--unlabel", l]);
    exec("glab", ["issue", "update", String(id), ...unlabelArgs, "--label", label]);
  }

  async commentIssue(id, text) {
    // 'glab issue note <id>', NICHT 'issue note create <id>' (Issue #216): Ein
    // create-Subkommando gibt es hier nicht — anders als bei 'issue create', wo die
    // Analogie naheliegt. glab liest ein vorangestelltes 'create' als zusaetzliches
    // Argument und bricht mit "Accepts 1 arg(s), received 2" ab.
    exec("glab", ["issue", "note", String(id), "--message", text]);
  }

  _notesStreng(id) {
    return normalizeComments(execJSON("glab", ["api", `projects/:id/issues/${id}/notes`]));
  }

  // Strenges Lesen fuer `issue report` (Issue #1021): Anders als `_notes` wirft ein
  // Fehler — ein leer gelesener Stand liesse `melden` einen zweiten Bericht anlegen.
  async kommentareStreng(id) {
    return this._notesStreng(id);
  }

  async ersetzeKommentar(id, kommentarId, text) {
    exec("glab", ["api", `projects/:id/issues/${id}/notes/${kommentarId}`, "-X", "PUT", "-f", `body=${text}`]);
  }

  async updateIssue(id, { body }) {
    // Bei GitLab heisst der Body 'description' — dasselbe Flag wie in createIssue.
    exec("glab", ["issue", "update", String(id), "--description", body]);
  }

  // Dieselben Flags wie in moveIssue, nur mit genau einem Namen und ohne die
  // Status-Labels anzufassen: Die Sperre gegen Spaltennamen sitzt im Dispatcher,
  // bevor irgendein Adapter gerufen wird.
  async labelIssue(id, name, aktion) {
    const flag = aktion === "add" ? "--label" : "--unlabel";
    exec("glab", ["issue", "update", String(id), flag, name]);
  }
}

// Der Satz aus Plan #1405, A5: Wo das Kit keinen Schutz einrichtet, sagt es, was offen bleibt.

class GitLabCodeHost {
  schutzUnterstuetzt() { return { ja: false, grund: t("schutzGitlab") }; }

  async getRepoName() {
    // Ohne Remote (kein Repo, kein origin) bleibt der Verzeichnisname — frueher ueber
    // `basename $(pwd)`, das cmd.exe nicht kennt (Issue #196).
    return normalizeRepoName(gitRemoteUrl()) || basename(resolve("."));
  }

  supportsPullRequests() { return true; }

  async createPullRequest({ from, to, title }) {
    const t = title || `${from} -> ${to}`;
    const url = exec("glab", [
      "mr", "create",
      "--source-branch", from,
      "--target-branch", to,
      "--title", t,
      "--description", "",
      "--yes",
    ]);
    // glab gibt die MR-URL aus
    const match = url.match(/https?:\/\/\S+/);
    return { url: match ? match[0] : url.trim() };
  }

  // Gegenstueck zu GitHub (Issue #2054): `--auto-merge=false`, weil glab bei laufender
  // Pipeline sonst nur Auto-Merge setzt; den Merge-Commit nennt erst `mr view`.
  // `--sha` bindet den Merge an den geprueften Kopf (Issue #2084), wie bei GitHub.
  async mergePullRequest({ number, head }) {
    if (!head) throw new Error(t("kopfFehlt", { nummer: number }));
    exec("glab", ["mr", "merge", String(number), "--auto-merge=false", "--sha", head, "--yes"]);
    const mr = execJSON("glab", ["mr", "view", String(number), "--output", "json"]);
    if (mr.state !== "merged" || !mr.merge_commit_sha) {
      throw new Error(t("nichtGemergt", { nummer: number, stand: mr.state }));
    }
    if (mr.sha !== head) throw new Error(t("kopfAbweichend", { nummer: number, kopf: mr.sha, geprueft: head }));
    return { commit: mr.merge_commit_sha };
  }

  // `glab ci status` scheidet aus: Es filtert nach Branch, nicht nach SHA. `ci list`
  // liefert absteigend nach id (glab-Default), das erste Element ist also die neueste
  // Pipeline des Commits; ihre Jobs holt `ci get --with-job-details`.
  //
  // Mit `zweig` zaehlen nur die Pipelines dieses Zweigs (`--ref`, Plan #1965, E5).
  // `adresse` ist die `web_url` der Pipeline (E7), die Job-`id` die des Jobs (E6).
  async getCiStatus(commit, zweig) {
    const filter = zweig ? ["--ref", zweig] : [];
    const pipelines = ciJSON("glab", ["ci", "list", "--sha", commit, ...filter, "--output", "json"]);
    const liste = Array.isArray(pipelines) ? pipelines : [];
    if (liste.length === 0) return { status: "laeuft", adresse: null, jobs: [] };

    const detail = ciJSON("glab", [
      "ci", "get", "--pipeline-id", String(liste[0].id), "--with-job-details", "--output", "json",
    ]);
    const jobs = (Array.isArray(detail.jobs) ? detail.jobs : []).map((job) => ({
      name: job.name,
      ergebnis: ciErgebnis(job.status, GITLAB_CI_GRUEN, GITLAB_CI_ROT),
      gestartet: ciStartzeit(job.started_at),
      id: job.id ?? null,
      ...abgebrochenFeld(job.status),
    }));
    return { status: ciGesamturteil(jobs), adresse: detail.web_url ?? liste[0].web_url ?? null, jobs };
  }

  /** Die Zeilen `Verursacher (<cmd>): …` aus dem Protokoll des Jobs `id` (E6). */
  async getVerursacher(id) {
    return verursacherZeilen(ciText("glab", ["ci", "trace", String(id)]));
  }

  /**
   * Die roten Eintraege aus dem Protokoll des Jobs `id` (Issue #2094); `adresse` ist die der
   * Pipeline aus `getCiStatus`, der Link zeigt auf den Job.
   */
  async getFunde(id, adresse) {
    const link = jobLink(adresse, /\/-\/pipelines\/\d+/, `/-/jobs/${id}`);
    return fundeAusProtokoll(ciText("glab", ["ci", "trace", String(id)]), link);
  }

  async pushRef(sha, zweig) { pushRefAufOrigin(sha, zweig); }

  async deleteRef(zweig, sha) { deleteRefMitLease(zweig, sha); }
}

// ============================================================
// Local-Adapter
// ============================================================

// Minimaler YAML-Frontmatter-Parser fuer die Issue-Dateien (kein externes Modul).
// Bewusst minimal: nur flaches, einzeiliges YAML (reicht fuer das Issue-Format).
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta = {};
  for (const line of match[1].split("\n")) {
    // Fuehrende Leerzeichen nach dem Doppelpunkt uebernimmt das nachgelagerte .trim();
    // deshalb hier bewusst kein \s* (vermeidet ueberlappende Zeichenklassen/Backtracking).
    const m = line.match(/^(\w+):(.*)$/);
    if (m) meta[m[1]] = m[2].trim().replaceAll(/(?:^["'])|(?:["']$)/g, "");
  }
  return { meta, body: match[2] };
}

function serializeFrontmatter(meta, body) {
  const lines = Object.entries(meta).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

// Labels des lokalen Trackers liegen als kommaseparierter Frontmatter-String —
// parseFrontmatter kann kein YAML-Array (Issue #158/#159). Lesen und Schreiben
// teilen sich diese Form, damit listIssues und labelIssue nicht zwei Lesarten
// desselben Feldes entwickeln.
function labelsAusFrontmatter(meta) {
  return typeof meta.labels === "string" && meta.labels.trim()
    ? meta.labels.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
}

function issuesDir(config) {
  return resolve(config.local?.issuesDir || "issues");
}

function padId(n) {
  return String(n).padStart(4, "0");
}

// Epic-Fortschritt aus den Kindern (parent-Zeiger).
// Kinder = nicht-Epic-Issues mit parent == epicId; done = Kinder im Status "done".
function epicProgress(issues, epicId) {
  const children = issues.filter((i) => i.type !== "epic" && i.parent === epicId);
  const done = children.filter((i) => i.status === "done").length;
  return { total: children.length, done };
}

// Trifft ein Body, der NUR aus der Autor-Modell-Zeile besteht? Dann bekommt er
// die Abschnitts-Vorlage angehaengt (Issue #266, angewandt in createIssue).
//
// Der Ausdruck fasst die rohe Zeile, den umgebenden Leerraum raeumt der Aufrufer
// per `trim()` ab — dasselbe Muster, das #403 bei PRUEFUNG_ZEILE angewandt hat.
// Die fruehere Fassung `/^\s*Autor-Modell:[^\S\n]*\S[^\n]*\s*$/` legte `\s*` um
// den GANZEN Body: `[^\n]*` und `\s*` akzeptieren beide Leerzeichen, also
// probierte die Engine bei einem scheiternden Rest jede Aufteilung durch
// (S8786, Issue #406). Gemessen mit 256 KiB Leerraum hinter der Zeile: 21,7 s
// vorher, 0,3 ms danach. Der Aufrufvertrag aus #396 schuetzte hier nicht — der
// Ausdruck laeuft ueber den ganzen Body, nicht ueber eine Zeile aus `.split()`.
const NUR_AUTOR_ZEILE = /^Autor-Modell:[^\S\n]*\S[^\n]*$/;

export function nurAutorZeileTrifft(body) {
  return NUR_AUTOR_ZEILE.test((body || "").trim());
}

class LocalIssueTracker {
  constructor(config) { this._cfg = config; }

  /** Ohne Netz und ohne Anmeldung; die fuenf Spalten gibt es immer, Labels kennt das Board nicht (Issue #1776, E5). */
  async einrichtung() {
    return { adresse: this._dir(), erreichbar: EINRICHTUNG_ENTFAELLT, angemeldet: EINRICHTUNG_ENTFAELLT, spalten: [...VALID_STATUSES], labels: null };
  }

  _dir() {
    return issuesDir(this._cfg);
  }

  _allFiles() {
    const dir = this._dir();
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      // aufsteigend nach Dateiname = aufsteigend nach id — die Namen sind auf vier
      // Stellen genullt (padId), Codepoint-Ordnung ist damit Zahlenordnung. Der
      // Vergleich steht ausgeschrieben statt als argumentloses Sortieren (Issue #956,
      // S2871) und liegt hier statt als benannte Funktion, weil board.mjs ein
      // eigenstaendiges Single-File-Werkzeug ist (#440) und dies seine einzige
      // Stelle. `localeCompare` waere hier falsch: Es haengt an der Locale der
      // Maschine, und die Kartenreihenfolge ist die Abarbeitungsreihenfolge.
      .sort((a, b) => (a < b ? -1 : Number(a > b)));
  }

  _filePath(id) {
    return join(this._dir(), `${padId(id)}.md`);
  }

  _read(id) {
    const p = this._filePath(id);
    if (!existsSync(p)) throw new BoardError(t("issueDateiFehlt", { id, pfad: p }));
    const { meta, body, comments } = this._teile(readFileSync(p, "utf-8"));
    const type = meta.type || "task";
    // Fuer ein Vorhaben ist `status` bedingungslos null — ein etwaiges Feld im
    // Frontmatter wird ignoriert. `createIssue` schreibt bei Epics keins, aber
    // `moveIssue` setzt `meta.status` ohne Typpruefung (Issue #377).
    // `created` faellt weg statt "" zu liefern, wenn das Frontmatter keins oder ein
    // formwidriges traegt (Issue #457) — sonst muessten Aufrufer zwei Formen von
    // "kein Datum" unterscheiden.
    return { id: meta.id || padId(id), type, parent: meta.parent || "", title: meta.title || "", status: type === "epic" ? null : (meta.status || "backlog"), ...createdFrom(meta.created), labels: labelsAusFrontmatter(meta), body, comments };
  }

  /**
   * Eine Issue-Datei in Frontmatter, Body und Kommentarbloecke zerlegt (Issue #1888).
   *
   * Der Body reicht bis zum ersten Blockkopf, `rest` ist alles ab dort, Byte fuer Byte.
   * Die Erkennung ist allein `_kommentarBloecke` — dieselbe, nach der `kommentareStreng`
   * die IDs vergibt; `comments` traegt darum dieselben IDs. `kit/board-ui.mjs`
   * (`splitComments`) trennt an derselben Stelle.
   */
  _teile(raw) {
    const { meta, body: alles } = parseFrontmatter(raw);
    const anfang = raw.length - alles.length;
    const bloecke = this._kommentarBloecke(raw);
    const schnitt = bloecke.length > 0 ? Math.max(anfang, bloecke[0].kopf) : raw.length;
    const comments = normalizeComments(bloecke.map((b) => ({
      author: "", body: raw.slice(b.start, b.ende), createdAt: b.createdAt, id: b.id,
    })));
    return { meta, body: raw.slice(anfang, schnitt), rest: raw.slice(schnitt), comments };
  }

  _nextId() {
    const files = this._allFiles();
    if (files.length === 0) return 1;
    const nums = files.map((f) => Number.parseInt(f, 10)).filter((n) => !Number.isNaN(n));
    return nums.length > 0 ? Math.max(...nums) + 1 : 1;
  }

  async createIssue({ title, body, type, parent, color, shortcode }) {
    const dir = this._dir();
    mkdirSync(dir, { recursive: true });
    const n = this._nextId();
    const id = padId(n);
    const today = new Date().toISOString().slice(0, 10);
    const t = type || "task";
    const meta = { id: `"${id}"`, type: t };
    if (parent) meta.parent = `"${parent}"`;
    if (color) meta.color = color;
    if (shortcode) meta.shortcode = shortcode;
    // Epics nehmen nicht am Spalten-Workflow teil (E5): kein status-Feld.
    if (t !== "epic") meta.status = "backlog";
    meta.title = title;
    meta.created = today;
    // Die Abschnitts-Vorlage greift auch dann, wenn der Body nur aus der
    // Autor-Modell-Zeile besteht (Issue #266). Seit der Leitplanke in issueCreate
    // ist ein Body nie mehr wirklich leer — ohne diese Erweiterung haette ein
    // `create` ohne --body still die Vorlage verloren.
    const nurAutorZeile = nurAutorZeileTrifft(body);
    const VORLAGE = "\n## Kontext\n\n## Aufgabe\n\n## Akzeptanzkriterium\n\n## Abhaengigkeiten\n";
    let rumpf = body;
    if (!body) rumpf = VORLAGE;
    else if (nurAutorZeile) rumpf = `${body.trimEnd()}\n${VORLAGE}`;
    const content = serializeFrontmatter(meta, rumpf);
    writeFileSync(this._filePath(n), content, "utf-8");
    return { id, path: this._filePath(n) };
  }

  async getIssue(id) {
    return this._read(id);
  }

  /**
   * Aktivitaetsverlauf, synthetisch (Issue #460).
   *
   * Der lokale Tracker fuehrt keinen Verlauf — er hat nur das Frontmatter. Daraus
   * entsteht **ein** Eintrag vom Typ CREATED, damit Auswertungen (etwa
   * `effectiveness.mjs` ueber `issue activity`) hier dieselbe Quelle lesen koennen
   * wie beim Board.
   *
   * Fehlt `created:`, ist der Verlauf leer. Das ist ehrlicher als ein erfundenes
   * Datum: Eine Datei ohne Anlagedatum hat schlicht keinen Anlage-Eintrag.
   */
  async listActivity(id) {
    const { created } = this._read(id);
    if (!created) return [];
    return [{ type: "CREATED", createdAt: created, detail: "Karte angelegt" }];
  }

  /**
   * Sammelform des Verlaufs (Issue #786).
   *
   * Hier gibt es nichts einzusparen — jede Nummer ist ein Dateizugriff, die
   * Beschleunigung von `--ids` betrifft allein das Board. Was bleibt, ist die
   * gemeinsame Zusage der Sammelform: Eine Nummer ohne Datei wird zum Eintrag mit
   * Fehlergrund und nicht zum Abbruch, damit ein geloeschtes Paket die Auswertung
   * der uebrigen nicht kostet.
   */
  async listActivityMany(ids) {
    const ergebnis = {};
    for (const id of ids) {
      try {
        ergebnis[id] = await this.listActivity(id);  // eslint-disable-line no-await-in-loop -- NOSONAR S9382: Dateizugriffe, parallel gewinnt nichts
      } catch (e) {
        ergebnis[id] = { fehler: e.message };
      }
    }
    return ergebnis;
  }

  // Alle Issue-Dateien roh, ohne jede Filterung. Gemeinsame Quelle fuer listIssues
  // (das Vorhaben ausschliesst) und listEpics (das genau sie braucht) — ohne die
  // Trennung liefe listEpics nach dem Epic-Ausschluss leer (Issue #377).
  _alleItems() {
    return this._allFiles()
      .map((f) => {
        const raw = readFileSync(join(this._dir(), f), "utf-8");
        const { meta, body } = parseFrontmatter(raw);
        const labels = labelsAusFrontmatter(meta);
        return { id: meta.id || basename(f, ".md"), type: meta.type || "task", parent: meta.parent || "", color: meta.color || "", shortcode: meta.shortcode || "", title: meta.title || "", status: meta.status || "backlog", labels, body };
      });
  }

  async listIssues(status) {
    // Epics nehmen nicht am Spalten-Workflow teil (E5) — der Ausschluss gilt
    // unabhaengig vom Filter (Issue #377), siehe die Begruendung im Toolbox-Adapter.
    return this._alleItems()
      .filter((i) => i.type !== "epic" && (!status || i.status === status));
  }

  async listEpics() {
    const all = this._alleItems();
    return all
      .filter((i) => i.type === "epic")
      .map((e) => ({ ...e, progress: epicProgress(all, e.id) }));
  }

  async moveIssue(id, to) {
    const p = this._filePath(id);
    if (!existsSync(p)) throw new BoardError(t("issueDateiFehlt", { id, pfad: p }));
    // Body und Kommentarbloecke gehen ausdruecklich getrennt zurueck (Issue #1888).
    const { meta, body, rest } = this._teile(readFileSync(p, "utf-8"));
    meta.status = to;
    writeFileSync(p, serializeFrontmatter(meta, body + rest), "utf-8");
  }

  async commentIssue(id, text) {
    const p = this._filePath(id);
    if (!existsSync(p)) throw new BoardError(t("issueDateiFehlt", { id, pfad: p }));
    const raw = readFileSync(p, "utf-8");
    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 16);
    const comment = `\n\n---\n**Kommentar** (${timestamp})\n\n${text}`;
    writeFileSync(p, raw + comment, "utf-8");
  }

  /**
   * Die angehaengten `**Kommentar**`-Bloecke einer Karte (Issue #1021).
   *
   * Der lokale Tracker fuehrt Kommentare nicht getrennt, `commentIssue` haengt sie an
   * die Datei. Die ID ist darum die laufende Nummer des Blocks, ab 1 — sie aendert
   * sich nicht, weil kein Weg mehr einen Block entfernt: `updateIssue`, `moveIssue` und
   * `labelIssue` schreiben die Bloecke ueber `_teile` unveraendert zurueck, und
   * `updateIssue` weist einen Body mit eigenem Kopf ab (Issue #1888). Jeder Block
   * reicht bis zum naechsten Blockkopf oder zum Dateiende; `kopf` ist die Stelle, an
   * der sein Kopf beginnt.
   */
  _kommentarBloecke(raw) {
    const kopf = /\n\n---\n\*\*Kommentar\*\* \(([^)\n]*)\)\n\n/g;
    const koepfe = [...raw.matchAll(kopf)];
    return koepfe.map((m, i) => ({
      id: String(i + 1),
      kopf: m.index,
      createdAt: m[1],
      start: m.index + m[0].length,
      ende: i + 1 < koepfe.length ? koepfe[i + 1].index : raw.length,
    }));
  }

  async kommentareStreng(id) {
    const p = this._filePath(id);
    if (!existsSync(p)) throw new BoardError(t("issueDateiFehlt", { id, pfad: p }));
    const raw = readFileSync(p, "utf-8");
    return this._kommentarBloecke(raw).map((b) => ({
      author: "", body: raw.slice(b.start, b.ende), createdAt: b.createdAt, id: b.id,
    }));
  }

  // Ersetzt den Text eines Blocks; Blockkopf, alles davor und alles danach bleiben
  // Byte fuer Byte. Traegt der neue Text eine `Bericht-Lauf:`-Zeile, muss der Block
  // dieselbe tragen — sonst waere es der Bericht eines anderen Laufs.
  async ersetzeKommentar(id, kommentarId, text) {
    const p = this._filePath(id);
    if (!existsSync(p)) throw new BoardError(t("issueDateiFehlt", { id, pfad: p }));
    const raw = readFileSync(p, "utf-8");
    const block = this._kommentarBloecke(raw).find((b) => b.id === String(kommentarId));
    if (!block) throw new BoardError(t("kommentarFehlt", { kommentar: kommentarId, id }));
    const lauf = text.match(/^Bericht-Lauf:.*$/m)?.[0];
    if (lauf && !raw.slice(block.start, block.ende).split(/\r?\n/).includes(lauf)) {
      throw new BoardError(t("kommentarOhneLaufzeile", { kommentar: kommentarId, id, zeile: lauf }));
    }
    writeFileSync(p, raw.slice(0, block.start) + text + raw.slice(block.ende), "utf-8");
  }

  async updateIssue(id, { body }) {
    const p = this._filePath(id);
    if (!existsSync(p)) throw new BoardError(t("issueDateiFehlt", { id, pfad: p }));
    // Ein Kopf im neuen Body waere beim naechsten Lesen ein Kommentar. Gezaehlt wird
    // mit dem Zeichen davor und dem Anschluss danach: Ein Body, der auf `… (x)\n` endet,
    // wird mit dem naechsten Block zum vollstaendigen Kopf (Issue #1888).
    if (this._kommentarBloecke(`\n${body}\n\n`).length > 0) throw new BoardError(t("bodyMitKommentarkopf", { id }));
    const { meta, rest } = this._teile(readFileSync(p, "utf-8"));
    // Nur der Body wird ersetzt; Status, Titel und Labels gehoeren anderen Kommandos,
    // die Kommentarbloecke der Datei gehen Byte fuer Byte dahinter zurueck.
    writeFileSync(p, serializeFrontmatter(meta, body + rest), "utf-8");
  }

  // Nur das Feld `labels` wird angefasst — alle uebrigen Metadaten, der Body und die
  // Kommentarbloecke gehen unveraendert durch serializeFrontmatter zurueck. Bleibt kein Label uebrig,
  // verschwindet das Feld ganz: `labels: ` waere beim naechsten Lesen zwar ebenfalls
  // ein leeres Array, aber eine Zeile, die etwas zu behaupten scheint.
  async labelIssue(id, name, aktion) {
    const p = this._filePath(id);
    if (!existsSync(p)) throw new BoardError(t("issueDateiFehlt", { id, pfad: p }));
    const { meta, body, rest } = this._teile(readFileSync(p, "utf-8"));
    const vorhanden = labelsAusFrontmatter(meta);
    const ergaenzt = vorhanden.includes(name) ? vorhanden : [...vorhanden, name];
    const neu = aktion === "add" ? ergaenzt : vorhanden.filter((l) => l !== name);
    if (neu.length > 0) meta.labels = neu.join(", ");
    else delete meta.labels;
    writeFileSync(p, serializeFrontmatter(meta, body + rest), "utf-8");
  }
}

class LocalCodeHost {
  schutzUnterstuetzt() { return { ja: false, grund: t("schutzLocal") }; }

  async getRepoName() {
    // Frueher mit 2>/dev/null — die Umleitung gibt es unter cmd.exe nicht (#196);
    // gitRemoteUrl liefert stattdessen null, wenn kein Remote da ist.
    //
    // Liefert seit Issue #214 owner/repo statt nur repo: Alle drei Code-Hosts geben
    // dieselbe Form zurueck, sonst beantwortet dasselbe Kommando je nach Projekt etwas
    // anderes. Ohne Remote bleibt es beim Verzeichnisnamen — dokumentiertes Verhalten
    // des lokalen Modus.
    return normalizeRepoName(gitRemoteUrl()) || basename(resolve("."));
  }

  // Kein createPullRequest und kein mergePullRequest: codePr() und codeMergePr() brechen
  // schon an supportsPullRequests() ab und geben den Hinweis auf den lokalen git-Merge
  // aus. Eine Methode hier waere unerreichbar
  // (entfernt in Issue #188) — und ein zweiter, abweichender Wortlaut fuer denselben Fall.
  supportsPullRequests() { return false; }

  // `keine` liefert ausschliesslich dieser Host: Ein Projekt ohne CI darf nicht
  // releaseunfaehig werden, deshalb Exit 0 und kein Fehler.
  async getCiStatus() {
    return { status: "keine", adresse: null, jobs: [] };
  }

  // Ohne Build-Dienst gibt es kein Protokoll, also keine Verursacher.
  async getVerursacher() { return []; }

  // Ebenso keine Funde aus einem Build-Dienst (Issue #2094).
  async getFunde() { return []; }
}

// ============================================================
// Toolbox-Adapter (eigenes Kanban-Board als Issue-Tracker, #368)
// ============================================================

// Kit-Status <-> KanbanColumn (Backend). Simple Uppercase-Abbildung.
const TOOLBOX_STATUS_TO_COLUMN = {
  backlog:     "BACKLOG",
  ready:       "READY",
  in_progress: "IN_PROGRESS",
  in_review:   "IN_REVIEW",
  done:        "DONE",
};
const TOOLBOX_COLUMN_TO_STATUS = Object.fromEntries(
  Object.entries(TOOLBOX_STATUS_TO_COLUMN).map(([s, c]) => [c, s])
);

/**
 * Loest das kanban-kit-Token pro App auf (#135). Reine Funktion: cfg, env und readFile werden
 * injiziert, damit die Precedence ohne Dateisystem testbar ist. Erste Fundstelle gewinnt:
 *   1. env.TBX_TOKEN (getrimmt)
 *   2. cfg.toolbox.tokenFile — Datei lesen, Inhalt trimmen (Pfad relativ zum cwd)
 *   3. <TBX_CONFIG_DIR | ~/.config/toolbox-cli>/tokens.json .token (globaler tbx-Login, #367)
 * Fail-fast: ein Klartext-Token in der Config (cfg.toolbox.token) bricht immer ab —
 * Secrets gehoeren nicht ins eingecheckte Repo.
 */
export function resolveToolboxToken({ cfg, env, readFile }) {
  if (cfg?.toolbox?.token) {
    throw new BoardError(t("klartextToken"));
  }

  const envToken = (env?.TBX_TOKEN || "").trim();
  if (envToken) return envToken;

  const tokenFile = cfg?.toolbox?.tokenFile;
  if (tokenFile) {
    let content;
    try {
      content = readFile(resolve(tokenFile));
    } catch (e) {
      throw new BoardError(t("tokenDateiUnlesbar", { datei: tokenFile, grund: e.message }));
    }
    const fileToken = (content || "").trim();
    if (!fileToken) throw new BoardError(t("tokenDateiLeer", { datei: tokenFile }));
    return fileToken;
  }

  const dir = env?.TBX_CONFIG_DIR || join(homedir(), ".config", "toolbox-cli");
  let storedToken = "";
  try {
    const tokens = JSON.parse(readFile(join(dir, "tokens.json")));
    if (typeof tokens?.token === "string") storedToken = tokens.token.trim();
  } catch { /* kein oder kaputter tbx-Login — faellt in die Fehlermeldung unten */ }
  if (storedToken) return storedToken;

  throw new BoardError(t("keinToken"));
}

/**
 * Interpretiert die Response von POST /api/kanban/items (#141, Bug #140). Reine Funktion,
 * damit die drei Vertragsfaelle ohne Netz testbar sind:
 *   1. { number } vorhanden — alter Vertrag (Original-Toolbox, kanban-kit vor #373):
 *      die angelegte Board-Karte traegt sofort eine Anzeigenummer.
 *   2. nur { id } — neuer Pool-Vertrag (kanban-kit >= 1.5): der Create landet als board-lose
 *      Idee im Projekt-Ideen-Pool; die Board-Nummer entsteht erst beim menschlichen Einplanen.
 *   3. weder number noch id — harter Fehler mit Response-Auszug, nie stilles "undefined".
 */
export function interpretToolboxCreateResponse(created) {
  if (created?.number != null) return { id: String(created.number) };
  if (created?.id != null) return { id: null, ideaId: String(created.id), pending: true };
  throw new BoardError(t("createAntwortUnerwartet", { antwort: JSON.stringify(created) }));
}

/**
 * Modell-Selbstauskunft fuer Board-Requests (#193). Reine Funktion ueber der Umgebung:
 * Ist KIT_AGENT_MODEL gesetzt (der Runner setzt es auf den Wert von --model und
 * vererbt es ueber die Claude-Session bis in diesen Prozess), tragen die Requests den
 * Header X-Agent-Model. Ohne die Variable — also in jeder interaktiven Session — bleibt
 * er weg; keine Angabe ist ehrlicher als eine geratene.
 *
 * Ausdruecklich eine Selbstauskunft des Clients, kein Nachweis: Der Server kann Session
 * und Token verifizieren, das Modell nicht. Die Board-Seite kennzeichnet den Wert
 * entsprechend ("lt. Angabe").
 */
export function agentModelHeader(env = process.env) {
  const model = (env.KIT_AGENT_MODEL || "").trim();
  return model ? { "X-Agent-Model": model } : {};
}

/**
 * Laufkennung fuer Board-Requests (Issue #1194). Reine Funktion ueber der Umgebung wie
 * agentModelHeader: Ist KIT_NIGHT_RUN gesetzt (der Runner setzt es auf den `start`
 * seines Ergebnisstands, denselben Wert, den die Laufmeldung als `startedAt` sendet),
 * tragen die Requests den Header `X-Night-Run`. Daran ordnet das Board jede Aktivitaet
 * ihrem Lauf zu, auch wenn zwei Laeufe mit demselben Token gleichzeitig schreiben.
 * Ohne die Variable — in jeder interaktiven Session — bleibt er weg.
 */
export function nightRunHeader(env = process.env) {
  const lauf = (env.KIT_NIGHT_RUN || "").trim();
  return lauf ? { "X-Night-Run": lauf } : {};
}

/** Die Strenge im Header-Wert von V1 (Plan #2102). */
const STRENGE_HEADER = Object.freeze({ leicht: "light", normal: "normal", streng: "strict" });

/**
 * Die Strenge des Projekts fuer jede Board-Anfrage (Issue #2113, Plan #2102, V1, E1): Header
 * X-Kit-Strictness mit `light`, `normal` oder `strict`, abgeleitet ueber strengeVorgaben, damit
 * der Leitstand sie an jedem Projekt zeigt, auch ohne Runner. Ohne Schluessel `normal`.
 */
export function strictnessHeader(config) {
  return { "X-Kit-Strictness": STRENGE_HEADER[strengeVorgaben(normalisiereConfig(config ?? {}).config).strenge] };
}

/**
 * Issue-Tracker gegen das eigene Toolbox-Kanban-Board. Zwei-Achsen-Modell (#368): der Code liegt
 * weiter auf GitHub (codeHost bleibt github), nur der Issue-Tracker ist das Board.
 *
 * Auth: Token per resolveToolboxToken() (TBX_TOKEN > toolbox.tokenFile > globaler tbx-Login,
 * #135); Host aus ~/.config/toolbox-cli/config.json (dieselbe Quelle wie das tbx-CLI, #367),
 * per config.toolbox.host ueberschreibbar. Alle Aufrufe tragen den Header X-Kanban-Token,
 * unbeaufsichtigt zusaetzlich X-Agent-Model als Selbstauskunft (siehe agentModelHeader) und
 * `X-Night-Run` als Laufkennung (siehe nightRunHeader).
 *
 * number vs. DB-id: Der Workflow adressiert Issues ueber die Board-Anzeigenummer (#N). Move/Comment
 * brauchen die DB-id aus der Item-Response; sie wird intern per Board-Fetch aufgeloest.
 */
export class ToolboxIssueTracker {
  /**
   * `uhr` haelt alles, was die Wiederholschleife aus der Umwelt braucht (Issue #834):
   * Zeitquelle, Schlafen, Zufall und die Meldespur. Injizierbar, damit die Tests die
   * Schleife ohne echtes Warten durchlaufen — eine Schleife, die real bis zu zwei
   * Minuten braucht, waere sonst nur durch Warten belegbar und bliebe ungeprueft.
   */
  constructor(config, uhr = {}) {
    this._cfg = config;
    // Nummer -> { id, title } je Instanz (Plan #1638, E2, E3): Interne ID und Titel
    // aendert das Kit innerhalb eines Aufrufs nie; alles andere wird frisch gelesen.
    this._zuordnung = new Map();
    this._jetzt = uhr.jetzt ?? Date.now;
    this._schlaf = uhr.schlaf ?? sleep;
    this._zufall = uhr.zufall ?? Math.random;
    this._melde = uhr.melde ?? ((zeile) => process.stderr.write(`${zeile}\n`));
  }

  _auth() {
    return { host: this._host(), token: this._token() };
  }

  _host() {
    const dir = process.env.TBX_CONFIG_DIR || join(homedir(), ".config", "toolbox-cli");
    const stored = this._readJson(join(dir, "config.json"));
    const host = this._cfg.toolbox?.host || stored?.host;
    if (!host) {
      throw new BoardError(t("keinHost"));
    }
    return host;
  }

  _token() {
    return resolveToolboxToken({
      cfg: this._cfg,
      env: process.env,
      readFile: (path) => readFileSync(path, "utf-8"),
    });
  }

  /**
   * Anmeldung, Spalten und Labels, rein lesend (Issue #1776, E5, E8, E16): Spalten aus den
   * Schluesseln von `GET /api/kanban/items`, Labels aus `GET /api/kanban/labels`, beide mit
   * hoechstens zwei Versuchen. Keine Route mit Board-ID, die kennt der Adapter nicht.
   */
  async einrichtung() {
    let host;
    try {
      host = this._host();
    } catch (e) {
      const offen = nichtPruefbar(e.message);
      return { adresse: null, erreichbar: offen, angemeldet: offen, spalten: offen, labels: offen, grund: e.message };
    }
    try {
      this._token();
    } catch (e) {
      return einrichtungOhneAnmeldung(host, e.message, nichtPruefbar(e.message));
    }
    const lies = async (pfad) => (await this._fetch(pfad, { hoechstensVersuche: 2 })).json();
    let spalten;
    try {
      const gruppen = await lies("/api/kanban/items");
      spalten = VALID_STATUSES.filter((s) => Object.hasOwn(gruppen, TOOLBOX_STATUS_TO_COLUMN[s]));
    } catch (e) {
      const mangel = this._einrichtungsMangel(host, e);
      if (mangel) return mangel;
      spalten = nichtPruefbar(e.message);
    }
    let labels;
    try {
      labels = labelNamesFrom(await lies("/api/kanban/labels"));
    } catch (e) {
      const mangel = this._einrichtungsMangel(host, e);
      if (mangel) return mangel;
      // Rueckfall aus E16: Ein kanban-kit ohne die Route antwortet mit 404.
      labels = nichtPruefbar(e.status === 404 ? t("labelsRouteFehlt") : e.message);
    }
    return { adresse: host, erreichbar: true, angemeldet: true, spalten, labels };
  }

  /** Die Fehlerart eines Wurfs aus `_fetch` (E8): 401 und 403 Anmeldung, 5xx und Netzfehler unerreichbar. */
  _einrichtungsMangel(host, e) {
    if (e.status === 401 || e.status === 403) return einrichtungOhneAnmeldung(host, e.message);
    if (e.netz || e.status >= 500) return einrichtungUnerreichbar(host, e.message);
    return null;
  }

  _readJson(path) {
    if (!existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return null; }
  }

  /**
   * Der eine Weg ans Board — mit Zeitgrenze, Wiederholung und Idempotenz-Schluessel
   * (Issue #834). Die Regeln stehen ueber den reinen Funktionen darueber
   * (darfWiederholen, rueckmeldungFuer, wartezeitMs); hier steht nur ihre Reihenfolge.
   *
   * `options.idempotencyKey` traegt den Schluessel fuer die beiden Endpunkte, die ihn
   * serverseitig auswerten. Er entsteht je Auftrag und bleibt ueber ALLE Versuche
   * gleich — sonst waere jede Wiederholung ein neuer Auftrag, und genau das soll der
   * Schluessel verhindern.
   *
   * `options.hoechstensVersuche` begrenzt die Zahl der Versuche zusaetzlich zum Budget
   * (Issue #1681); ohne die Option wird bis zum Budget wiederholt.
   */
  async _fetch(path, options = {}) {
    const { host, token } = this._auth();
    const { idempotencyKey, hoechstensVersuche, ...rest } = options;
    const method = (rest.method || "GET").toUpperCase();
    const headers = { ...rest.headers, "X-Kanban-Token": token, ...agentModelHeader(), ...nightRunHeader(), ...strictnessHeader(this._cfg) };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const budget = toolboxBudgetMs();
    const frist = this._jetzt() + budget;
    const versuchMs = toolboxVersuchMs(budget);

    for (let versuch = 1; ; versuch++) {
      let res = null;
      let wurf = null;
      try {
        res = await fetch(`${host}${path}`, { ...rest, headers, signal: AbortSignal.timeout(versuchMs) });  // eslint-disable-line no-await-in-loop -- NOSONAR S9382: ein Versuch wartet per Definition auf den vorigen
      } catch (e) {
        wurf = e;
      }
      if (res?.ok) return res;
      // Die 401-Sonderbehandlung steht vor allem anderen und wird nie wiederholt:
      // Ein widerrufener Token wird durch Warten nicht gueltig, und die Meldung
      // nennt den einzigen Ausweg.
      if (res?.status === 401) {
        const abgewiesen = new BoardError(t("tokenUngueltig"));
        abgewiesen.status = 401;
        throw abgewiesen;
      }

      const status = res?.status ?? null;
      const netz = wurf ? netzfehlerArt(wurf) : null;
      const { grund, typ, retryAfter } = await this._fehlerlage(res, wurf);  // eslint-disable-line no-await-in-loop -- NOSONAR S9382: ein Versuch wartet per Definition auf den vorigen
      const warte = wartezeitMs(versuch, retryAfter, this._zufall);
      const nochmal = darfWiederholen({ method, status, typ, hatSchluessel: Boolean(idempotencyKey), netz })
        && this._jetzt() + warte <= frist
        && (hoechstensVersuche === undefined || versuch < hoechstensVersuche);
      if (!nochmal) throw this._fehler({ status, netz, wurf, grund, method, path, idempotencyKey, host });

      // Eine Zeile je Wiederholung, nicht je Aufruf: Wer einem automatischen Lauf zusieht,
      // soll Warten von Haengen unterscheiden koennen. Eine Zeile auch im
      // Erfolgsfall ertraenkte genau dieses Signal.
      this._melde(t("wiederholZeile", { methode: method, pfad: path, versuch, grund, warte, frist: Math.round(budget / 1000) }));
      await this._schlaf(warte);  // eslint-disable-line no-await-in-loop -- NOSONAR S9382: ein Versuch wartet per Definition auf den vorigen
    }
  }

  /** Namensaufloesung oder Verbindung scheiterte hinter einem Proxy: die Abhilfe nennen (Issue #998). */
  _proxyZusatz(netz) {
    if (netz === "zeitablauf" || !netz || !proxyGesetzt(process.env)) return "";
    return `\n${proxyHinweis()}`;
  }

  /**
   * Der Fehler am Ende der Schleife — mit Rueckmeldung und, wo noetig, dem Weg zurueck.
   * `status` traegt den HTTP-Status der letzten Antwort, ohne Antwort `null` (Issue #1248,
   * Plan #1243, E13): Ein Aufrufer erkennt eine Abweisung daran, nicht am Meldungstext.
   */
  _fehler({ status, netz, wurf, grund, method, path, idempotencyKey, host }) {
    const rueckmeldung = rueckmeldungFuer({ status, netz, method });
    const basis = wurf
      ? t("apiNichtErreichbar", { host, grund: wurf.message }) + this._proxyZusatz(netz)
      : t("apiFehler", { grund });
    const text = rueckmeldung === RUECKMELDUNG.AUSGANG_UNKLAR
      ? `${basis}\n${this._unklarHinweis(method, path, idempotencyKey)}`
      : basis;
    const fehler = new BoardError(text, rueckmeldung);
    fehler.status = status;
    // Ohne Status die Art des Netzfehlers aus netzfehlerArt (Issue #1776, E8), sonst null.
    fehler.netz = netz;
    return fehler;
  }

  /**
   * Liest die Lage eines fehlgeschlagenen Versuchs aus: Klartext-Grund, Problem-`type`
   * und `Retry-After`. Der Rumpf wird genau einmal gelesen — ein zweiter Zugriff auf
   * denselben Stream liefert nichts mehr.
   *
   * Der Status bleibt im Grund stehen, auch wenn der Server eine eigene Meldung
   * schickt (Issue #460): Fuer den Aufrufer ist der Unterschied zwischen 404 und 500
   * die Diagnose — "Route gibt es nicht" gegen "Route ist kaputt".
   */
  async _fehlerlage(res, wurf) {
    if (!res) return { grund: t("netzfehler", { name: wurf.name, meldung: wurf.message }), typ: null, retryAfter: null };
    let grund = `HTTP ${res.status}`;
    let typ = null;
    try {
      const body = await res.json();
      if (body?.message) grund = `${grund}: ${body.message}`;
      if (typeof body?.type === "string") typ = body.type;
    } catch { /* kein JSON-Body */ }
    const roh = res.headers?.get?.("retry-after");
    const sek = roh === null || roh === undefined || roh === "" ? null : Number(roh);
    return { grund, typ, retryAfter: Number.isFinite(sek) ? sek : null };
  }

  /** Der Zusatz zur Meldung "Ausgang unklar": was passiert sein kann und wie es weitergeht. */
  _unklarHinweis(method, path, schluessel) {
    const kopf = t("unklarKopf", { methode: method, pfad: path });
    if (!schluessel) return `${kopf} ${t("unklarOhneSchluessel")}`;
    return `${kopf} ${t("unklarMitSchluessel", { schluessel })}\n  ${wiederholKommando(schluessel)}`;
  }

  _toColumn(status) {
    const column = TOOLBOX_STATUS_TO_COLUMN[status];
    if (!column) throw new BoardError(t("statusUngueltig", { status, gueltig: VALID_STATUSES.join(", ") }));
    return column;
  }

  _toStatus(column) {
    return TOOLBOX_COLUMN_TO_STATUS[column] || null;
  }

  /** Liest das gruppierte Board und liefert eine flache Liste inkl. abgeleitetem Status. */
  async _boardItems() {
    const res = await this._fetch("/api/kanban/items");
    const grouped = await res.json();
    return Object.values(grouped)
      .flat()
      .map((item) => ({ ...item, status: this._toStatus(item.column) }));
  }

  _findByNumber(items, number) {
    return items.find((i) => i.number === number) || null;
  }

  /**
   * Eine Karte per Einzelabruf statt ueber die ganze Kartenliste (Issue #1650, Plan #1638,
   * E1). 404 und eine archivierte Karte melden `issueFehlt` wie eine Nummer, die in der
   * Liste fehlt (E5, E6) und nehmen den Eintrag der Zuordnung mit (Issue #1668); jeder
   * andere Fehler aus `_fetch` geht unveraendert durch. Die Kommentare kommen aus derselben
   * Antwort (E7).
   */
  async _karte(n) {
    const num = Number(n);
    const fehlt = () => {
      this._zuordnung.delete(num);
      return new BoardError(t("issueFehlt", { id: num }));
    };
    let res;
    try {
      res = await this._fetch(`/api/kanban/items/by-number/${num}`);
    } catch (e) {
      if (e instanceof BoardError && e.status === 404) throw fehlt();
      throw e;
    }
    const detail = await res.json();
    if (detail.archived) throw fehlt();
    const item = { ...detail.item, status: this._toStatus(detail.item.column) };
    this._zuordnung.set(num, { id: item.id, title: item.title });
    return { item, comments: normalizeComments(detail.comments ?? []) };
  }

  /** Interne ID und Titel: aus der Zuordnung, sonst per `_karte` (E2). Ein Eintrag gilt als nicht archiviert (E5). */
  async _kartenRef(n) {
    const num = Number(n);
    return this._zuordnung.get(num) ?? (await this._karte(num)).item;
  }

  async createIssue({ title, body, derivedFrom, idempotencyKey }) {
    const { host } = this._auth();
    // Neu angelegte Issues gehen immer DIREKT ins Backlog und tragen sofort ihre
    // Board-Nummer (Issue #313). Den Ideen-Speicher gibt es nicht mehr, sein Schalter
    // `toolbox.ideaStored` ist entfallen und wirkt nicht (Issue #1726, Plan #1710 A11).
    // Das Wire-Feld heisst `direct` (Issue #295); Backends ohne `direct` ignorieren es
    // und legen wie bisher an.
    const payload = { title, body: body || "", column: "BACKLOG", direct: true };
    // Die Herkunft geht nur beim Anlegen mit (Issue #356). Ein Nachtragen gibt es
    // nicht: Eine board-lose Pool-Idee ist fuer den Adapter unerreichbar, und der
    // idempotente Wiederholungs-Ingest verwirft ein spaeter mitgeschicktes Feld.
    //
    // Instanzen, die `derivedFrom` nicht kennen, ignorieren den Schluessel still —
    // die Karte entsteht, die Herkunft fehlt, nichts weist darauf hin. Anders als
    // bei `direct` daneben gibt es hier bewusst KEINEN Waechter: Er braeuchte ein
    // Echo in der Antwort, und genau die Pool-Idee liefert keines. Eine Absicherung,
    // die im wichtigsten Fall nicht greift, waere schlechter als die benannte
    // Luecke — sie steht in docs/dokumentation.md.
    if (derivedFrom !== undefined) payload.derivedFrom = derivedFrom;
    // Einer der beiden Endpunkte, die den Idempotenz-Schluessel auswerten (Issue #834).
    // Ohne Vorgabe von aussen entsteht er hier, einmal je Auftrag: Alle Versuche
    // desselben _fetch tragen ihn, eine spaetere Wiederholung von Hand bekommt ihn
    // ueber `--idempotency-key` aus der Fehlermeldung.
    const res = await this._fetch("/api/kanban/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      idempotencyKey: idempotencyKey || randomUUID(),
    });
    const created = await res.json();
    const result = interpretToolboxCreateResponse(created);
    // interpretToolboxCreateResponse wertet nur die Antwort aus und kennt den
    // gesendeten Modus nicht — deshalb sitzt die Pruefung hier. Ohne sie meldete ein
    // direkt angefordertes Anlegen, das nur eine ideaId zurueckbringt, faelschlich
    // eine Idee ohne Nummer: Der Aufruf saehe erfolgreich aus, die Karte haette
    // keine Nummer, und niemand bemerkt es.
    if (result.pending) {
      throw new BoardError(t("direktOhneNummer"));
    }
    return { ...result, url: `${host}/kanban` };
  }

  async getIssue(number) {
    const { item, comments } = await this._karte(number);
    const type = item.type || "task";
    return {
      id: String(item.number),
      title: item.title,
      body: item.body,
      // Ein Vorhaben hat keinen Status: `CardService.move` laesst es gar nicht auf
      // dem Board positionieren, die Compat-API liefert BACKLOG nur als Fallback.
      // `null` heisst "hat keinen" — das ist die Wahrheit (Issue #377).
      status: type === "epic" ? null : item.status,
      labels: labelNamesFrom(item.labels),
      type,
      comments,
      // Das obere `createdAt` der Detailantwort bleibt ungelesen (Plan #1638, E8).
      // Der Feldname der Karten-API ist nicht gegen die Live-Instanz belegt (#457,
      // manueller Pruefpunkt). Darum drei Kandidaten statt eines geratenen Namens:
      // createdAt fuehrt der Kommentar-Endpunkt derselben API bereits, created_at
      // ist die REST-uebliche Form, created die knappe. Liefert die Instanz keins
      // davon, fehlt `created` — #450/#451 muessen damit rechnen.
      ...createdFrom(item.createdAt, item.created_at, item.created),
    };
  }

  /**
   * Aktivitaetsverlauf einer Karte (Issue #460).
   *
   * Die Route ist `/api/kanban/items/{id}/activity` (Issue #670) und adressiert die
   * **interne** ID — dieselbe Falle wie bei move, comments und labels (Befund vom
   * 2026-08-29). Daher `_kartenRef`. Sie gibt es seit kanban-kit v1.43.0: Dort
   * bleibt ein board-gebundenes Token auf `/api/kanban/**` beschraenkt (kanban-kit
   * #877), und der Verlauf ist innerhalb dieser Grenze lesbar (#876). Die fruehere
   * Karten-Route ausserhalb der Grenze beantwortet ein solches Token mit 403.
   *
   * **Ein Fehler wird nicht geschluckt**; eine leere Liste waere hier falsch. Der Verlauf ist die Quelle des Anlagedatums — eine
   * leere Liste hiesse „Karte ohne Geschichte" und liesse das Gate ein altes Paket fuer
   * neu halten. Der Aufrufer soll den Fehler sehen, samt HTTP-Status.
   */
  async listActivity(number) {
    const item = await this._kartenRef(number);
    const res = await this._fetch(`/api/kanban/items/${item.id}/activity`);
    return await res.json();
  }

  /**
   * Die Anhaenge einer Karte (Issue #1681): `GET /api/kanban/items/{id}/attachments` mit der
   * internen ID, ein nacktes Array je `{ id, cardId, filename, contentType, size, createdAt }`.
   * Rein lesend; bei einer Drosselung genau ein zweiter Versuch.
   */
  async listAttachments(number) {
    const item = await this._kartenRef(number);
    const res = await this._fetch(`/api/kanban/items/${item.id}/attachments`, { hoechstensVersuche: 2 });
    return await res.json();
  }

  /** Der Inhalt eines Anhangs als Bytes (Issue #1681); ein fehlender Anhang ergibt 404. */
  async downloadAttachment(number, attachmentId) {
    const item = await this._kartenRef(number);
    const res = await this._fetch(`/api/kanban/items/${item.id}/attachments/${encodeURIComponent(attachmentId)}`, { hoechstensVersuche: 2 });
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * Sammelform des Verlaufs (Issue #786).
   *
   * Der Grund fuer diese Methode steht in EINER Zeile: `_boardItems()` laeuft genau
   * einmal. Die Einzelform holt die vollstaendige Kartenliste bei jedem Aufruf mit;
   * die Ruecklaeuferquote fragt Dutzende Karten ab und haette sie sonst Dutzende Male
   * geholt — gegen eine API, die drosselt.
   *
   * Eine nicht auffindbare Nummer wird zum Eintrag mit Fehlergrund. Ein TRANSPORTFEHLER
   * dagegen — 403, 404 auf die Verlaufs-Route, Netz weg — reisst den Aufruf rot ab, wie
   * in der Einzelform: Er betrifft nicht eine Karte, sondern den Zugang. Still
   * weitergezaehlt ergaebe er eine Quote, die nach Null aussieht und in Wahrheit nichts
   * gemessen hat.
   *
   * Die Verlaeufe kommen gleichzeitig, hoechstens VERLAUF_GLEICHZEITIG auf einmal
   * (Issue #1095): Nacheinander addierten sich Dutzende Wartezeiten, alle auf einmal
   * liefen in die Drosselung.
   */
  async listActivityMany(numbers) {
    const items = await this._boardItems();
    const eintraege = await hoechstensGleichzeitig(VERLAUF_GLEICHZEITIG, numbers, async (number) => {
      const item = this._findByNumber(items, Number(number));
      if (!item) return { fehler: t("issueFehlt", { id: number }) };
      const res = await this._fetch(`/api/kanban/items/${item.id}/activity`);
      return await res.json();
    });
    const ergebnis = {};
    numbers.forEach((number, i) => { ergebnis[number] = eintraege[i]; });
    return ergebnis;
  }

  // Ohne eigene Status-Validierung: issueList() im Dispatch prueft den Wert gegen
  // VALID_STATUSES, bevor irgendein Tracker ihn sieht — die Pruefung hier war
  // unerreichbar (entfernt in Issue #188) und als einzige der vier Tracker doppelt.
  async listIssues(status) {
    const items = await this._boardItems();
    const filtered = items
      // Epics nehmen nicht am Spalten-Workflow teil: bei Status-Filter ausschliessen.
      // Vorhaben sind nie Arbeitspakete — der Ausschluss gilt unabhaengig vom Filter
      // (Issue #377). Die frueher fuehrende Bedingung `!status ||` schaltete ihn ab,
      // sobald ungefiltert gelistet wurde. Sie ersatzlos zu streichen waere falsch:
      // ohne Filter ist `status` undefined, und `i.status === undefined` trifft auf
      // keine echte Karte zu — die Liste kaeme leer zurueck.
      .filter((i) => i.type !== "epic" && (!status || i.status === status));
    // Mit Status-Filter liegen alle Items in derselben Spalte: die API-Reihenfolge
    // (positionInColumn) ist die Board-/Listen-Reihenfolge und bleibt erhalten (#128);
    // ungefiltert bleibt die stabile numerische Sortierung.
    if (!status) filtered.sort((a, b) => a.number - b.number);
    // Die Karten-API liefert Labels — gegen die Live-Instanz belegt am 2026-08-12
    // (Issue #312). Eine aeltere Antwort ohne das Feld bleibt bei [], deshalb der
    // Normalisierer statt eines direkten Zugriffs. Der Schreibpfad steht seit
    // Issue #375 daneben (siehe labelIssue) — dieser Adapter kann Labels lesen
    // und schreiben.
    // `type` wird durchgereicht wie beim lokalen Tracker, samt dessen Default: ein
    // Item ohne das Feld liefert "task" statt undefined, das JSON.stringify auslassen
    // wuerde (Issue #377).
    return filtered.map((i) => ({ id: String(i.number), title: i.title, body: i.body, status: i.status, labels: labelNamesFrom(i.labels), type: i.type || "task" }));
  }

  async listEpics() {
    const res = await this._fetch("/api/kanban/epics");
    const epics = await res.json();
    return (Array.isArray(epics) ? epics : []).map((e) => ({
      id: String(e.number ?? e.id),
      title: e.title,
      shortcode: e.shortcode || "",
      progress: e.progress || { total: 0, done: 0 },
    }));
  }

  async moveIssue(number, to) {
    const column = this._toColumn(to);
    // Immer frisch: Spalte und Position stehen nie in der Zuordnung (E2).
    const { item } = await this._karte(number);
    // Gleiche Spalte: aktuelle Position halten. Sonst der groesste Java-`int`, den
    // kanban-kit ans Ende der Zielspalte klemmt (E4) — ohne Kartenliste fuer die Laenge.
    const targetPosition = item.column === column ? item.position : 2147483647;
    await this._fetch(`/api/kanban/items/${item.id}/move`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ column, position: targetPosition }),
    });
  }

  async commentIssue(number, text, idempotencyKey) {
    const item = await this._kartenRef(number);
    // Der zweite Endpunkt mit Idempotenz-Schluessel (Issue #834) — und der, bei dem
    // eine Doppelung am meisten weh tut: ein zweimal angelegter Abschlussbericht.
    await this._fetch(`/api/kanban/items/${item.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text }),
      idempotencyKey: idempotencyKey || randomUUID(),
    });
  }

  // Strenges Lesen fuer `issue report` (Issue #1021): Ein Fehler wirft — ein leer
  // gelesener Stand liesse `melden` einen zweiten Bericht anlegen. Immer frisch ueber
  // `_karte`, weil sich die Kommentare im selben Aufruf aendern (Plan #1638, E7).
  async kommentareStreng(number) {
    return (await this._karte(number)).comments;
  }

  // Die Route ist juenger als der Lesepfad. Eine Instanz ohne sie antwortet mit
  // 404/405; die Meldung nennt dann die Route, damit klar ist, dass die Instanz und
  // nicht der Kommentar fehlt.
  async ersetzeKommentar(number, kommentarId, text) {
    const item = await this._kartenRef(number);
    const pfad = `/api/kanban/items/${item.id}/comments/${kommentarId}`;
    try {
      await this._fetch(pfad, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
    } catch (e) {
      const status = e.message.match(/HTTP (40[45])\b/)?.[1];
      if (!status) throw e;
      throw new BoardError(t("routeUnbekannt", { pfad, status }));
    }
  }

  async updateIssue(number, { body }) {
    // Frisch gelesen, nicht aus der Zuordnung: Deren Titel kann seit dem ersten Zugriff
    // veraltet sein, und das PUT schriebe ihn zurueck (Issue #1668).
    const { item } = await this._karte(number);
    await this._fetch(`/api/kanban/items/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      // Der Titel wird mitgeschickt, obwohl er sich nicht aendert: Behandelt das
      // Backend das PUT als Vollersatz, ginge er sonst verloren.
      body: JSON.stringify({ title: item.title, body }),
    });
  }

  // Diese Stelle hat lange geworfen, mit Verweis auf mannewolff/kanban-kit#457: die
  // API biete kein atomares Setzen per Name, und eine listenersetzende Route waere
  // unbrauchbar. Seit kanban-kit#574 stimmt beides nicht mehr — POST ergaenzt genau
  // ein Label, DELETE entfernt genau eines, die uebrige Liste bleibt unangetastet
  // (Issue #375).
  //
  // Zwei Eigenheiten der Routen zaehlen hier:
  //  - Adressiert wird die INTERNE Karten-ID, nicht die Kartennummer — wie bei
  //    /move und /comments. Daher der Umweg ueber _kartenRef — ausserhalb von
  //    `uebersetze`, damit eine fehlende Karte nicht als fehlendes Label gilt.
  //  - Beim Entfernen steht der Name im QUERY, nicht im Pfad. Der Server trimmt ihn
  //    nur und lehnt allein Leerstrings ab; jedes andere Zeichen ist gueltig, auch
  //    `/`. Ein Pfadsegment truege das nicht, weil Tomcat kodierte Slashes per
  //    Default ablehnt — deshalb encodeURIComponent statt Interpolation.
  async labelIssue(number, name, aktion) {
    const ausZuordnung = this._zuordnung.has(Number(number));
    const item = await this._kartenRef(number);
    // Der Server antwortet mit 404, wenn das Board keine Definition dieses Namens
    // fuehrt (LabelNotFoundException) — absichtlich hart, damit ein Tippfehler im
    // automatischen Lauf keinen Label-Muell erzeugt. Roh durchgereicht ist dieser 404 aber
    // nicht zu deuten: Er nennt weder den Namen noch den Ausweg (Issue #384).
    const uebersetze = async (fn) => {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof BoardError && /HTTP 404|nicht gefunden/i.test(e.message)) {
          throw new LabelFehltError(t("labelNichtDefiniert", { name, route: "POST /api/boards/{boardId}/labels" }));
        }
        throw e;
      }
    };
    const aufruf = aktion === "add"
      ? () => this._fetch(`/api/kanban/items/${item.id}/labels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      : () => this._fetch(`/api/kanban/items/${item.id}/labels?name=${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
    try {
      await uebersetze(aufruf);
    } catch (e) {
      // Ein Eintrag der Zuordnung ist ungeprueft: Fehlt die Karte inzwischen, antwortet
      // die Label-Route ebenfalls 404. `_karte` klaert das und wirft dann `issueFehlt`
      // (Issue #1668); nur der Fehlerfall kostet den zweiten Aufruf.
      if (e instanceof LabelFehltError && ausZuordnung) await this._karte(number);
      throw e;
    }
  }

  // Die drei lesenden Archiv-Aufrufe fuer `issue vorgeschichte` (Issue #1538, Plan #1534).
  // Sie erreichen auch archivierte Karten des gebundenen Boards (kanban-kit, Anforderung
  // 1571). Ein Fehlschlag wirft wie jeder andere Aufruf; erst das Kommando bildet ihn auf
  // `archiv-nicht-erreichbar` ab, damit die Regel „Ende beim ersten Fehlschlag“ an einer
  // Stelle sitzt.

  /**
   * Suche ueber Titel, Text und Kommentare, archivierte Karten eingeschlossen. Ohne
   * `kind`-Parameter (E8): Was ein Fachplan ist, entscheidet das Kommando. Gelesen wird
   * ueber `nextCursor` in Teilen, bis keiner mehr kommt oder `limit` Treffer da sind;
   * `mehr` sagt, ob hinter dem Schnitt noch Treffer lagen.
   */
  async sucheFachplaene(begriff, { limit }) {
    const treffer = [];
    let cursor = null;
    for (;;) {
      const query = new URLSearchParams({ q: begriff });
      if (cursor) query.set("cursor", cursor);
      const res = await this._fetch(`/api/kanban/search?${query}`);  // eslint-disable-line no-await-in-loop -- NOSONAR S9382: der naechste Teil braucht den Cursor des vorigen
      const teil = await res.json();  // eslint-disable-line no-await-in-loop -- NOSONAR S9382: der naechste Teil braucht den Cursor des vorigen
      for (const hit of teil.hits || []) {
        if (treffer.length === limit) return { treffer, mehr: true };
        treffer.push({ nummer: hit.number, titel: hit.title, archiviert: Boolean(hit.archived) });
      }
      cursor = teil.nextCursor || null;
      if (!cursor) return { treffer, mehr: false };
      if (treffer.length === limit) return { treffer, mehr: true };
    }
  }

  /** Eine Karte nach Nummer, auch archiviert; `null`, wenn der Server sie mit 404 nicht kennt. */
  async karteNachNummer(n) {
    let res;
    try {
      res = await this._fetch(`/api/kanban/items/by-number/${Number(n)}`);
    } catch (e) {
      // Papierkorb, fremdes Board und eine Instanz ohne die Route sehen hier gleich aus
      // (E7): Fuer das Kommando fehlt die Karte, das Archiv selbst ist erreichbar.
      if (e instanceof BoardError && e.status === 404) return null;
      throw e;
    }
    const detail = await res.json();
    return { nummer: detail.item?.number, titel: detail.item?.title, body: detail.item?.body ?? "", archiviert: Boolean(detail.archived) };
  }

  /**
   * Die Herkunft einer Karte: ihre Vorfahren in der Reihenfolge des Servers, von der
   * Karte aufwaerts. Ein Glied, das fehlt oder im Papierkorb liegt, bleibt als `gap: true`
   * stehen — die Kette soll zeigen, dass dort etwas war.
   */
  async herkunftskette(n) {
    const res = await this._fetch(`/api/kanban/items/by-number/${Number(n)}/lineage`);
    const kette = await res.json();
    return (kette.ancestors || []).map((g) => ({
      nummer: g.number,
      titel: g.title ?? null,
      archiviert: Boolean(g.archived),
      gap: Boolean(g.gap),
    }));
  }
}


// ============================================================
// Adapter-Auswahl
// ============================================================

export function resolveTracker(config) {
  switch (config.issueTracker) {
    case "github": return new GitHubIssueTracker(config);
    case "gitlab": return new GitLabIssueTracker(config);
    case "local":  return new LocalIssueTracker(config);
    case "toolbox": return new ToolboxIssueTracker(config);
    default: fail(t("trackerUnbekannt", { name: config.issueTracker }));
  }
}

export function resolveCodeHost(config) {
  switch (config.codeHost) {
    case "github": return new GitHubCodeHost(config);
    case "gitlab": return new GitLabCodeHost();
    case "local":  return new LocalCodeHost();
    default: fail(t("codeHostUnbekannt", { name: config.codeHost }));
  }
}
