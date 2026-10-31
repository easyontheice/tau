import { App, ItemView, Plugin, WorkspaceLeaf, Menu, Notice, Modal, Setting, TFile, FuzzySuggestModal, debounce } from "obsidian";
import { VaultAdapter, TimelineNode } from "./vault-adapter";
import { TimelineCanvasRenderer, ViewportState } from "./timeline-canvas";
import { NodeInspectorModal } from "./inspector";
import { NodeEditorModal } from "./editor";
import { type Frontmatter } from "./frontmatter";

export const TIMELINE_VIEW_TYPE = "tau-timeline-view";

export default class tauPlugin extends Plugin {
  vaultAdapter!: VaultAdapter;

  async onload(): Promise<void> {
    this.vaultAdapter = new VaultAdapter(this.app);

    this.registerView(
      TIMELINE_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new tauTimelineView(leaf, this)
    );

    this.addRibbonIcon("history", "Open Tau", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-timeline",
      name: "Open timeline",
      callback: () => {
        void this.activateView();
      },
    });

    this.addCommand({
      id: "import-csv",
      name: "Import timeline nodes from CSV",
      callback: () => {
        const leaves = this.app.workspace.getLeavesOfType(TIMELINE_VIEW_TYPE);
        const view = leaves[0]?.view instanceof tauTimelineView ? leaves[0].view : undefined;
        new CsvImportModal(this.app, async () => {
          if (view) {
            await view.reloadNodes();
          }
        }).open();
      },
    });
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(TIMELINE_VIEW_TYPE)[0];

    if (!leaf) {
      const newLeaf = workspace.getLeaf(false);
      await newLeaf.setViewState({ type: TIMELINE_VIEW_TYPE, active: true });
      leaf = newLeaf;
    }

    await workspace.revealLeaf(leaf);
  }
}

export class tauTimelineView extends ItemView {
  private renderer!: TimelineCanvasRenderer;
  private canvas!: HTMLCanvasElement;
  private resizeObserver!: ResizeObserver;
  private nodes: TimelineNode[] = [];
  private viewport: ViewportState = { viewStart: -1000, viewSpan: 3000, panOffsetX: 0 };
  private isDragging = false;
  private isBoxSelecting = false; 
  private dragStartX = 0;
  private dragStartY = 0;
  private activeDraggedNodes: TimelineNode[] = []; 
  private pendingChildNode: TimelineNode | null = null; 
  private pendingMeasureNode: TimelineNode | null = null; 
  private pendingBranchNode: TimelineNode | null = null; 
  private pendingInfluenceNode: TimelineNode | null = null; 
  private pendingAlignNode: TimelineNode | null = null; 
  private pendingSuccessorNode: TimelineNode | null = null; 

  constructor(leaf: WorkspaceLeaf, private plugin: tauPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return TIMELINE_VIEW_TYPE;
  }

  getIcon(): string {
    return "history";
  }

  getDisplayText(): string {
    return "Tau";
  }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("tau-view-container");

    this.canvas = container.createEl("canvas", { cls: "tau-canvas" });
    const ctx = this.canvas.getContext("2d")!;

    this.renderer = new TimelineCanvasRenderer(this.canvas, ctx, this.viewport, this.nodes);
    this.renderer.leftStripWidth = parseInt(String(this.app.loadLocalStorage("tau-left-width") || "200"));
    this.renderer.autoFitSpans = this.app.loadLocalStorage("tau-auto-fit-spans") !== "false";
    
    await this.reloadNodes();

    this.registerDomEvent(this.canvas, "wheel", (e: WheelEvent) => {
      e.preventDefault(); 
      if (e.ctrlKey || e.metaKey) {
        const ratio = e.offsetY / this.canvas.clientHeight;
        const focusTime = this.viewport.viewStart + this.viewport.viewSpan * ratio;
        const factor = e.deltaY > 0 ? 1.15 : 0.87;
        this.viewport.viewSpan = Math.max(1 / 366, Math.min(40000, this.viewport.viewSpan * factor));
        this.viewport.viewStart = focusTime - this.viewport.viewSpan * ratio;
      } else {
        if (e.shiftKey) {
          this.viewport.panOffsetX -= e.deltaY;
        } else {
          const timeDelta = (e.deltaY / this.canvas.clientHeight) * this.viewport.viewSpan;
          this.viewport.viewStart += timeDelta;
        }
      }
      this.renderer.scheduleDraw();
    }, { passive: false });

    this.registerDomEvent(this.canvas, "contextmenu", (e: MouseEvent) => {
      e.preventDefault(); 
      const rect = this.canvas.getBoundingClientRect();
      const hit = this.renderer.hitTest(e.clientX - rect.left, e.clientY - rect.top);
      const menu = new Menu();

      if (hit && !hit.isPhantom) { 
        menu.addItem((item) => {
          item.setTitle("Edit node properties").setIcon("settings").onClick(() => {
            new NodeEditorModal(this.app, hit, () => {
               void this.reloadNodes();
            }).open();
          });
        });

        menu.addItem((item) => {
          item.setTitle("Open Markdown file").setIcon("file-text").onClick(() => {
            void this.app.workspace.getLeaf("tab").openFile(hit.file);
          });
        });

        menu.addItem((item) => {
          item.setTitle(hit.imageUrl ? "Change image..." : "Assign image...").setIcon("image").onClick(() => {
            new ImageSuggestModal(this.app, (imageFile) => {
              const link = this.app.metadataCache.fileToLinktext(imageFile, hit.file.path, false);
              void this.app.fileManager.processFrontMatter(hit.file, (fm: Frontmatter) => {
                fm["image"] = `[[${link}]]`;
              });
              new Notice(`Image assigned to ${hit.title}`);
            }).open();
          });
        });

        if (hit.imageUrl) {
          menu.addItem((item) => {
            item.setTitle("Set image width...").setIcon("move-horizontal").onClick(() => {
              const current = String(hit.imageWidth ?? 100);
              new TextInputModal(this.app, "Set image width", "Width in pixels (default 100). Leave blank to reset.", current, (val) => {
                const trimmed = val.trim();
                const num = parseInt(trimmed);
                if (trimmed !== "" && (isNaN(num) || num <= 0)) {
                  new Notice("Please enter a positive number of pixels.");
                  return;
                }
                void this.app.fileManager.processFrontMatter(hit.file, (fm: Frontmatter) => {
                  if (trimmed === "") delete fm["image-width"];
                  else fm["image-width"] = num;
                });
              }).open();
            });
          });

          menu.addItem((item) => {
            item.setTitle("Remove image").setIcon("image-off").onClick(() => {
              void this.app.fileManager.processFrontMatter(hit.file, (fm: Frontmatter) => {
                delete fm["image"];
                delete fm["image-width"];
              });
            });
          });
        }
        
        menu.addSeparator();

        menu.addItem((item) => {
          const isMulti = this.renderer.selectedNodeIds.has(hit.id) && this.renderer.selectedNodeIds.size > 1;
          item.setTitle(isMulti ? `Delete ${this.renderer.selectedNodeIds.size} nodes` : "Delete node")
              .setIcon("trash")
              .onClick(async () => {
                if (isMulti) {
                  for (const id of this.renderer.selectedNodeIds) {
                    const nodeToDelete = this.nodes.find(n => n.id === id);
                    if (nodeToDelete) await this.app.fileManager.trashFile(nodeToDelete.file);
                  }
                  new Notice(`Vaporized ${this.renderer.selectedNodeIds.size} nodes.`);
                  this.renderer.selectedNodeIds.clear();
                } else {
                  await this.app.fileManager.trashFile(hit.file);
                  new Notice(`Vaporized ${hit.title}`);
                }
                void this.reloadNodes();
              });
        });

        menu.addSeparator();

        menu.addItem((item) => {
          item.setTitle("Align horizontally to...").setIcon("align-center").onClick(() => {
            this.pendingAlignNode = hit;
            new Notice("Click on a target node to align horizontally.");
          });
        });

        menu.addItem((item) => {
          item.setTitle("Succeeded by...").setIcon("arrow-right-circle").onClick(() => {
            this.pendingSuccessorNode = hit;
            new Notice("Click a node to add it as a successor (click an existing successor to remove it).");
          });
        });

        menu.addItem((item) => {
          item.setTitle("Child of...").setIcon("link").onClick(() => {
            this.pendingChildNode = hit;
            new Notice("Click on a node to set it as the S-curve parent.");
          });
        });

        menu.addItem((item) => {
          item.setTitle("Branch to...").setIcon("git-merge").onClick(() => {
            this.pendingBranchNode = hit;
            new Notice("Click on a target node to draw an orthogonal split.");
          });
        });

        menu.addItem((item) => {
          item.setTitle("Influence to...").setIcon("corner-up-right").onClick(() => {
            this.pendingInfluenceNode = hit;
            new Notice("Click on a target node to draw an influence arrow.");
          });
        });

        menu.addItem((item) => {
          item.setTitle("Measure to...").setIcon("ruler").onClick(() => {
            this.pendingMeasureNode = hit;
            new Notice("Click on a target node to measure distance.");
          });
        });

      } else {
        menu.addItem((item) => {
          item.setTitle("New node").setIcon("plus").onClick(async () => {
             const safeName = `Tau-New_Event-${Date.now()}.md`;
             const newFile = await this.app.vault.create(
                safeName, 
                "---\ntimeline: main\ntimeline-kind: event\ntitle-color: '#000000'\n---\n"
             );
             new NodeEditorModal(this.app, newFile, () => {
                void this.reloadNodes();
             }).open();
          });
        });
        
        menu.addItem((item) => {
          item.setTitle("Set left strip width").setIcon("panel-left").onClick(() => {
             const current = this.renderer.leftStripWidth.toString();
             new TextInputModal(this.app, "Set left strip width", "Enter pixel width (e.g., 200). Use 0 to hide.", current, (val) => {
                const num = parseInt(val);
                if (!isNaN(num) && num >= 0) {
                   this.renderer.leftStripWidth = num;
                   this.app.saveLocalStorage("tau-left-width", num.toString());
                   this.renderer.scheduleDraw();
                }
             }).open();
          });
        });

        menu.addItem((item) => {
          item.setTitle("Import nodes from CSV...").setIcon("file-up").onClick(() => {
            new CsvImportModal(this.app, async () => {
              await this.reloadNodes();
            }).open();
          });
        });

        menu.addItem((item) => {
          item.setTitle("Auto-scatter all events").setIcon("list-restart").onClick(async () => {
            new Notice("Scattering timeline... Please wait.");
            
            const events = this.nodes
              .filter(n => !n.isPhantom && n.kind !== "era" && n.kind !== "span-left" && n.kind !== "region")
              .sort((a, b) => a.startTime - b.startTime);

            const stepX = 20;
            const maxLanes = Math.floor((1000 - 20) / stepX) + 1; 
            const skipX = 7; 
            const assignedLanes = new Map<string, number>();

            for (let i = 0; i < events.length; i++) {
              const node = events[i];
              const predecessor = events.find(p => p.kind === "span" && (p.successors.includes(node.title) || p.successors.includes(node.file.basename)));
              
              let curX: number;
              let curY: number;

              if (predecessor && assignedLanes.has(predecessor.id)) {
                // Split successors sit side by side across the predecessor's width
                const siblings = predecessor.successors.length;
                const index = Math.max(predecessor.successors.indexOf(node.title), predecessor.successors.indexOf(node.file.basename));
                const slice = (predecessor.spanWidth ?? 28) / Math.max(1, siblings);
                curX = assignedLanes.get(predecessor.id)! + (siblings > 1 ? Math.round((index - (siblings - 1) / 2) * slice) : 0);
                curY = (i % 5) * 10;
              } else {
                const lane = (i * skipX) % maxLanes;
                curX = 20 + (lane * stepX);
                curY = (i % 5) * 10;
              }

              assignedLanes.set(node.id, curX);
              
              if (node.horizontalOffset !== curX || node.verticalOffset !== curY) {
                node.horizontalOffset = curX;
                node.verticalOffset = curY;
                await this.app.fileManager.processFrontMatter(node.file, (fm: Frontmatter) => {
                  fm["horizontal-offset"] = curX;
                  fm["vertical-offset"] = curY;
                });
              }

              if (i % 25 === 0 && i > 0) await new Promise(r => window.setTimeout(r, 10));
            }
            
            this.renderer.scheduleDraw();
            new Notice("Auto-scatter complete!");
          });
        });
      }
      
      menu.addSeparator();

      menu.addItem((item) => {
        item.setTitle(this.renderer.showMinorNodes ? "Hide minor nodes (importance < 0)" : "Show minor nodes").setIcon("eye-off").onClick(() => {
          this.renderer.showMinorNodes = !this.renderer.showMinorNodes;
          this.renderer.scheduleDraw();
        });
      });

      menu.addItem((item) => {
        item.setTitle(this.renderer.showTitles ? "Hide titles" : "Show titles").setIcon("type").onClick(() => {
          this.renderer.showTitles = !this.renderer.showTitles;
          this.renderer.scheduleDraw();
        });
      });
      menu.addItem((item) => {
        item.setTitle(this.renderer.showEventDates ? "Hide event dates" : "Show event dates").setIcon("calendar").onClick(() => {
          this.renderer.showEventDates = !this.renderer.showEventDates;
          this.renderer.scheduleDraw();
        });
      });
      menu.addItem((item) => {
        item.setTitle(this.renderer.showLeftSpanDates ? "Hide left span dates" : "Show left span dates").setIcon("calendar").onClick(() => {
          this.renderer.showLeftSpanDates = !this.renderer.showLeftSpanDates;
          this.renderer.scheduleDraw();
        });
      });
      menu.addItem((item) => {
        item.setTitle(this.renderer.showSpanDates ? "Hide span dates" : "Show span dates").setIcon("calendar").onClick(() => {
          this.renderer.showSpanDates = !this.renderer.showSpanDates;
          this.renderer.scheduleDraw();
        });
      });
      menu.addItem((item) => {
        item.setTitle(this.renderer.autoFitSpans ? "Disable span auto-fit" : "Enable span auto-fit").setIcon("maximize-2").onClick(() => {
          this.renderer.autoFitSpans = !this.renderer.autoFitSpans;
          this.app.saveLocalStorage("tau-auto-fit-spans", String(this.renderer.autoFitSpans));
          this.renderer.scheduleDraw();
        });
      });
      menu.addItem((item) => {
        item.setTitle(this.renderer.showGridlines ? "Hide gridlines" : "Show gridlines").setIcon("grid").onClick(() => {
          this.renderer.showGridlines = !this.renderer.showGridlines;
          this.renderer.scheduleDraw();
        });
      });
      menu.addItem((item) => {
        item.setTitle(this.renderer.showEventSpineLines ? "Hide event anchors" : "Show event anchors").setIcon("minus").onClick(() => {
          this.renderer.showEventSpineLines = !this.renderer.showEventSpineLines;
          this.renderer.scheduleDraw();
        });
      });
      menu.addItem((item) => {
        item.setTitle(this.renderer.showSpanSpineLines ? "Hide span anchors" : "Show span anchors").setIcon("minus").onClick(() => {
          this.renderer.showSpanSpineLines = !this.renderer.showSpanSpineLines;
          this.renderer.scheduleDraw();
        });
      });

      menu.showAtMouseEvent(e);
    });

    this.registerDomEvent(this.canvas, "pointerdown", (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (e.shiftKey) {
        this.isBoxSelecting = true;
        this.dragStartX = x;
        this.dragStartY = y;
        this.canvas.setPointerCapture(e.pointerId);
        return;
      }

      const hit = this.renderer.hitTest(x, y);

      if (this.pendingSuccessorNode) {
        if (hit && !hit.isPhantom && hit.id !== this.pendingSuccessorNode.id) {
          const predecessor = this.pendingSuccessorNode;
          const isExisting = predecessor.successors.includes(hit.title) || predecessor.successors.includes(hit.file.basename);
          const nextSuccessors = isExisting
            ? predecessor.successors.filter(s => s !== hit.title && s !== hit.file.basename)
            : [...predecessor.successors, hit.title];
          predecessor.successors = nextSuccessors;

          // World spans: line the successors up evenly across the predecessor's width
          if (predecessor.kind === "span") this.layoutWorldSuccessors(predecessor);

          void this.app.fileManager.processFrontMatter(predecessor.file, (fm: Frontmatter) => {
            if (nextSuccessors.length === 0) delete fm["successor"];
            else fm["successor"] = nextSuccessors.length === 1 ? nextSuccessors[0] : nextSuccessors;
          });
          new Notice(isExisting ? `Removed ${hit.title} as a successor.` : `Added ${hit.title} as a successor.`);
          this.renderer.scheduleDraw();
        } else {
          new Notice("Successor linking cancelled.");
        }
        this.pendingSuccessorNode = null;
        return; 
      }

      if (this.pendingAlignNode) {
        if (hit && !hit.isPhantom && hit.id !== this.pendingAlignNode.id) {
          const targetX = hit.horizontalOffset;
          this.pendingAlignNode.horizontalOffset = targetX;
          void this.app.fileManager.processFrontMatter(this.pendingAlignNode.file, (fm: Frontmatter) => {
            fm["horizontal-offset"] = targetX;
          });
          new Notice(`Aligned horizontally to ${hit.title}`);
          this.renderer.scheduleDraw();
        } else {
          new Notice("Alignment cancelled.");
        }
        this.pendingAlignNode = null;
        return; 
      }

      if (this.pendingChildNode) {
        if (hit && !hit.isPhantom && hit.id !== this.pendingChildNode.id) {
          void this.app.fileManager.processFrontMatter(this.pendingChildNode.file, (fm: Frontmatter) => {
            fm["child-of"] = hit.title;
          });
          new Notice(`Linked to ${hit.title}`);
        } else {
          new Notice("Linking cancelled.");
        }
        this.pendingChildNode = null;
        return; 
      }

      if (this.pendingBranchNode) {
        if (hit && !hit.isPhantom && hit.id !== this.pendingBranchNode.id) {
          void this.app.fileManager.processFrontMatter(this.pendingBranchNode.file, (fm: Frontmatter) => {
            const current = fm["branch-to"];
            if (Array.isArray(current)) {
              if (!current.includes(hit.title)) current.push(hit.title);
            } else if (typeof current === "string") {
              fm["branch-to"] = [current, hit.title];
            } else {
              fm["branch-to"] = [hit.title];
            }
          });
          new Notice(`Branched to ${hit.title}`);
        } else {
          new Notice("Branching cancelled.");
        }
        this.pendingBranchNode = null;
        return; 
      }

      if (this.pendingInfluenceNode) {
        if (hit && !hit.isPhantom && hit.id !== this.pendingInfluenceNode.id) {
          void this.app.fileManager.processFrontMatter(this.pendingInfluenceNode.file, (fm: Frontmatter) => {
            const current = fm["influence-to"];
            if (Array.isArray(current)) {
              if (!current.includes(hit.title)) current.push(hit.title);
            } else if (typeof current === "string") {
              fm["influence-to"] = [current, hit.title];
            } else {
              fm["influence-to"] = [hit.title];
            }
          });
          new Notice(`Influence arrow pointed to ${hit.title}`);
        } else {
          new Notice("Influence linking cancelled.");
        }
        this.pendingInfluenceNode = null;
        return; 
      }

      if (this.pendingMeasureNode) {
        if (hit && !hit.isPhantom && hit.id !== this.pendingMeasureNode.id) {
          void this.app.fileManager.processFrontMatter(this.pendingMeasureNode.file, (fm: Frontmatter) => {
            fm["measure-to"] = hit.title;
          });
          new Notice(`Measuring distance to ${hit.title}`);
        } else {
          new Notice("Measurement cancelled.");
        }
        this.pendingMeasureNode = null;
        return; 
      }

      if (hit) {
        if (!this.renderer.selectedNodeIds.has(hit.id)) {
          this.renderer.selectedNodeIds.clear();
          this.renderer.selectedNodeIds.add(hit.id);
        }
        this.activeDraggedNodes = this.nodes.filter(n => this.renderer.selectedNodeIds.has(n.id));
        this.isDragging = true;
        this.renderer.scheduleDraw();
      } else {
        this.renderer.selectedNodeIds.clear();
        this.activeDraggedNodes = [];
        this.isDragging = true;
        this.renderer.scheduleDraw();
      }

      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
    });

    this.registerDomEvent(this.canvas, "pointermove", (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const dx = e.clientX - this.dragStartX;
      const dy = e.clientY - this.dragStartY;

      if (this.isBoxSelecting) {
        this.renderer.selectionBox = {
          x: Math.min(this.dragStartX, e.clientX - rect.left),
          y: Math.min(this.dragStartY, e.clientY - rect.top),
          w: Math.abs(e.clientX - rect.left - this.dragStartX),
          h: Math.abs(e.clientY - rect.top - this.dragStartY)
        };
        this.renderer.scheduleDraw();
      } else if (this.isDragging) {
        if (this.activeDraggedNodes.length > 0) {
          for (const node of this.activeDraggedNodes) {
             if (node.kind !== "span-left") {
                node.horizontalOffset += dx;
             }
             node.verticalOffset += dy;
          }
          this.renderer.scheduleDraw();
        } else {
          const timeDelta = -(dy / this.canvas.clientHeight) * this.viewport.viewSpan;
          this.viewport.viewStart += timeDelta;
          this.viewport.panOffsetX += dx;
          this.renderer.scheduleDraw();
        }
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
      }
    });

    this.registerDomEvent(this.canvas, "pointerup", (e: PointerEvent) => {
      if (this.isBoxSelecting) {
        this.isBoxSelecting = false;
        if (this.renderer.selectionBox) {
           const box = this.renderer.selectionBox;
           this.renderer.selectedNodeIds.clear();
           for (const node of this.renderer.getVisibleNodes()) {
             if (node.kind === "span-left" || node.kind === "era") continue;
             const nx = this.renderer.worldX(node.horizontalOffset);
             const ny = this.renderer.timelineY(node.startTime) + node.verticalOffset;
             if (nx >= box.x && nx <= box.x + box.w && ny >= box.y && ny <= box.y + box.h) {
               this.renderer.selectedNodeIds.add(node.id);
             }
           }
        }
        this.renderer.selectionBox = null;
        this.renderer.scheduleDraw();
      } else if (this.isDragging) {
        this.isDragging = false;
        if (this.activeDraggedNodes.length > 0) {
          for (const node of this.activeDraggedNodes) {
            void this.plugin.vaultAdapter.saveNodeOffsets(
              node.file,
              node.horizontalOffset,
              node.verticalOffset
            );
          }
        }
      }
      this.canvas.releasePointerCapture(e.pointerId);
    });

    this.registerDomEvent(this.canvas, "dblclick", (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const hit = this.renderer.hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (hit && !hit.isPhantom) {
        const viewer = new NodeInspectorModal(this.app, hit, () => {});
        void viewer.open();
      }
    });

    this.resizeObserver = new ResizeObserver(() => this.renderer.resize());
    this.resizeObserver.observe(this.canvas);

    // Coalesce bursts of vault changes (multi-node drags, auto-scatter, external edits) into a
    // single reload, and never swap the node array out from under an in-progress drag.
    const requestReload: () => void = debounce(() => {
      if (this.isDragging) {
        requestReload();
        return;
      }
      void this.reloadNodes();
    }, 300, true);

    this.registerEvent(this.app.metadataCache.on("changed", () => requestReload()));
    this.registerEvent(this.app.vault.on("delete", () => requestReload()));
    this.registerEvent(this.app.vault.on("rename", () => requestReload()));
  }

  /** Spreads a world span's successors evenly across its width (one successor = same lane, as before). */
  private layoutWorldSuccessors(predecessor: TimelineNode): void {
    const targets: TimelineNode[] = [];
    for (const name of predecessor.successors) {
      const target = this.nodes.find(n => n.title === name || n.file.basename === name);
      if (target && target.kind === "span" && !target.isPhantom && target !== predecessor && !targets.includes(target)) targets.push(target);
    }
    const slice = (predecessor.spanWidth ?? 28) / Math.max(1, targets.length);
    targets.forEach((target, index) => {
      const offset = predecessor.horizontalOffset + (index - (targets.length - 1) / 2) * slice;
      if (target.horizontalOffset === offset) return;
      target.horizontalOffset = offset;
      void this.app.fileManager.processFrontMatter(target.file, (fm: Frontmatter) => {
        fm["horizontal-offset"] = Math.round(offset);
      });
    });
  }

  async reloadNodes(): Promise<void> {
    this.nodes = await this.plugin.vaultAdapter.loadTimelineNodes("main");
    this.renderer.nodes = this.nodes;
    this.renderer.scheduleDraw();
  }

  async onClose(): Promise<void> {
    this.resizeObserver?.disconnect();
  }
}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];

class ImageSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private onChoose: (file: TFile) => void) {
    super(app);
    this.setPlaceholder("Choose an image from your vault...");
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((f) => IMAGE_EXTENSIONS.includes(f.extension.toLowerCase()));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}

class TextInputModal extends Modal {
  constructor(
    app: App, 
    private title: string, 
    private description: string, 
    private defaultVal: string, 
    private onSubmit: (val: string) => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl("h2", { text: this.title });
    contentEl.createEl("p", { text: this.description });
    
    const input = contentEl.createEl("input", { type: "text", value: this.defaultVal });
    input.setCssStyles({
      width: "100%",
      marginBottom: "20px",
      padding: "10px"
    });
    
    const btnContainer = contentEl.createDiv();
    btnContainer.setCssStyles({
      display: "flex",
      justifyContent: "flex-end"
    });
    
    const submitBtn = btnContainer.createEl("button", { text: "Save", cls: "mod-cta" });
    
    const submit = () => {
      this.onSubmit(input.value);
      this.close();
    };
    
    submitBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    
    input.focus();
  }

  onClose() {
    this.contentEl.empty();
  }
}

class CsvImportModal extends Modal {
  private fileContent = "";
  private targetFolder = "Timeline";

  constructor(app: App, private onComplete: () => Promise<void>) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Import nodes into Tau" });
    contentEl.createEl("p", {
      text: "Select a CSV file containing Tau schema columns. Existing notes with matching names will be safely updated without erasing note bodies.",
    });

    new Setting(contentEl)
      .setName("Destination folder")
      .setDesc("Folder where new Markdown files will be created")
      .addText((t) => {
        t.setValue(this.targetFolder).onChange((v) => (this.targetFolder = v.trim()));
      });

    new Setting(contentEl)
      .setName("CSV file")
      .setDesc("Choose your .csv timeline dataset")
      .addButton((b) => {
        b.setButtonText("Choose file").onClick(() => {
          const input = createEl("input");
          input.type = "file";
          input.accept = ".csv,text/csv";
          input.onchange = async () => {
            const file = input.files?.[0];
            if (file) {
              this.fileContent = await file.text();
              b.setButtonText(file.name);
            }
          };
          input.click();
        });
      });

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText("Start import")
          .setCta()
          .onClick(async () => {
            if (!this.fileContent) {
              new Notice("Please select a CSV file first.");
              return;
            }
            b.setDisabled(true);
            b.setButtonText("Importing...");
            await this.processCsv();
            this.close();
          })
      );
  }

  private parseCsv(text: string): Record<string, string>[] {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];

    const parseLine = (line: string): string[] => {
      const result: string[] = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          if (inQuotes && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (c === "," && !inQuotes) {
          result.push(cur.trim());
          cur = "";
        } else {
          cur += c;
        }
      }
      result.push(cur.trim());
      return result;
    };

    const headers = parseLine(lines[0]);
    const records: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const vals = parseLine(lines[i]);
      const record: Record<string, string> = {};
      headers.forEach((h, idx) => {
        record[h] = vals[idx] ?? "";
      });
      records.push(record);
    }
    return records;
  }

  private async processCsv() {
    const records = this.parseCsv(this.fileContent);
    if (records.length === 0) {
      new Notice("CSV is empty or invalid.");
      return;
    }

    const folderPath = this.targetFolder.replace(/^\/+|\/+$/g, "");
    if (folderPath && !this.app.vault.getAbstractFileByPath(folderPath)) {
      await this.app.vault.createFolder(folderPath);
    }

    let createdCount = 0;
    let updatedCount = 0;

    for (const r of records) {
      const title = r["title"] || "Untitled Node";
      const safeName = title.replace(/[/\\:*?"<>|]/g, "-").trim();
      const filePath = folderPath ? `${folderPath}/${safeName}.md` : `${safeName}.md`;

      const existingFile = this.app.vault.getAbstractFileByPath(filePath);

      const updateFm = (fm: Frontmatter) => {
        fm["timeline"] = r["timeline"] || "main";
        if (r["timeline-kind"]) fm["timeline-kind"] = r["timeline-kind"];
        if (r["start-date"]) fm["start-date"] = r["start-date"];
        if (r["end-date"]) fm["end-date"] = r["end-date"];
        if (r["color"]) fm["color"] = r["color"];
        if (r["title-color"]) fm["title-color"] = r["title-color"];
        if (r["date-color"]) fm["date-color"] = r["date-color"];
        if (r["text-direction"]) fm["text-direction"] = r["text-direction"];
        if (r["border-style"] && r["border-style"] !== "none") fm["border-style"] = r["border-style"];
        if (r["coordinates"]) fm["coordinates"] = r["coordinates"];
        if (r["child-of"]) fm["child-of"] = r["child-of"];
        if (r["successor"]) {
          const successors = r["successor"].split(",").map((s) => s.trim()).filter(Boolean);
          fm["successor"] = successors.length === 1 ? successors[0] : successors;
        }
        if (r["image"]) fm["image"] = r["image"];
        if (r["measure-to"]) fm["measure-to"] = r["measure-to"];

        if (r["global-event"] === "true") fm["global-event"] = true;

        const numKeys = ["importance", "horizontal-offset", "vertical-offset", "span-width", "span-height-offset", "image-width"];
        numKeys.forEach((k) => {
          const val = parseFloat(r[k]);
          if (!isNaN(val) && (k !== "importance" || val !== 0)) fm[k] = val;
        });

        const listKeys = ["branch-to", "influence-to"];
        listKeys.forEach((k) => {
          if (r[k]) {
            fm[k] = r[k].split(",").map((s) => s.trim()).filter(Boolean);
          }
        });
      };

      if (existingFile instanceof TFile) {
        await this.app.fileManager.processFrontMatter(existingFile, updateFm);
        updatedCount++;
      } else {
        const desc = r["description"] || "";
        const content = `---\ntitle: "${title}"\n---\n\n# ${title}\n\n${desc}\n`;
        const newFile = await this.app.vault.create(filePath, content);
        await this.app.fileManager.processFrontMatter(newFile, updateFm);
        createdCount++;
      }
    }

    new Notice(`Import complete: ${createdCount} created, ${updatedCount} updated.`);
    await this.onComplete();
  }
}