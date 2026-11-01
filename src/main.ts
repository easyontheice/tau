import { App, ItemView, Plugin, WorkspaceLeaf, Menu, Notice, Modal, Setting, TFile, FuzzySuggestModal, debounce } from "obsidian";
import { VaultAdapter, TimelineNode } from "./vault-adapter";
import { TimelineCanvasRenderer, ViewportState } from "./timeline-canvas";
import { NodeInspectorModal } from "./inspector";
import { NodeEditorModal } from "./editor";
import { type Frontmatter } from "./frontmatter";
import { DEFAULT_SETTINGS, TauSettingTab, type TauSettings, clampDateSize, clampImportance, MIN_DATE_SIZE, MAX_DATE_SIZE } from "./settings";
import { parseCsv, findUnknownPlaceholders, importCsvRecords, type ImportResult } from "./csv-import";
import { assignRandomColors, paletteFor } from "./colors";
import { pickCsvFile } from "./file-picker";

export const TIMELINE_VIEW_TYPE = "tau-timeline-view";

export default class tauPlugin extends Plugin {
  vaultAdapter!: VaultAdapter;
  settings: TauSettings = { ...DEFAULT_SETTINGS };
  private bulkOperations = 0;

  /** True while a bulk import/recolour is writing notes; open timelines hold off reloading until it ends. */
  get isBulkOperation(): boolean {
    return this.bulkOperations > 0;
  }

  async onload(): Promise<void> {
    this.vaultAdapter = new VaultAdapter(this.app);
    await this.loadSettings();
    this.addSettingTab(new TauSettingTab(this.app, this));

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
        new CsvImportModal(this.app, this).open();
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

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<TauSettings> | null);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Pushes display settings (date text sizes, importance boosts) to every open timeline and redraws it. */
  applyDisplaySettings(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(TIMELINE_VIEW_TYPE)) {
      if (leaf.view instanceof tauTimelineView) leaf.view.applyDisplaySettings();
    }
  }

  /**
   * Runs a batch of vault writes while open timelines hold off reloading, then lets them refresh
   * once at the end. Used by CSV import, colour randomizing and auto-scatter.
   */
  async runBulk<T>(work: () => Promise<T>): Promise<T> {
    this.bulkOperations++;
    try {
      return await work();
    } finally {
      this.bulkOperations--;
      if (this.bulkOperations === 0) {
        for (const leaf of this.app.workspace.getLeavesOfType(TIMELINE_VIEW_TYPE)) {
          if (leaf.view instanceof tauTimelineView) leaf.view.requestReload();
        }
      }
    }
  }

  /** Parses and imports a CSV. Returns null, after telling the user why, if nothing was imported. */
  async importCsv(text: string, folderTemplate: string, onProgress?: (done: number, total: number) => void): Promise<ImportResult | null> {
    const { headers, records } = parseCsv(text);
    if (records.length === 0) {
      new Notice("The CSV file is empty or has no data rows.");
      return null;
    }
    const missing = findUnknownPlaceholders(folderTemplate, headers);
    if (missing.length > 0) {
      new Notice(`The destination folder uses ${missing.map((m) => `{{${m}}}`).join(", ")}, but the CSV has no column with that name.`);
      return null;
    }
    const result = await this.runBulk(() => importCsvRecords(this.app, records, { folderTemplate, onProgress }));
    new Notice(`Import complete: ${result.created} created, ${result.updated} updated.`);
    return result;
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

  // Coalesce bursts of vault changes into a single reload. Never swap the node array out from
  // under an in-progress drag, and wait while a bulk import/recolour is still writing notes.
  readonly requestReload: () => void = debounce(() => {
    if (this.isDragging || this.plugin.isBulkOperation) {
      this.requestReload();
      return;
    }
    void this.reloadNodes();
  }, 300, true);

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
    this.applyDisplaySettings();
    
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
        
        const colorScope = this.renderer.selectedNodeIds.has(hit.id) && this.renderer.selectedNodeIds.size > 1
          ? this.nodes.filter(n => this.renderer.selectedNodeIds.has(n.id))
          : [hit];
        if (colorScope.some(n => paletteFor(n) !== null)) {
          menu.addItem((item) => {
            item.setTitle(colorScope.length > 1 ? `Randomize colors of ${colorScope.length} selected nodes` : "Randomize color")
              .setIcon("palette")
              .onClick(() => this.randomizeColors(colorScope));
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
          item.setTitle("Span date text size...").setIcon("type").onClick(() => {
            this.promptDateSize("spanDateSize", "Span date text size", "dates on spans");
          });
        });

        menu.addItem((item) => {
          item.setTitle("Left span date text size...").setIcon("type").onClick(() => {
            this.promptDateSize("leftSpanDateSize", "Left span date text size", "dates on left spans");
          });
        });

        menu.addItem((item) => {
          item.setTitle("Import nodes from CSV...").setIcon("file-up").onClick(() => {
            new CsvImportModal(this.app, this.plugin).open();
          });
        });

        menu.addItem((item) => {
          item.setTitle("Auto-scatter all events").setIcon("list-restart").onClick(async () => {
            new Notice("Scattering timeline... Please wait.");
            await this.plugin.runBulk(async () => {
            
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
            
            });
            this.renderer.scheduleDraw();
            new Notice("Auto-scatter complete!");
          });
        });

        menu.addItem((item) => {
          item.setTitle("Randomize colors").setIcon("palette").onClick(() => {
            this.randomizeColors(this.nodes);
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

    this.registerEvent(this.app.metadataCache.on("changed", () => this.requestReload()));
    this.registerEvent(this.app.vault.on("delete", () => this.requestReload()));
    this.registerEvent(this.app.vault.on("rename", () => this.requestReload()));
  }

  /** Copies the plugin's display settings onto the renderer and redraws. */
  applyDisplaySettings(): void {
    const settings = this.plugin.settings;
    this.renderer.spanDateSize = clampDateSize(settings.spanDateSize, DEFAULT_SETTINGS.spanDateSize);
    this.renderer.leftSpanDateSize = clampDateSize(settings.leftSpanDateSize, DEFAULT_SETTINGS.leftSpanDateSize);
    this.renderer.eventImportance = clampImportance(settings.eventImportance, 0);
    this.renderer.spanImportance = clampImportance(settings.spanImportance, 0);
    this.renderer.leftSpanImportance = clampImportance(settings.leftSpanImportance, 0);
    this.renderer.scheduleDraw();
  }

  /** Asks for a new date text size, saves it for the whole vault and updates every open timeline. */
  private promptDateSize(key: "spanDateSize" | "leftSpanDateSize", title: string, what: string): void {
    const current = String(this.plugin.settings[key]);
    const help = `Font size in pixels for the ${what} (default ${DEFAULT_SETTINGS[key]}, from ${MIN_DATE_SIZE} to ${MAX_DATE_SIZE}). Applies to all of them at once.`;
    new TextInputModal(this.app, title, help, current, (val) => {
      const num = parseFloat(val);
      if (isNaN(num) || num < MIN_DATE_SIZE || num > MAX_DATE_SIZE) {
        new Notice(`Please enter a size from ${MIN_DATE_SIZE} to ${MAX_DATE_SIZE}.`);
        return;
      }
      this.plugin.settings[key] = num;
      void this.plugin.saveSettings();
      this.plugin.applyDisplaySettings();
    }).open();
  }

  /**
   * Gives nodes random palette colours (light for events and spans, dark for left spans) after
   * confirming. Only the color property changes; title and date colours are left alone.
   */
  private randomizeColors(scope: TimelineNode[]): void {
    const colors = assignRandomColors(scope, this.nodes);
    if (colors.size === 0) {
      new Notice("Only events, spans and left spans can be recolored (children that inherit their parent's color are skipped).");
      return;
    }
    const message = colors.size === 1
      ? "Give this node a random color? Its color property will be overwritten."
      : `Give ${colors.size} nodes random colors? Their color property will be overwritten. Title and date colors are not changed.`;
    new ConfirmModal(this.app, "Randomize colors", message, "Randomize", async () => {
      const targets = this.nodes.filter((n) => colors.has(n.id));
      for (const node of targets) node.color = colors.get(node.id) ?? node.color;
      this.renderer.scheduleDraw();
      await this.plugin.runBulk(async () => {
        let done = 0;
        for (const node of targets) {
          const color = colors.get(node.id);
          if (!color) continue;
          await this.app.fileManager.processFrontMatter(node.file, (fm: Frontmatter) => {
            fm["color"] = color;
          });
          if (++done % 25 === 0) await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
      });
      new Notice(`Randomized ${targets.length} ${targets.length === 1 ? "color" : "colors"}.`);
    }).open();
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

class ConfirmModal extends Modal {
  constructor(
    app: App,
    private heading: string,
    private message: string,
    private confirmText: string,
    private onConfirm: () => void | Promise<void>
  ) {
    super(app);
  }

  onOpen() {
    this.setTitle(this.heading);
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b.setButtonText(this.confirmText).setDestructive().onClick(() => {
          this.close();
          void this.onConfirm();
        })
      );
  }

  onClose() {
    this.contentEl.empty();
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

  constructor(app: App, private plugin: tauPlugin) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Import nodes into Tau" });
    contentEl.createEl("p", {
      text: "Select a CSV file. Timeline columns are imported with the right types and any other column becomes a text property. Existing notes with matching names are updated without erasing note bodies. This import is also available in the plugin settings.",
    });

    new Setting(contentEl)
      .setName("Destination folder")
      .setDesc("Use {{column}} for subfolders, for example Timeline/{{region}}")
      .addText((t) => {
        t.setValue(this.plugin.settings.importFolder).onChange(async (v) => {
          this.plugin.settings.importFolder = v.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(contentEl)
      .setName("CSV file")
      .setDesc("Choose your .csv timeline dataset")
      .addButton((b) => {
        b.setButtonText("Choose file").onClick(async () => {
          const file = await pickCsvFile(contentEl);
          if (file) {
            this.fileContent = await file.text();
            b.setButtonText(file.name);
          }
        });
      });

    const importSetting = new Setting(contentEl);
    importSetting.addButton((b) =>
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
          const result = await this.plugin.importCsv(this.fileContent, this.plugin.settings.importFolder, (done, total) => {
            importSetting.setDesc(`Importing ${done} of ${total} rows...`);
          });
          if (result) {
            this.close();
          } else {
            b.setDisabled(false);
            b.setButtonText("Start import");
          }
        })
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}
