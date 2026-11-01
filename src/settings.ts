import { App, Notice, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import type tauPlugin from "./main";
import { pickCsvFile } from "./file-picker";

export interface TauSettings {
  /** Destination for imported notes. May contain {{column}} placeholders, e.g. "Timeline/{{region}}". */
  importFolder: string;
  /** Font size (px) of the dates drawn on world spans. */
  spanDateSize: number;
  /** Font size (px) of the dates drawn on left spans. */
  leftSpanDateSize: number;
  /** Added to the importance (text size) of every event. */
  eventImportance: number;
  /** Added to the importance (text size) of every span. */
  spanImportance: number;
  /** Added to the importance (text size) of every left span. */
  leftSpanImportance: number;
}

export const MIN_IMPORTANCE = -1;
export const MAX_IMPORTANCE = 5;

/** Accepts a stored importance boost only if it is a number in range; otherwise uses the fallback. */
export function clampImportance(value: unknown, fallback: number): number {
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (!isFinite(num)) return fallback;
  return Math.min(MAX_IMPORTANCE, Math.max(MIN_IMPORTANCE, num));
}

export const MIN_DATE_SIZE = 6;
export const MAX_DATE_SIZE = 40;

/** Accepts a stored/entered size only if it is a number in range; otherwise uses the fallback. */
export function clampDateSize(value: unknown, fallback: number): number {
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (!isFinite(num)) return fallback;
  return Math.min(MAX_DATE_SIZE, Math.max(MIN_DATE_SIZE, num));
}

export const DEFAULT_SETTINGS: TauSettings = {
  importFolder: "Timeline",
  spanDateSize: 10,
  leftSpanDateSize: 10,
  eventImportance: 0,
  spanImportance: 0,
  leftSpanImportance: 0,
};

export class TauSettingTab extends PluginSettingTab {
  private csvText = "";
  private csvName = "";
  private importing = false;

  constructor(app: App, private plugin: tauPlugin) {
    super(app, plugin);
  }

  /** Persist as usual, then redraw open timelines so text-size changes show immediately. */
  async setControlValue(key: string, value: unknown): Promise<void> {
    await super.setControlValue(key, value);
    this.plugin.applyDisplaySettings();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const importanceIsValid = (value: number) =>
      value >= MIN_IMPORTANCE && value <= MAX_IMPORTANCE ? undefined : `Enter a value from ${MIN_IMPORTANCE} to ${MAX_IMPORTANCE}.`;
    const importanceDesc = (kind: string) =>
      `Added to the importance (text size) of every ${kind}. 0 = no change, 0.5 = 50% larger, negative values make text smaller. Each note's own importance still applies on top, and nothing is written to your notes.`;
    const sizeIsValid = (value: number) =>
      value >= MIN_DATE_SIZE && value <= MAX_DATE_SIZE ? undefined : `Enter a size from ${MIN_DATE_SIZE} to ${MAX_DATE_SIZE}.`;
    return [
      {
        name: "Span date text size",
        desc: "Font size in pixels for the dates on spans (default 10). Also available from the timeline's right-click menu.",
        aliases: ["font", "date", "span"],
        control: { type: "number", key: "spanDateSize", min: MIN_DATE_SIZE, max: MAX_DATE_SIZE, step: 1, defaultValue: DEFAULT_SETTINGS.spanDateSize, validate: sizeIsValid },
      },
      {
        name: "Left span date text size",
        desc: "Font size in pixels for the dates on left spans (default 10).",
        aliases: ["font", "date", "left span", "legend"],
        control: { type: "number", key: "leftSpanDateSize", min: MIN_DATE_SIZE, max: MAX_DATE_SIZE, step: 1, defaultValue: DEFAULT_SETTINGS.leftSpanDateSize, validate: sizeIsValid },
      },
      {
        name: "Event importance",
        desc: importanceDesc("event"),
        aliases: ["text size", "font", "event", "event-importance"],
        control: { type: "number", key: "eventImportance", min: MIN_IMPORTANCE, max: MAX_IMPORTANCE, step: 0.1, defaultValue: 0, validate: importanceIsValid },
      },
      {
        name: "Span importance",
        desc: importanceDesc("span"),
        aliases: ["text size", "font", "span", "span-importance"],
        control: { type: "number", key: "spanImportance", min: MIN_IMPORTANCE, max: MAX_IMPORTANCE, step: 0.1, defaultValue: 0, validate: importanceIsValid },
      },
      {
        name: "Left span importance",
        desc: importanceDesc("left span"),
        aliases: ["text size", "font", "left span", "legend", "left-span-importance"],
        control: { type: "number", key: "leftSpanImportance", min: MIN_IMPORTANCE, max: MAX_IMPORTANCE, step: 0.1, defaultValue: 0, validate: importanceIsValid },
      },
      {
        name: "Import destination folder",
        desc: "Where imported notes are created. Use {{column}} to sort notes into subfolders by a CSV column, for example Timeline/{{region}}. Rows with a blank value go in the parent folder.",
        aliases: ["csv", "folder", "subfolder"],
        // Stored in plugin.settings.importFolder by PluginSettingTab's default getControlValue/setControlValue
        control: { type: "text", key: "importFolder", placeholder: "Timeline", defaultValue: DEFAULT_SETTINGS.importFolder },
      },
      {
        name: "CSV file",
        desc: "Columns Tau knows (dates, colors, links, offsets...) are imported with the right types; any other column becomes a text property with the same name.",
        aliases: ["csv", "import", "dataset"],
        render: (setting) => {
          if (this.csvName) setting.setDesc(`Selected: ${this.csvName}`);
          setting.addButton((button) =>
            button.setButtonText(this.csvName ? "Choose another file" : "Choose file").onClick(async () => {
              const file = await pickCsvFile(setting.controlEl);
              if (!file) return;
              this.csvText = await file.text();
              this.csvName = file.name;
              setting.setDesc(`Selected: ${file.name}`);
              button.setButtonText("Choose another file");
            })
          );
        },
      },
      {
        name: "Import",
        desc: "The timeline pauses reloading while the import runs and refreshes once at the end. Existing notes with the same path only get the CSV's non-blank values merged into their properties; note bodies are never changed.",
        aliases: ["csv", "import"],
        render: (setting) => {
          setting.addButton((button) =>
            button
              .setButtonText(this.importing ? "Importing..." : "Import CSV")
              .setCta()
              .setDisabled(this.importing)
              .onClick(async () => {
                if (!this.csvText) {
                  new Notice("Choose a CSV file first.");
                  return;
                }
                this.importing = true;
                button.setDisabled(true).setButtonText("Importing...");
                try {
                  const result = await this.plugin.importCsv(this.csvText, this.plugin.settings.importFolder, (done, total) => {
                    setting.setDesc(`Importing ${done} of ${total} rows...`);
                  });
                  if (result) setting.setDesc(`Last import: ${result.created} created, ${result.updated} updated.`);
                } finally {
                  this.importing = false;
                  button.setDisabled(false).setButtonText("Import CSV");
                }
              })
          );
        },
      },
    ];
  }
}
