import { App, Modal, Setting, Notice, TFile } from "obsidian";
import { TimelineNode } from "./vault-adapter";

export class NodeEditorModal extends Modal {
  private formData: Record<string, string> = {};
  private bodyContent = "";
  private file: TFile;

  constructor(app: App, private target: TimelineNode | TFile, private onSuccess: () => void) {
    super(app);
    this.file = target instanceof TFile ? target : target.file;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tau-inspector-modal");

    const isNew = this.target instanceof TFile;
    const titleHeader = isNew ? "Create New Node" : `Edit Node: ${(this.target as TimelineNode).title}`;

    contentEl.createEl("h2", { 
        text: titleHeader,
        cls: "tau-modal-title"
    });

    let fm: Record<string, any> = {};
    if (!isNew) {
      fm = (this.target as TimelineNode).rawFrontmatter;
    }

    this.formData = {
      "title": fm["title"] || (!isNew ? (this.target as TimelineNode).title : ""),
      "timeline-kind": fm["timeline-kind"] || "event",
      "global-event": (fm["global-event"] === true || fm["global-event"] === "true") ? "true" : "false",
      "start-date": fm["start-date"] || fm["date"] || "",
      "end-date": fm["end-date"] || "",
      "color": fm["color"] || "",
      "title-color": fm["title-color"] || "#000000",
      "date-color": fm["date-color"] || "", 
      "text-direction": fm["text-direction"] || "", 
      "border-style": fm["border-style"] || "none",
      "importance": fm["importance"]?.toString() || "",
      "image": fm["image"] || "",
      "image-width": fm["image-width"]?.toString() || "",
      "child-of": fm["child-of"] || "",
      "successor": fm["successor"] || "", 
      "branch-to": Array.isArray(fm["branch-to"]) ? fm["branch-to"].join(", ") : (fm["branch-to"] || ""),
      "influence-to": Array.isArray(fm["influence-to"]) ? fm["influence-to"].join(", ") : (fm["influence-to"] || ""),
      "measure-to": fm["measure-to"] || "",
      "time-travel": fm["time-travel"] || "",
      "coordinates": fm["coordinates"] || "",
      "horizontal-offset": fm["horizontal-offset"]?.toString() || "",
      "vertical-offset": fm["vertical-offset"]?.toString() || "",
      "span-width": fm["span-width"]?.toString() || "",
      "span-height-offset": fm["span-height-offset"]?.toString() || "",
    };

    const raw = await this.app.vault.read(this.file);
    this.bodyContent = raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();

    contentEl.createEl("h4", { text: "Core Properties", cls: "tau-modal-section" });
    
    new Setting(contentEl).setName("Title").addText(t => {
      t.setValue(this.formData["title"]).onChange(v => this.formData["title"] = v);
      t.inputEl.setCssStyles({ width: "100%" }); 
    });

    new Setting(contentEl).setName("Node Kind").addDropdown(d => {
      d.addOption("event", "Event (Point)");
      d.addOption("span", "Span (Ribbon)");
      d.addOption("span-left", "Left Span (Legend)");
      d.addOption("era", "Era (Background)");
      d.addOption("region", "Region (Macro Box)");
      d.addOption("note", "Note (Floating Box)");
      d.setValue(this.formData["timeline-kind"]);
      d.onChange(v => this.formData["timeline-kind"] = v);
    });

    new Setting(contentEl).setName("Global Event").setDesc("Draws a full-width line across the timeline").addToggle(t => {
      t.setValue(this.formData["global-event"] === "true").onChange(v => this.formData["global-event"] = v ? "true" : "false");
    });

    new Setting(contentEl).setName("Start Date").setDesc("e.g., '1453 CE' or '27 BCE'").addText(t => {
      t.setValue(this.formData["start-date"]).onChange(v => this.formData["start-date"] = v);
    });

    new Setting(contentEl).setName("End Date").setDesc("Required for Spans and Regions").addText(t => {
      t.setValue(this.formData["end-date"]).onChange(v => this.formData["end-date"] = v);
    });

    new Setting(contentEl).setName("Coordinates").setDesc("latitude, longitude").addText(t => {
      t.setValue(this.formData["coordinates"]).onChange(v => this.formData["coordinates"] = v);
    });

    contentEl.createEl("h4", { text: "Aesthetics & Visuals", cls: "tau-modal-section" });

    new Setting(contentEl).setName("Primary Color").addColorPicker(c => {
      c.setValue(this.formData["color"] || "#1c1917").onChange(v => this.formData["color"] = v);
    });

    new Setting(contentEl).setName("Text Color").addColorPicker(c => {
      c.setValue(this.formData["title-color"]).onChange(v => this.formData["title-color"] = v);
    });

    new Setting(contentEl).setName("Date Color").setDesc("Leave blank for default colors").addColorPicker(c => {
      c.setValue(this.formData["date-color"]).onChange(v => this.formData["date-color"] = v);
    });

    new Setting(contentEl).setName("Text Direction").addDropdown(d => {
      d.addOption("", "Default Engine Value");
      d.addOption("horizontal", "Horizontal");
      d.addOption("vertical", "Vertical");
      d.setValue(this.formData["text-direction"]);
      d.onChange(v => this.formData["text-direction"] = v);
    });

    new Setting(contentEl).setName("Border Style").setDesc("For floating notes").addDropdown(d => {
      d.addOption("none", "None");
      d.addOption("solid", "Solid");
      d.addOption("dashed", "Dashed");
      d.setValue(this.formData["border-style"]);
      d.onChange(v => this.formData["border-style"] = v);
    });

    new Setting(contentEl).setName("Scale Importance").setDesc("Increase size (e.g. 0.5)").addText(t => {
      t.setValue(this.formData["importance"]).onChange(v => this.formData["importance"] = v);
    });

    contentEl.createEl("h4", { text: "Manual Geometry Overrides", cls: "tau-modal-section" });

    new Setting(contentEl).setName("Horizontal Offset").setDesc("X-axis pixel shift").addText(t => {
      t.setValue(this.formData["horizontal-offset"]).onChange(v => this.formData["horizontal-offset"] = v);
    });

    new Setting(contentEl).setName("Vertical Offset").setDesc("Y-axis pixel shift").addText(t => {
      t.setValue(this.formData["vertical-offset"]).onChange(v => this.formData["vertical-offset"] = v);
    });

    new Setting(contentEl).setName("Span Width").setDesc("Manual ribbon width").addText(t => {
      t.setValue(this.formData["span-width"]).onChange(v => this.formData["span-width"] = v);
    });

    new Setting(contentEl).setName("Span Height Offset").setDesc("Extend or shrink height").addText(t => {
      t.setValue(this.formData["span-height-offset"]).onChange(v => this.formData["span-height-offset"] = v);
    });

    contentEl.createEl("h4", { text: "Lineage & Connections", cls: "tau-modal-section" });

    new Setting(contentEl).setName("Child Of").setDesc("Parent target for S-Curve").addText(t => {
      t.setValue(this.formData["child-of"]).onChange(v => this.formData["child-of"] = v);
    });

    new Setting(contentEl).setName("Successor").setDesc("Dynasty that follows/integrates this span").addText(t => {
      t.setValue(this.formData["successor"]).onChange(v => this.formData["successor"] = v);
    });

    new Setting(contentEl).setName("Branch To").setDesc("Comma-separated targets for subway splits").addText(t => {
      t.setValue(this.formData["branch-to"]).onChange(v => this.formData["branch-to"] = v);
    });

    new Setting(contentEl).setName("Influence To").setDesc("Comma-separated targets for dashed arrows").addText(t => {
      t.setValue(this.formData["influence-to"]).onChange(v => this.formData["influence-to"] = v);
    });

    new Setting(contentEl).setName("Time Travel Offset").setDesc("e.g. '1y 2m'").addText(t => {
      t.setValue(this.formData["time-travel"]).onChange(v => this.formData["time-travel"] = v);
    });

    contentEl.createEl("h4", { text: "Description Body", cls: "tau-modal-section" });
    
    const textAreaContainer = contentEl.createDiv();
    textAreaContainer.setCssStyles({ width: "100%" });

    const textArea = textAreaContainer.createEl("textarea");
    textArea.setCssStyles({
      width: "100%",
      height: "180px",
      resize: "vertical",
      padding: "10px",
      fontFamily: "var(--font-monospace)"
    });
    textArea.value = this.bodyContent;
    
    textArea.addEventListener("input", (e) => {
      this.bodyContent = (e.target as HTMLTextAreaElement).value;
    });

    const buttonContainer = contentEl.createDiv();
    buttonContainer.setCssStyles({
      display: "flex",
      justifyContent: "flex-end",
      marginTop: "20px"
    });

    new Setting(buttonContainer)
      .addButton(b => b
        .setButtonText("Save Configuration")
        .setCta()
        .onClick(async () => {
          await this.saveNode();
        }));
  }

  async saveNode() {
    await this.app.fileManager.processFrontMatter(this.file, (fm) => {
      const form = this.formData;
      
      const writeOrDelete = (key: string, val: string | null) => {
        if (!val || val.trim() === "") delete fm[key];
        else fm[key] = val;
      };

      writeOrDelete("title", form["title"]);
      writeOrDelete("timeline-kind", form["timeline-kind"]);
      writeOrDelete("start-date", form["start-date"]);
      writeOrDelete("end-date", form["end-date"]);
      writeOrDelete("color", form["color"]);
      writeOrDelete("title-color", form["title-color"]);
      writeOrDelete("date-color", form["date-color"]); 
      writeOrDelete("text-direction", form["text-direction"]);
      writeOrDelete("border-style", form["border-style"]);
      writeOrDelete("image", form["image"]);
      writeOrDelete("child-of", form["child-of"]);
      writeOrDelete("successor", form["successor"]); 
      writeOrDelete("time-travel", form["time-travel"]);
      writeOrDelete("coordinates", form["coordinates"]);

      if (form["global-event"] === "true") {
        fm["global-event"] = true;
      } else {
        delete fm["global-event"];
      }

      const numericKeys = ["importance", "image-width", "horizontal-offset", "vertical-offset", "span-width", "span-height-offset"];
      for (const key of numericKeys) {
        const val = parseFloat(form[key]);
        if (isNaN(val) || (key === "importance" && val === 0)) delete fm[key];
        else fm[key] = val;
      }

      const parseArray = (str: string) => str.split(",").map(s => s.trim()).filter(Boolean);
      
      const branches = parseArray(form["branch-to"]);
      if (branches.length > 0) fm["branch-to"] = branches;
      else delete fm["branch-to"];

      const influences = parseArray(form["influence-to"]);
      if (influences.length > 0) fm["influence-to"] = influences;
      else delete fm["influence-to"];
    });

    await this.app.vault.process(this.file, (data) => {
      const match = data.match(/^---\n[\s\S]*?\n---\n/);
      const fmString = match ? match[0] : "---\n---\n";
      return fmString + "\n" + this.bodyContent;
    });

    const desiredTitle = this.formData["title"] || "Untitled Node";
    const safeTitle = desiredTitle.replace(/[\/\\:*?"<>|]/g, "-").trim();
    const parentFolder = this.file.parent;
    const parentPath = parentFolder && parentFolder.path !== "/" ? `${parentFolder.path}/` : "";
    const newPath = `${parentPath}${safeTitle}.md`;

    if (this.file.path !== newPath) {
      let finalPath = newPath;
      let counter = 1;
      
      while (this.app.vault.getAbstractFileByPath(finalPath)) {
        finalPath = `${parentPath}${safeTitle}-${counter}.md`;
        counter++;
      }
      
      try {
        await this.app.fileManager.renameFile(this.file, finalPath);
      } catch (err) {
        console.error("tau: Failed to rename node", err);
      }
    }

    new Notice("Timeline Node Saved!");
    this.close();
    this.onSuccess();
  }

  onClose() {
    this.contentEl.empty();
  }
}