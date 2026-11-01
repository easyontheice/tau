/**
 * Opens the system file picker for a CSV file.
 *
 * The hidden <input type="file"> is attached inside `parent` while the picker is open and removed
 * afterwards. Inside Obsidian's settings (itself a modal), clicks on a detached input are dropped,
 * so the input must be part of the dialog's DOM when it is clicked.
 */
export function pickCsvFile(parent: HTMLElement): Promise<File | null> {
  return new Promise((resolve) => {
    const input = parent.createEl("input", { type: "file", attr: { accept: ".csv,text/csv" } });
    input.hide();
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => finish(null));
    input.click();
  });
}

