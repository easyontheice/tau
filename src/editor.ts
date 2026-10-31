import { App, Modal, Setting, Notice, TFile } from "obsidian";
import { type Frontmatter, fmText, fmListText } from "./frontmatter";
import { TimelineNode } from "./vault-adapter";

export class NodeEditorModal extends Modal {
  private formData: Record<string, string> = {};
  private bodyContent = "";
  private initialSuccessor = "";
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
    const titleHeader = isNew ? "Create new node" : `Edit node: ${(this.target as TimelineNode).title}`;

    contentEl.createEl("h2", { 
        text: titleHeader,
        cls: "tau-modal-title"
    });

    let fm: Frontmatter = {};
    if (!isNew) {
      fm = (this.target as TimelineNode).rawFrontmatter;
    }

    this.formData = {
      "title": fmText(fm["title"]) || (!isNew ? (this.target as TimelineNode).title : ""),
      "timeline-kind": fmText(fm["timeline-kind"]) || "event",
      "global-event": (fm["global-event"] === true || fm["global-event"] === "true") ? "true" : "false",
      "start-date": fmText(fm["start-date"]) || fmText(fm["date"]) || "",
      "end-date": fmText(fm["end-date"]) || "",
      "color": fmText(fm["color"]) || "",
      "title-color": fmText(fm["title-color"]) || "#000000",
      "date-color": fmText(fm["date-color"]) || "", 
      "text-direction": fmText(fm["text-direction"]) || "", 
      "border-style": fmText(fm["border-style"]) || "none",
      "importance": fmText(fm["importance"]) || "",
      "image": fmText(fm["image"]) || "",
      "image-width": fmText(fm["image-width"]) || "",
      "child-of": fmText(fm["child-of"]) || "",
      "successor": fmListText(fm["successor"]), 
      "branch-to": fmListText(fm["branch-to"]),
      "influence-to": fmListText(fm["influence-to"]),
      "measure-to": fmText(fm["measure-to"]) || "",
      "time-travel": fmText(fm["time-travel"]) || "",
      "coordinates": fmText(fm["coordinates"]) || "",
      "horizontal-offset": fmText(fm["horizontal-offset"]) || "",
      "vertical-offset": fmText(fm["vertical-offset"]) || "",
      "span-width": fmText(fm["span-width"]) || "",
      "span-height-offset": fmText(fm["span-height-offset"]) || "",
    };

    this.initialSuccessor = this.formData["successor"];
    const raw = await this.app.vault.read(this.file);
    this.bodyContent = raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();

    contentEl.createEl("h4", { text: "Core properties", cls: "tau-modal-section" });
    
    new Setting(contentEl).setName("Title").addText(t => {
      t.setValue(this.formData["title"]).onChange(v => this.formData["title"] = v);
      t.inputEl.setCssStyles({ width: "100%" }); 
    });

    new Setting(contentEl).setName("Node kind").addDropdown(d => {
      d.addOption("event", "Event (point)");
      d.addOption("span", "Span (ribbon)");
      d.addOption("span-left", "Left span (legend)");
      d.addOption("era", "Era (background)");
      d.addOption("region", "Region (macro box)");
      d.addOption("note", "Note (floating box)");
      d.setValue(this.formData["timeline-kind"]);
      d.onChange(v => this.formData["timeline-kind"] = v);
    });

    new Setting(contentEl).setName("Global event").setDesc("Draws a full-width line across the timeline").addToggle(t => {
      t.setValue(this.formData["global-event"] === "true").onChange(v => this.formData["global-event"] = v ? "true" : "false");
    });

    new Setting(contentEl).setName("Start date").setDesc("e.g., '1453 CE' or '27 BCE'").addText(t => {
      t.setValue(this.formData["start-date"]).onChange(v => this.formData["start-date"] = v);
    });

    new Setting(contentEl).setName("End date").setDesc("Required for spans and regions").addText(t => {
      t.setValue(this.formData["end-date"]).onChange(v => this.formData["end-date"] = v);
    });

    new Setting(contentEl).setName("Coordinates").setDesc("Latitude, longitude").addText(t => {
      t.setValue(this.formData["coordinates"]).onChange(v => this.formData["coordinates"] = v);
    });

    contentEl.createEl("h4", { text: "Aesthetics & visuals", cls: "tau-modal-section" });

    new Setting(contentEl).setName("Primary color").addColorPicker(c => {
      c.setValue(this.formData["color"] || "#1c1917").onChange(v => this.formData["color"] = v);
    });

    new Setting(contentEl).setName("Text color").addColorPicker(c => {
      c.setValue(this.formData["title-color"]).onChange(v => this.formData["title-color"] = v);
    });

    new Setting(contentEl).setName("Date color").setDesc("Leave blank for default colors").addColorPicker(c => {
      c.setValue(this.formData["date-color"]).onChange(v => this.formData["date-color"] = v);
    });

    new Setting(contentEl).setName("Text direction").addDropdown(d => {
      d.addOption("", "Default engine value");
      d.addOption("horizontal", "Horizontal");
      d.addOption("vertical", "Vertical");
      d.setValue(this.formData["text-direction"]);
      d.onChange(v => this.formData["text-direction"] = v);
    });

    new Setting(contentEl).setName("Border style").setDesc("For floating notes").addDropdown(d => {
      d.addOption("none", "None");
      d.addOption("solid", "Solid");
      d.addOption("dashed", "Dashed");
      d.setValue(this.formData["border-style"]);
      d.onChange(v => this.formData["border-style"] = v);
    });

    new Setting(contentEl).setName("Scale importance").setDesc("Increase size (e.g. 0.5)").addText(t => {
      t.setValue(this.formData["importance"]).onChange(v => this.formData["importance"] = v);
    });

    new Setting(contentEl).setName("Image").setDesc("Vault image shown on the timeline, e.g. [[map.png]]").addText(t => {
      t.setValue(this.formData["image"]).onChange(v => this.formData["image"] = v);
    });

    new Setting(contentEl).setName("Image width").setDesc("Width in pixels (default 100)").addText(t => {
      t.setValue(this.formData["image-width"]).onChange(v => this.formData["image-width"] = v);
    });

    contentEl.createEl("h4", { text: "Manual geometry overrides", cls: "tau-modal-section" });

    new Setting(contentEl).setName("Horizontal offset").setDesc("X-axis pixel shift").addText(t => {
      t.setValue(this.formData["horizontal-offset"]).onChange(v => this.formData["horizontal-offset"] = v);
    });

    new Setting(contentEl).setName("Vertical offset").setDesc("Y-axis pixel shift").addText(t => {
      t.setValue(this.formData["vertical-offset"]).onChange(v => this.formData["vertical-offset"] = v);
    });

    new Setting(contentEl).setName("Span width").setDesc("Manual ribbon width").addText(t => {
      t.setValue(this.formData["span-width"]).onChange(v => this.formData["span-width"] = v);
    });

    new Setting(contentEl).setName("Span height offset").setDesc("Extend or shrink height").addText(t => {
      t.setValue(this.formData["span-height-offset"]).onChange(v => this.formData["span-height-offset"] = v);
    });

    contentEl.createEl("h4", { text: "Lineage & connections", cls: "tau-modal-section" });

    new Setting(contentEl).setName("Child of").setDesc("Parent target for S-curve").addText(t => {
      t.setValue(this.formData["child-of"]).onChange(v => this.formData["child-of"] = v);
    });

    new Setting(contentEl).setName("Successor").setDesc("One or more nodes (comma-separated) that follow/integrate this span").addText(t => {
      t.setValue(this.formData["successor"]).onChange(v => this.formData["successor"] = v);
    });

    new Setting(contentEl).setName("Branch to").setDesc("Comma-separated targets for subway splits").addText(t => {
      t.setValue(this.formData["branch-to"]).onChange(v => this.formData["branch-to"] = v);
    });

    new Setting(contentEl).setName("Influence to").setDesc("Comma-separated targets for dashed arrows").addText(t => {
      t.setValue(this.formData["influence-to"]).onChange(v => this.formData["influence-to"] = v);
    });

    new Setting(contentEl).setName("Time travel offset").setDesc("e.g. '1y 2m'").addText(t => {
      t.setValue(this.formData["time-travel"]).onChange(v => this.formData["time-travel"] = v);
    });

    contentEl.createEl("h4", { text: "Description body", cls: "tau-modal-section" });
    
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
        .setButtonText("Save configuration")
        .setCta()
        .onClick(async () => {
          await this.saveNode();
        }));
  }

  async saveNode() {
    await this.app.fileManager.processFrontMatter(this.file, (fm: Frontmatter) => {
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
      // "successor" is written further down so it can hold several nodes 
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

      // Only rewrite "successor" when it was edited, so untouched titles containing commas stay intact
      if (form["successor"] !== this.initialSuccessor) {
        const successors = parseArray(form["successor"]);
        if (successors.length === 0) delete fm["successor"];
        else fm["successor"] = successors.length === 1 ? successors[0] : successors;
      }
    });

    await this.app.vault.process(this.file, (data) => {
      const match = data.match(/^---\n[\s\S]*?\n---\n/);
      const fmString = match ? match[0] : "---\n---\n";
      return fmString + "\n" + this.bodyContent;
    });

    const desiredTitle = this.formData["title"] || "Untitled Node";
    const safeTitle = desiredTitle.replace(/[/\\:*?"<>|]/g, "-").trim();
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

    new Notice("Timeline node saved!");
    this.close();
    this.onSuccess();
  }

  onClose() {
    this.contentEl.empty();
  }
}