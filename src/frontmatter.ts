/**
 * Frontmatter helpers.
 *
 * Obsidian types frontmatter values as `any`. Tau treats them as `unknown` instead and narrows them
 * through these helpers, so a property with an unexpected type (a number, a list, a boolean...)
 * can never crash the timeline or leak an untyped value into the renderer.
 */

/** Frontmatter as plain data. Values stay `unknown` until narrowed. */
export type Frontmatter = Record<string, unknown>;

/** Text value: strings as-is, numbers converted to text, anything else (missing, list, object) is `undefined`. */
export function fmText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

/** List value: a YAML list as an array, anything else as an empty array. */
export function fmArray(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

/** Text shown in a comma-separated editor field: a list is joined with ", ", a single value is shown as-is. */
export function fmListText(value: unknown): string {
  if (Array.isArray(value)) {
    return fmArray(value).map(fmText).filter((v): v is string => v !== undefined).join(", ");
  }
  return fmText(value) ?? "";
}

