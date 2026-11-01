import { App, TFile, normalizePath, stringifyYaml } from "obsidian";
import { type Frontmatter } from "./frontmatter";

/** One CSV row keyed by its (trimmed) column header. */
export type CsvRecord = Record<string, string>;

export interface ParsedCsv {
  headers: string[];
  records: CsvRecord[];
}

export interface ImportResult {
  created: number;
  updated: number;
}

/**
 * RFC 4180 CSV parser. Handles quoted fields containing commas, escaped quotes ("") and line
 * breaks (multi-paragraph descriptions), CRLF or LF line endings, and the BOM Excel adds.
 */
export function parseCsv(text: string): ParsedCsv {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((v) => v.trim() !== ""));
  if (nonEmpty.length < 2) return { headers: [], records: [] };

  const headers = nonEmpty[0].map((h) => h.trim());
  const records = nonEmpty.slice(1).map((values) => {
    const record: CsvRecord = {};
    headers.forEach((h, idx) => {
      if (h) record[h] = (values[idx] ?? "").trim();
    });
    return record;
  });
  return { headers, records };
}

const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g;

/** Column names used as {{placeholders}} in a folder template that don't exist in the CSV. */
export function findUnknownPlaceholders(template: string, headers: string[]): string[] {
  const known = new Set(headers.map((h) => h.toLowerCase()));
  const unknown: string[] = [];
  const pattern = new RegExp(PLACEHOLDER.source, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(template)) !== null) {
    const name = match[1];
    if (!known.has(name.toLowerCase()) && !unknown.includes(name)) unknown.push(name);
  }
  return unknown;
}

/** Makes a CSV value safe to use as a single folder or file name. */
export function sanitizePathSegment(value: string): string {
  return value
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
}

/**
 * Resolves a destination folder for one row. "Timeline/{{region}}" becomes "Timeline/Levant".
 * Placeholders match column names case-insensitively; a blank value drops that folder level,
 * so the row lands in the parent folder instead of a folder with no name.
 */
export function resolveFolderTemplate(template: string, record: CsvRecord): string {
  const lookup = new Map<string, string>();
  for (const key of Object.keys(record)) lookup.set(key.toLowerCase(), record[key]);

  const segments = template
    .split("/")
    .map((segment) =>
      segment.replace(PLACEHOLDER, (_whole, name: string) => sanitizePathSegment(lookup.get(name.toLowerCase()) ?? ""))
    )
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "");
  return segments.length > 0 ? normalizePath(segments.join("/")) : "";
}

const LIST_COLUMNS = new Set(["branch-to", "influence-to"]);
const NUMBER_COLUMNS = new Set(["importance", "horizontal-offset", "vertical-offset", "span-width", "span-height-offset", "image-width"]);
const TEXT_COLUMNS = new Set([
  "timeline-kind", "start-date", "end-date", "date", "color", "title-color", "date-color", "text-direction",
  "coordinates", "child-of", "image", "measure-to", "time-travel",
]);

/** Value of a column, matching the header case-insensitively ("Title" works as well as "title"). */
export function getColumn(record: CsvRecord, name: string): string {
  if (name in record) return record[name];
  const wanted = name.toLowerCase();
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === wanted) return record[key];
  }
  return "";
}

/**
 * Converts one CSV row into frontmatter. Tau's own columns get their proper types (numbers,
 * lists, booleans); every other column is kept as a text property under its original name.
 * Blank cells are skipped, so updating an existing note never erases a value.
 */
export function recordToFrontmatter(record: CsvRecord): Frontmatter {
  const fm: Frontmatter = {};
  fm["timeline"] = getColumn(record, "timeline") || "main";

  for (const header of Object.keys(record)) {
    const value = record[header];
    const key = header.toLowerCase();
    if (key === "title" || key === "timeline" || value === "") continue;

    if (NUMBER_COLUMNS.has(key)) {
      const num = parseFloat(value);
      if (!isNaN(num) && (key !== "importance" || num !== 0)) fm[key] = num;
    } else if (LIST_COLUMNS.has(key)) {
      const list = value.split(",").map((s) => s.trim()).filter(Boolean);
      if (list.length > 0) fm[key] = list;
    } else if (key === "successor") {
      const list = value.split(",").map((s) => s.trim()).filter(Boolean);
      if (list.length > 0) fm[key] = list.length === 1 ? list[0] : list;
    } else if (key === "global-event") {
      if (value.toLowerCase() === "true") fm[key] = true;
    } else if (key === "border-style") {
      if (value !== "none") fm[key] = value;
    } else if (TEXT_COLUMNS.has(key)) {
      fm[key] = value;
    } else {
      // Unrecognised column: keep it as a text property under its original name
      fm[header] = value;
    }
  }
  return fm;
}

export interface ImportOptions {
  folderTemplate: string;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Imports parsed CSV rows as notes. New notes are written in a single file write (frontmatter
 * included), existing notes with the same path only get the non-blank columns merged into their
 * frontmatter, and note bodies are never touched.
 */
export async function importCsvRecords(app: App, records: CsvRecord[], options: ImportOptions): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0 };
  const knownFolders = new Set<string>();

  const ensureFolder = async (path: string) => {
    if (!path || knownFolders.has(path)) return;
    let current = "";
    for (const part of path.split("/")) {
      current = current ? `${current}/${part}` : part;
      if (knownFolders.has(current)) continue;
      if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
      knownFolders.add(current);
    }
  };

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const title = getColumn(record, "title") || "Untitled Node";
    const folder = resolveFolderTemplate(options.folderTemplate, record);
    const fileName = `${sanitizePathSegment(title) || "Untitled Node"}.md`;
    const filePath = normalizePath(folder ? `${folder}/${fileName}` : fileName);
    const fm = recordToFrontmatter(record);

    const existing = app.vault.getAbstractFileByPath(filePath);
    if (existing instanceof TFile) {
      await app.fileManager.processFrontMatter(existing, (target: Frontmatter) => {
        Object.assign(target, fm);
      });
      result.updated++;
    } else {
      await ensureFolder(folder);
      const yaml = stringifyYaml({ title, ...fm });
      // The description also goes in the body so it shows in the double-click reader
      const description = getColumn(record, "description");
      const body = description ? `# ${title}\n\n${description.replace(/\r\n?/g, "\n")}\n` : `# ${title}\n`;
      await app.vault.create(filePath, `---\n${yaml.endsWith("\n") ? yaml : yaml + "\n"}---\n\n${body}`);
      result.created++;
    }

    if ((i + 1) % 25 === 0 || i === records.length - 1) {
      options.onProgress?.(i + 1, records.length);
      // Yield so Obsidian stays responsive during very large imports
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  }
  return result;
}
