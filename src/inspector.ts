import { App, MarkdownRenderer, Component } from "obsidian";
import { TimelineNode } from "./vault-adapter";

export class NodeInspectorModal extends Component {
  private containerEl: HTMLElement;

  constructor(private app: App, private node: TimelineNode, private onClose: () => void) {
    super();
    this.containerEl = createDiv();
    this.containerEl.className = "tau-inspector-overlay";
  }

  async open(): Promise<void> {
    activeDocument.body.append(this.containerEl);
    this.load();
    await this.renderLayout();
  }

  close(): void {
    this.unload();
    this.containerEl.remove();
    this.onClose();
  }

  private async renderLayout(): Promise<void> {
    this.containerEl.empty();

    const panel = this.containerEl.createDiv({ cls: "tau-inspector-panel" });
    
    // Header
    const header = panel.createDiv({ cls: "tau-inspector-header" });
    header.createEl("h1", { text: this.node.title });
    const closeBtn = header.createEl("button", { text: "✕", cls: "tau-inspector-close" });
    closeBtn.onclick = () => this.close();

    // Content Body Scroll Area
    const body = panel.createDiv({ cls: "tau-inspector-body" });

    // 1. Render Note Markdown Body natively (And ONLY the markdown body)
    const contentSection = body.createDiv({ cls: "tau-inspector-section" });
    try {
      const file = this.node.file;
      const cachedContent = await this.app.vault.cachedRead(file);
      const bodyContent = cachedContent.replace(/^---\n[\s\S]*?\n---\n/, "");
      await MarkdownRenderer.render(this.app, bodyContent, contentSection, file.path, this);
    } catch {
      contentSection.createEl("p", { text: "Could not load note body contents." });
    }
  }
}