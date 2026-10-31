import { TimelineNode } from "./vault-adapter";

export type ViewportState = {
  viewStart: number;
  viewSpan: number;
  panOffsetX: number;
};

export class TimelineCanvasRenderer {
  private scheduledFrame: number | null = null;
  public showGridlines = false; 
  public showEventSpineLines = true; 
  public showSpanSpineLines = true;  
  
  public showTitles = true;
  public showEventDates = true;
  public showSpanDates = false; 
  public showLeftSpanDates = false; 
  
  public showMinorNodes = true; 

  public leftStripWidth = parseInt(localStorage.getItem("tau-left-width") || "200");

  private imageCache: Map<string, HTMLImageElement> = new Map(); 
  private leftLayoutCache: Map<string, { col: number, numCols: number }> = new Map();

  public selectedNodeIds: Set<string> = new Set();
  public selectionBox: { x: number, y: number, w: number, h: number } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private ctx: CanvasRenderingContext2D,
    public viewport: ViewportState,
    public nodes: TimelineNode[] = [],
  ) {}

  get cssFont(): string {
    return window.getComputedStyle(document.body).getPropertyValue('--font-text').trim() || "Inter, sans-serif";
  }

  get spineX(): number {
    return Math.max(this.leftStripWidth, 80);
  }

  worldX(offset: number): number {
    return this.spineX + offset + this.viewport.panOffsetX;
  }

  timelineY(time: number): number {
    const height = this.canvas.clientHeight;
    return ((time - this.viewport.viewStart) / this.viewport.viewSpan) * height;
  }

  timeAtY(y: number): number {
    const height = this.canvas.clientHeight;
    return this.viewport.viewStart + (y / height) * this.viewport.viewSpan;
  }

  // Recursive parent color inheritance with cycle guard
  public resolveNodeColor(node: TimelineNode, visited = new Set<string>()): string {
    if (node.color && node.color.trim() !== "") {
      return node.color;
    }
    if (node.childOf && !visited.has(node.id)) {
      visited.add(node.id);
      const parent = this.nodes.find(n => n.title === node.childOf || n.file.basename === node.childOf);
      if (parent) {
        return this.resolveNodeColor(parent, visited);
      }
    }
    return "#1c1917";
  }

  resize(): void {
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(this.canvas.clientWidth * ratio);
    this.canvas.height = Math.floor(this.canvas.clientHeight * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.scheduleDraw();
  }

  scheduleDraw(): void {
    if (this.scheduledFrame !== null) return;
    this.scheduledFrame = window.requestAnimationFrame(() => {
      this.scheduledFrame = null;
      this.draw();
    });
  }

  private getOrLoadImage(url: string): HTMLImageElement | null {
    if (this.imageCache.has(url)) {
      const img = this.imageCache.get(url)!;
      return img.complete && img.naturalWidth > 0 ? img : null;
    }
    const img = new Image();
    img.src = url;
    this.imageCache.set(url, img);
    img.onload = () => this.scheduleDraw(); 
    return null;
  }

  private calculateLeftSpanLayouts(): void {
    this.leftLayoutCache.clear();
    const leftSpans = this.nodes
      .filter(n => n.kind === "span-left")
      .filter(n => this.showMinorNodes || (n.importance || 0) >= 0);

    if (leftSpans.length === 0) return;

    const nodeMap = new Map<string, TimelineNode>();
    for (const node of leftSpans) {
      nodeMap.set(node.title, node);
      nodeMap.set(node.file.basename, node);
    }

    const handled = new Set<string>();
    const chains: { nodes: TimelineNode[], start: number, end: number }[] = [];

    for (const node of leftSpans) {
      if (handled.has(node.id)) continue;

      let isRoot = true;
      for (const potentialParent of leftSpans) {
        if (potentialParent.successor === node.title || potentialParent.successor === node.file.basename) {
          isRoot = false; 
          break;
        }
      }

      if (!isRoot) continue;

      const chainNodes: TimelineNode[] = [];
      let chainStart = node.startTime;
      let chainEnd = node.endTime ?? node.startTime;
      let current: TimelineNode | undefined = node;

      while (current && !handled.has(current.id)) {
        handled.add(current.id);
        chainNodes.push(current);
        chainStart = Math.min(chainStart, current.startTime);
        chainEnd = Math.max(chainEnd, current.endTime ?? current.startTime);

        if (current.successor) {
          current = nodeMap.get(current.successor);
        } else {
          break;
        }
      }
      chains.push({ nodes: chainNodes, start: chainStart, end: chainEnd });
    }

    for (const node of leftSpans) {
      if (!handled.has(node.id)) {
        chains.push({ nodes: [node], start: node.startTime, end: node.endTime ?? node.startTime });
      }
    }

    chains.sort((a, b) => a.start - b.start);
    const columns: typeof chains[] = [];

    for (const chain of chains) {
      let placed = false;
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        const lastChain = col[col.length - 1];
        if (chain.start > lastChain.end) {
          col.push(chain);
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push([chain]);
      }
    }

    for (let i = 0; i < columns.length; i++) {
      for (const chain of columns[i]) {
        for (const node of chain.nodes) {
          this.leftLayoutCache.set(node.id, { col: i, numCols: columns.length });
        }
      }
    }
  }

  draw(): void {
    this.calculateLeftSpanLayouts();

    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const globalFont = this.cssFont;

    this.ctx.clearRect(0, 0, width, height);
    this.ctx.fillStyle = "#f5eedc";
    this.ctx.fillRect(0, 0, width, height);

    const visible = this.getVisibleNodes();

    for (const node of visible) {
      if (node.kind === "era") {
        this.ctx.save(); 
        const laneWidth = node.spanWidth ?? 300;
        const x = this.worldX(node.horizontalOffset) - laneWidth / 2;
        this.ctx.fillStyle = this.resolveNodeColor(node);
        this.ctx.globalAlpha = 0.05;
        this.ctx.fillRect(x, 0, laneWidth, height);
        
        const textY = height - 150 + node.verticalOffset;
        const textX = x + laneWidth / 2;
        this.ctx.translate(textX, textY);
        if (node.textDirection === "vertical") this.ctx.rotate(-Math.PI / 2);
        
        this.ctx.globalAlpha = 0.15;
        this.ctx.fillStyle = node.titleColor ?? "#1c1917";
        this.ctx.font = `32px ${globalFont}`; 
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        
        if (this.showTitles) this.ctx.fillText(node.title.toUpperCase(), 0, 0);
        this.ctx.restore();
      }
      
      if (node.kind === "region") {
        const startY = this.timelineY(node.startTime) + node.verticalOffset;
        const endY = node.endTime ? this.timelineY(node.endTime) + node.verticalOffset : startY + 500;
        const regWidth = node.spanWidth ?? 400;
        const regX = this.worldX(node.horizontalOffset) - regWidth / 2;
        const regHeight = endY - startY;
        
        this.ctx.fillStyle = this.resolveNodeColor(node);
        this.ctx.globalAlpha = 0.08;
        this.ctx.fillRect(regX, startY, regWidth, regHeight);
        
        const scale = 1 + (node.importance || 0);
        const fontSize = Math.max(16, Math.round(48 * scale));
        const centerX = regX + regWidth / 2;
        const centerY = startY + regHeight / 2;
        
        this.ctx.save();
        this.ctx.translate(centerX, centerY);
        if (node.textDirection === "vertical") {
          this.ctx.rotate(-Math.PI / 2);
        }
        
        this.ctx.globalAlpha = 0.25;
        this.ctx.fillStyle = node.titleColor ?? node.color ?? "#78716c";
        this.ctx.font = `bold ${fontSize}px ${globalFont}`;
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        
        if (this.showTitles) this.ctx.fillText(node.title.toUpperCase(), 0, 0);
        this.ctx.restore();
        this.ctx.globalAlpha = 1.0;
      }
    }

    const pixelsPerYear = height / this.viewport.viewSpan;
    const minPixelsPerTick = 80;
    const minInterval = minPixelsPerTick / pixelsPerYear;
    
    const magnitude = Math.pow(10, Math.floor(Math.log10(minInterval || 1)));
    const residual = minInterval / magnitude;
    let interval = residual > 5 ? 10 * magnitude : residual > 2 ? 5 * magnitude : residual > 1 ? 2 * magnitude : magnitude;
    interval = Math.max(1, interval);

    const startTick = Math.ceil(this.viewport.viewStart / interval) * interval;
    const endTick = Math.floor((this.viewport.viewStart + this.viewport.viewSpan) / interval) * interval;

    if (this.showGridlines) {
      this.ctx.strokeStyle = "rgba(0, 0, 0, 0.05)";
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      for (let t = startTick; t <= endTick; t += interval) {
        const y = this.timelineY(t);
        this.ctx.moveTo(this.spineX, y);
        this.ctx.lineTo(width, y);
      }
      this.ctx.stroke();
    }

    // Connector Lines
    for (const node of visible) {
      if (node.kind === "era" || node.kind === "region") continue; 
      
      const childY = this.timelineY(node.startTime) + node.verticalOffset;
      const childX = node.kind === "span-left" ? this.spineX : this.worldX(node.horizontalOffset);
      const nodeColor = this.resolveNodeColor(node);

      if (node.childOf) {
        const parent = this.nodes.find(n => n.title === node.childOf || n.file.basename === node.childOf);
        if (parent && (this.showMinorNodes || (parent.importance || 0) >= 0)) {
          let parentAnchorTime = parent.startTime;
          if (parent.endTime !== null) {
            parentAnchorTime = Math.max(parent.startTime, Math.min(parent.endTime, node.startTime));
          }
          const parentY = this.timelineY(parentAnchorTime) + parent.verticalOffset;
          const parentX = parent.kind === "span-left" ? this.spineX : this.worldX(parent.horizontalOffset);

          if (node.isPhantom) {
            this.ctx.setLineDash([5, 5]);
            this.ctx.strokeStyle = "#78716c";
            this.ctx.globalAlpha = 0.6;
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            this.ctx.moveTo(parentX, parentY);
            this.ctx.lineTo(parentX, childY); 
            this.ctx.lineTo(childX, childY);  
            this.ctx.stroke();
            this.ctx.setLineDash([]); 
            this.ctx.globalAlpha = 1.0;
          } else {
            this.ctx.strokeStyle = nodeColor;
            this.ctx.globalAlpha = 0.45;
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            this.ctx.moveTo(childX, childY);
            const midX = (childX + parentX) / 2;
            this.ctx.bezierCurveTo(midX, childY, midX, parentY, parentX, parentY);
            this.ctx.stroke();
            this.ctx.globalAlpha = 1.0;
          }
        }
      }

      if (node.branchTo && node.branchTo.length > 0) {
        for (const branchTarget of node.branchTo) {
          const target = this.nodes.find(n => n.title === branchTarget || n.file.basename === branchTarget);
          if (target && (this.showMinorNodes || (target.importance || 0) >= 0)) {
            const startY = node.endTime !== null 
              ? this.timelineY(node.endTime) + node.verticalOffset + (node.spanHeightOffset ?? 0) / 2
              : this.timelineY(node.startTime) + node.verticalOffset;
            const startX = node.kind === "span-left" ? this.spineX : this.worldX(node.horizontalOffset);

            const endY = target.endTime !== null
              ? this.timelineY(target.startTime) + target.verticalOffset - (target.spanHeightOffset ?? 0) / 2
              : this.timelineY(target.startTime) + target.verticalOffset;
            const endX = target.kind === "span-left" ? this.spineX : this.worldX(target.horizontalOffset);

            this.ctx.strokeStyle = nodeColor;
            this.ctx.lineWidth = 4; 
            this.ctx.globalAlpha = 0.85;
            this.ctx.beginPath();
            this.ctx.moveTo(startX, startY);
            const midY = (startY + endY) / 2;
            this.ctx.lineTo(startX, midY);
            this.ctx.lineTo(endX, midY);
            this.ctx.lineTo(endX, endY);
            this.ctx.stroke();
            this.ctx.globalAlpha = 1.0;
          }
        }
      }

      if (node.influenceTo && node.influenceTo.length > 0) {
        for (const influenceTarget of node.influenceTo) {
          const target = this.nodes.find(n => n.title === influenceTarget || n.file.basename === influenceTarget);
          if (target && (this.showMinorNodes || (target.importance || 0) >= 0)) {
            const startX = node.kind === "span-left" ? this.spineX : this.worldX(node.horizontalOffset);
            const targetX = target.kind === "span-left" ? this.spineX : this.worldX(target.horizontalOffset);

            let targetAnchorTime = target.startTime;
            if (target.endTime !== null) {
              targetAnchorTime = Math.max(target.startTime, Math.min(target.endTime, node.startTime));
            }
            let nodeAnchorTime = node.startTime;
            if (node.endTime !== null) {
              nodeAnchorTime = Math.max(node.startTime, Math.min(node.endTime, targetAnchorTime));
            }

            const startY = this.timelineY(nodeAnchorTime) + node.verticalOffset;
            const targetY = this.timelineY(targetAnchorTime) + target.verticalOffset;

            const dx = targetX - startX;
            const dy = targetY - startY;
            const angle = Math.atan2(dy, dx);
            
            const headX = targetX - Math.cos(angle) * 12;
            const headY = targetY - Math.sin(angle) * 12;

            this.ctx.strokeStyle = nodeColor;
            this.ctx.fillStyle = nodeColor;
            this.ctx.lineWidth = 1.5;
            this.ctx.globalAlpha = 0.7;

            this.ctx.setLineDash([4, 4]);
            this.ctx.beginPath();
            this.ctx.moveTo(startX, startY);
            this.ctx.lineTo(headX, headY);
            this.ctx.stroke();
            this.ctx.setLineDash([]);

            this.ctx.beginPath();
            this.ctx.moveTo(headX, headY);
            this.ctx.lineTo(headX - Math.cos(angle - Math.PI / 7) * 10, headY - Math.sin(angle - Math.PI / 7) * 10);
            this.ctx.lineTo(headX - Math.cos(angle + Math.PI / 7) * 10, headY - Math.sin(angle + Math.PI / 7) * 10);
            this.ctx.fill();
            this.ctx.globalAlpha = 1.0;
          }
        }
      }

      if (node.measureTo) {
        const target = this.nodes.find(n => n.title === node.measureTo || n.file.basename === node.measureTo);
        if (target && (this.showMinorNodes || (target.importance || 0) >= 0)) {
          const childX = node.kind === "span-left" ? this.spineX : this.worldX(node.horizontalOffset);
          const targetX = target.kind === "span-left" ? this.spineX : this.worldX(target.horizontalOffset);

          const targetY = this.timelineY(target.startTime) + target.verticalOffset;
          
          this.ctx.setLineDash([4, 4]);
          this.ctx.strokeStyle = "#d97706"; 
          this.ctx.globalAlpha = 0.7;
          this.ctx.lineWidth = 1.5;
          this.ctx.beginPath();
          this.ctx.moveTo(childX, childY);
          const midX = (childX + targetX) / 2;
          this.ctx.bezierCurveTo(midX, childY, midX, targetY, targetX, targetY);
          this.ctx.stroke();
          this.ctx.setLineDash([]);
          this.ctx.globalAlpha = 1.0;

          const textX = (childX + targetX) / 2;
          const textY = (childY + targetY) / 2;
          const diffYears = Math.abs(target.startTime - node.startTime);
          const formats = formatMeasurement(diffYears);

          this.ctx.fillStyle = "rgba(245, 238, 220, 0.9)";
          this.ctx.fillRect(textX - 75, textY - 30, 150, 60);
          this.ctx.strokeStyle = "rgba(217, 119, 6, 0.4)";
          this.ctx.lineWidth = 1;
          this.ctx.strokeRect(textX - 75, textY - 30, 150, 60);

          this.ctx.font = `10px ${globalFont}`;
          this.ctx.textAlign = "center";
          this.ctx.textBaseline = "middle";
          this.ctx.fillStyle = "#b45309";

          this.ctx.fillText(formats[0], textX, textY - 18);
          this.ctx.fillText(formats[1], textX, textY - 6);
          this.ctx.fillText(formats[2], textX, textY + 6);
          this.ctx.fillText(formats[3], textX, textY + 18);
        }
      }
    }

    // PASS 1: Render Spans, Events, Notes
    for (const node of visible) {
      if (node.kind === "era" || node.kind === "region" || node.kind === "span-left") continue;
      this.renderNode(node, this.spineX, globalFont, height);
    }

    // PASS 2: Render Integration Zones for Regular World Spans
    for (const node of visible) {
      if (node.kind === "span" && node.successor) {
        this.renderWorldSpanIntegrationZone(node);
      }
    }

    // Left Strip Ruler
    this.ctx.fillStyle = "#f5eedc";
    this.ctx.fillRect(0, 0, this.spineX, height);

    this.ctx.strokeStyle = "rgba(0, 0, 0, 0.25)"; 
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(this.spineX, 0);
    this.ctx.lineTo(this.spineX, height);
    this.ctx.stroke();

    this.ctx.fillStyle = "#555555"; 
    this.ctx.strokeStyle = "rgba(0, 0, 0, 0.15)"; 
    this.ctx.lineWidth = 1;
    this.ctx.font = `11px ${globalFont}`;
    this.ctx.textAlign = "left"; 
    this.ctx.textBaseline = "middle";

    this.ctx.beginPath();
    for (let t = startTick; t <= endTick; t += interval) {
      const y = this.timelineY(t);
      this.ctx.moveTo(this.spineX - 5, y); 
      this.ctx.lineTo(this.spineX + 5, y);
      const displayYear = t > 0 ? `${t} CE` : `${Math.abs(t) + 1} BCE`;
      this.ctx.fillText(displayYear, this.spineX + 10, y);
    }
    this.ctx.stroke();

    if (this.leftStripWidth > 0 && this.leftLayoutCache.size > 0) {
      for (const node of visible) {
        if (node.kind === "span-left") {
          this.renderLeftSpan(node, globalFont, height);
        }
      }
      for (const node of visible) {
        if (node.kind === "span-left" && node.successor) {
          this.renderIntegrationZone(node);
        }
      }
    }

    if (this.selectionBox) {
      this.ctx.fillStyle = "rgba(59, 130, 246, 0.15)";
      this.ctx.strokeStyle = "rgba(59, 130, 246, 0.8)";
      this.ctx.lineWidth = 1;
      this.ctx.fillRect(this.selectionBox.x, this.selectionBox.y, this.selectionBox.w, this.selectionBox.h);
      this.ctx.strokeRect(this.selectionBox.x, this.selectionBox.y, this.selectionBox.w, this.selectionBox.h);
    }
  }

  getVisibleNodes(): TimelineNode[] {
    const viewportEnd = this.viewport.viewStart + this.viewport.viewSpan;
    return this.nodes
      .filter((node) => {
        if (!this.showMinorNodes && (node.importance || 0) < 0) return false;
        const nodeEnd = node.endTime ?? node.startTime;
        return node.startTime <= viewportEnd && nodeEnd >= this.viewport.viewStart;
      })
      .sort((a, b) => (a.importance || 0) - (b.importance || 0)); 
  }

  private renderNode(node: TimelineNode, spine: number, font: string, screenHeight: number): void {
    const isSelected = this.selectedNodeIds.has(node.id);
    const color = this.resolveNodeColor(node);

    if (node.kind === "span") {
      this.renderSpanRibbon(node, spine, color, isSelected, font, screenHeight);
    } else if (node.kind === "note") {
      this.renderFloatingNote(node, spine, color, isSelected, font);
    } else {
      this.renderPointEvent(node, spine, color, isSelected, font);
    }
  }

  private renderLeftSpan(node: TimelineNode, font: string, screenHeight: number): void {
    if (node.endTime === null) return;
    const layout = this.leftLayoutCache.get(node.id);
    if (!layout) return;

    const startY = this.timelineY(node.startTime) + node.verticalOffset;
    const endY = this.timelineY(node.endTime) + node.verticalOffset;
    
    const colWidth = this.leftStripWidth / layout.numCols;
    const x = layout.col * colWidth;
    
    const offset = node.spanHeightOffset ?? 0;
    const y1_box = startY - offset / 2;
    const ribbonHeight = Math.max(12, endY - startY) + offset;
    
    const isSelected = this.selectedNodeIds.has(node.id);
    const color = this.resolveNodeColor(node);

    this.ctx.fillStyle = color;
    this.ctx.globalAlpha = 1.0; 
    this.ctx.beginPath();
    this.ctx.rect(x, y1_box, colWidth, ribbonHeight); 
    this.ctx.fill();

    this.ctx.strokeStyle = "rgba(0, 0, 0, 0.3)"; 
    this.ctx.lineWidth = isSelected ? 3 : 1;
    this.ctx.strokeRect(x, y1_box, colWidth, ribbonHeight);

    const scale = 1 + (node.importance || 0);
    const fontSize = Math.max(8, Math.round(12 * scale));
    const centerX = x + colWidth / 2;
    const isVertical = node.textDirection !== "horizontal";

    const stickyPadding = isVertical ? 60 + (node.title.length * 2) : 30;
    let textY = y1_box + ribbonHeight / 2; 

    if (textY < stickyPadding && (y1_box + ribbonHeight) > stickyPadding) {
      textY = Math.min(stickyPadding, y1_box + ribbonHeight - stickyPadding);
    } else if (textY > screenHeight - stickyPadding && y1_box < screenHeight - stickyPadding) {
      textY = Math.max(screenHeight - stickyPadding, y1_box + stickyPadding);
    }

    this.ctx.save();
    this.ctx.translate(centerX, textY);
    if (isVertical) {
      this.ctx.rotate(-Math.PI / 2); 
    }

    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";

    this.ctx.fillStyle = node.titleColor ?? "#f5eedc";
    this.ctx.font = `bold ${fontSize}px ${font}`;
    
    if (this.showTitles) {
      const titleOffset = this.showLeftSpanDates ? -(fontSize * 0.6 + 4) : 0;
      this.ctx.fillText(node.title, 0, titleOffset);
    }

    this.ctx.fillStyle = node.dateColor ?? "rgba(255, 255, 255, 0.75)"; 
    this.ctx.font = `10px ${font}`;
    
    if (this.showLeftSpanDates) {
      const dateOffset = this.showTitles ? (fontSize * 0.6 + 6) : 0;
      if (node.endDateDisplay && node.startDateDisplay !== node.endDateDisplay) {
        this.ctx.fillText(`${node.startDateDisplay} - ${node.endDateDisplay}`, 0, dateOffset);
      } else {
        this.ctx.fillText(node.startDateDisplay, 0, dateOffset);
      }
    }
    
    this.ctx.restore();
  }

  private renderIntegrationZone(node: TimelineNode): void {
    if (!node.successor || node.endTime === null) return;
    const target = this.nodes.find(n => n.title === node.successor || n.file.basename === node.successor);
    if (!target || target.kind !== "span-left" || target.startTime >= node.endTime) return;

    const layout = this.leftLayoutCache.get(node.id);
    const targetLayout = this.leftLayoutCache.get(target.id);
    if (!layout || !targetLayout || layout.col !== targetLayout.col) return;

    const startY = this.timelineY(target.startTime) + target.verticalOffset; 
    const endY = this.timelineY(node.endTime) + node.verticalOffset; 

    const colWidth = this.leftStripWidth / layout.numCols;
    const x = layout.col * colWidth;

    const y1 = Math.min(startY, endY);
    const y2 = Math.max(startY, endY);
    const h = y2 - y1;
    if (h <= 0) return;

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(x, y1, colWidth, h);
    this.ctx.clip(); 

    const colorA = this.resolveNodeColor(node);
    const colorB = this.resolveNodeColor(target);

    this.ctx.fillStyle = colorA;
    this.ctx.fill();

    this.ctx.strokeStyle = colorB;
    this.ctx.lineWidth = 8;
    this.ctx.beginPath();
    const stripeSpacing = 16;
    for (let i = -colWidth; i < h + colWidth; i += stripeSpacing) {
      this.ctx.moveTo(x, y1 + i);
      this.ctx.lineTo(x + colWidth, y1 + i + colWidth);
    }
    this.ctx.stroke();
    
    this.ctx.restore();
  }

  private renderWorldSpanIntegrationZone(node: TimelineNode): void {
    if (!node.successor || node.endTime === null) return;
    const target = this.nodes.find(n => n.title === node.successor || n.file.basename === node.successor);
    if (!target || target.kind !== "span" || target.startTime >= node.endTime) return;

    const ribbonWidth = node.spanWidth ?? 28;
    const targetWidth = target.spanWidth ?? 28;
    const width = Math.min(ribbonWidth, targetWidth);
    
    const x = this.worldX(node.horizontalOffset) - width / 2;

    const startY = this.timelineY(target.startTime) + target.verticalOffset;
    const endY = this.timelineY(node.endTime) + node.verticalOffset;

    const y1 = Math.min(startY, endY);
    const y2 = Math.max(startY, endY);
    const h = y2 - y1;
    if (h <= 0) return;

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.roundRect(x, y1, width, h, 4);
    this.ctx.clip();

    const colorA = this.resolveNodeColor(node);
    const colorB = this.resolveNodeColor(target);

    this.ctx.fillStyle = colorA;
    this.ctx.fill();

    this.ctx.strokeStyle = colorB;
    this.ctx.lineWidth = 6;
    this.ctx.beginPath();
    const stripeSpacing = 12;
    for (let i = -width; i < h + width; i += stripeSpacing) {
      this.ctx.moveTo(x, y1 + i);
      this.ctx.lineTo(x + width, y1 + i + width);
    }
    this.ctx.stroke();
    this.ctx.restore();
  }

  private renderFloatingNote(node: TimelineNode, spine: number, color: string, isSelected: boolean, font: string): void {
    const anchorY = this.timelineY(node.startTime);
    const x = this.worldX(node.horizontalOffset);
    const y = anchorY + node.verticalOffset;

    const scale = 1 + (node.importance || 0);
    const fontSize = Math.max(8, Math.round(13 * scale));
    const fontWeight = isSelected ? "600" : "normal";
    const fontString = `${fontWeight} ${fontSize}px ${font}`;

    this.ctx.font = fontString;
    const metrics = this.ctx.measureText(node.title);
    
    const padX = 12;
    const padY = 8;
    const boxW = metrics.width + (padX * 2);
    const boxH = fontSize + (padY * 2);
    const boxX = x - (boxW / 2);
    const boxY = y - (boxH / 2);

    if (node.borderStyle && node.borderStyle !== "none") {
      this.ctx.fillStyle = "rgba(245, 238, 220, 0.85)"; 
      this.ctx.fillRect(boxX, boxY, boxW, boxH);

      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = isSelected ? 2 : 1;
      this.ctx.globalAlpha = isSelected ? 1.0 : 0.6;

      if (node.borderStyle === "dashed") this.ctx.setLineDash([4, 4]);
      this.ctx.strokeRect(boxX, boxY, boxW, boxH);
      this.ctx.setLineDash([]);
      this.ctx.globalAlpha = 1.0;
    }

    if (node.imageUrl) {
      const img = this.getOrLoadImage(node.imageUrl);
      if (img) {
        const aspect = img.naturalHeight / img.naturalWidth;
        const drawW = node.imageWidth ?? 100;
        const drawH = drawW * aspect;
        this.ctx.drawImage(img, x - drawW / 2, boxY - drawH - 8, drawW, drawH);
      }
    }

    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillStyle = node.titleColor ?? "#1c1917";
    if (this.showTitles) this.ctx.fillText(node.title, x, y);
  }

  private renderPointEvent(node: TimelineNode, spine: number, color: string, isSelected: boolean, font: string): void {
    const anchorY = this.timelineY(node.startTime);
    const x = this.worldX(node.horizontalOffset);
    const y = anchorY + node.verticalOffset;
    const width = this.canvas.clientWidth;

    const scale = 1 + (node.importance || 0);
    const fontSize = Math.max(8, Math.round(13 * scale));
    const fontWeight = isSelected ? "600" : "normal";
    const fontString = `${fontWeight} ${fontSize}px ${font}`;

    if (node.isGlobal) {
      this.ctx.strokeStyle = color;
      this.ctx.globalAlpha = isSelected ? 0.9 : 0.5;
      this.ctx.lineWidth = isSelected ? 4 : 3;
      
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(width, y);
      this.ctx.stroke();
      this.ctx.globalAlpha = 1.0;

      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";
      
      this.ctx.fillStyle = node.titleColor ?? "#1c1917";
      this.ctx.font = fontString;
      
      if (this.showTitles) {
        this.ctx.fillText(node.title.toUpperCase(), x, y - (this.showEventDates ? (fontSize / 2) + 6 : fontSize / 2));
      }

      this.ctx.fillStyle = node.dateColor ?? "#57534e"; 
      this.ctx.font = `10px ${font}`;
      if (this.showEventDates) {
        this.ctx.fillText(node.startDateDisplay, x, y + (this.showTitles ? 10 : 0));
      }

    } else {
      if (!node.childOf && this.showEventSpineLines) {
        this.ctx.strokeStyle = color;
        this.ctx.globalAlpha = isSelected ? 0.8 : 0.4;
        this.ctx.lineWidth = isSelected ? 2 : 1;
        this.ctx.beginPath();
        this.ctx.moveTo(spine, anchorY);
        this.ctx.lineTo(x, anchorY);
        this.ctx.lineTo(x, y); 
        this.ctx.stroke();
        this.ctx.globalAlpha = 1.0;
      }

      if (node.imageUrl) {
        const img = this.getOrLoadImage(node.imageUrl);
        if (img) {
          const aspect = img.naturalHeight / img.naturalWidth;
          const drawW = node.imageWidth ?? 100;
          const drawH = drawW * aspect;
          this.ctx.drawImage(img, x - drawW / 2, y - drawH - 15 - (fontSize/2), drawW, drawH);
        }
      }

      this.ctx.fillStyle = color;
      this.ctx.beginPath();
      this.ctx.arc(x, y, isSelected ? 6 : 4, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.textAlign = node.horizontalOffset < 0 ? "right" : "left";
      this.ctx.textBaseline = "middle";
      const labelX = x + (node.horizontalOffset < 0 ? -10 : 10);
      
      this.ctx.fillStyle = node.titleColor ?? "#1c1917";
      this.ctx.font = fontString;
      
      if (this.showTitles) {
        this.ctx.fillText(node.title, labelX, y - (this.showEventDates ? 8 : 0));
      }

      this.ctx.fillStyle = node.dateColor ?? "#57534e"; 
      this.ctx.font = `10px ${font}`;
      if (this.showEventDates) {
        this.ctx.fillText(node.startDateDisplay, labelX, y + (this.showTitles ? 8 : 0));
      }
    }
  }

  private renderSpanRibbon(node: TimelineNode, spine: number, color: string, isSelected: boolean, font: string, screenHeight: number): void {
    if (node.endTime === null) return;
    const startY = this.timelineY(node.startTime);
    const endY = this.timelineY(node.endTime);
    const ribbonWidth = node.spanWidth ?? 28;
    const x = this.worldX(node.horizontalOffset) - ribbonWidth / 2;
    
    const offset = node.spanHeightOffset ?? 0;
    const y1_line = startY + node.verticalOffset;
    const y2_line = endY + node.verticalOffset;
    const y1_box = y1_line - offset / 2;
    const ribbonHeight = Math.max(12, y2_line - y1_line) + offset;

    const scale = 1 + (node.importance || 0);
    const fontSize = Math.max(8, Math.round(12 * scale));

    this.ctx.fillStyle = color;
    this.ctx.globalAlpha = 1.0; 
    this.ctx.beginPath();
    this.ctx.roundRect(x, y1_box, ribbonWidth, ribbonHeight, 6); 
    this.ctx.fill();

    this.ctx.strokeStyle = "rgba(0, 0, 0, 0.2)"; 
    this.ctx.lineWidth = 1;
    this.ctx.stroke();

    if (!node.childOf && this.showSpanSpineLines) {
      this.ctx.strokeStyle = color;
      this.ctx.globalAlpha = 0.4;
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(spine, startY);
      this.ctx.lineTo(x + ribbonWidth / 2, y1_line);
      this.ctx.moveTo(spine, endY);
      this.ctx.lineTo(x + ribbonWidth / 2, y2_line);
      this.ctx.stroke();
      this.ctx.globalAlpha = 1.0;
    }

    if (node.imageUrl) {
      const img = this.getOrLoadImage(node.imageUrl);
      if (img) {
        const aspect = img.naturalHeight / img.naturalWidth;
        const drawW = node.imageWidth ?? 100;
        const drawH = drawW * aspect;
        const centerX = x + ribbonWidth / 2;
        this.ctx.drawImage(img, centerX - drawW / 2, y1_box - drawH - 10, drawW, drawH);
      }
    }

    const centerX = x + ribbonWidth / 2;
    const isVertical = node.textDirection === "vertical";

    const stickyPadding = isVertical ? 60 + (node.title.length * 2) : 30;
    let textY = y1_box + ribbonHeight / 2; 

    if (textY < stickyPadding && (y1_box + ribbonHeight) > stickyPadding) {
      textY = Math.min(stickyPadding, y1_box + ribbonHeight - stickyPadding);
    } else if (textY > screenHeight - stickyPadding && y1_box < screenHeight - stickyPadding) {
      textY = Math.max(screenHeight - stickyPadding, y1_box + stickyPadding);
    }

    this.ctx.save();
    this.ctx.translate(centerX, textY);
    if (isVertical) {
      this.ctx.rotate(-Math.PI / 2); 
    }

    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";

    this.ctx.fillStyle = node.titleColor ?? "#1c1917";
    this.ctx.font = `bold ${fontSize}px ${font}`;
    
    if (this.showTitles) {
      const titleOffset = this.showSpanDates ? -(fontSize * 0.6 + 4) : 0;
      this.ctx.fillText(node.title, 0, titleOffset);
    }

    this.ctx.fillStyle = node.dateColor ?? "#f5eedc"; 
    this.ctx.font = `10px ${font}`;
    
    if (this.showSpanDates) {
      const dateOffset = this.showTitles ? (fontSize * 0.6 + 6) : 0;
      if (node.endDateDisplay && node.startDateDisplay !== node.endDateDisplay) {
        this.ctx.fillText(`${node.startDateDisplay} - ${node.endDateDisplay}`, 0, dateOffset);
      } else {
        this.ctx.fillText(node.startDateDisplay, 0, dateOffset);
      }
    }
    
    this.ctx.restore();
  }

  hitTest(x: number, y: number): TimelineNode | null {
    if (this.leftStripWidth > 0 && x <= this.spineX) {
      for (const node of this.getVisibleNodes().reverse()) {
        if (node.kind === "span-left" && node.endTime !== null) {
          const layout = this.leftLayoutCache.get(node.id);
          if (layout) {
            const startY = this.timelineY(node.startTime) + node.verticalOffset - (node.spanHeightOffset ?? 0) / 2;
            const endY = this.timelineY(node.endTime) + node.verticalOffset + (node.spanHeightOffset ?? 0) / 2;
            const colWidth = this.leftStripWidth / layout.numCols;
            const lx = layout.col * colWidth;
            
            if (x >= lx && x <= lx + colWidth && y >= startY && y <= endY) {
              return node;
            }
          }
        }
      }
      return null; 
    }

    for (const node of this.getVisibleNodes().reverse()) {
      if (node.kind === "era" || node.kind === "span-left") continue;
      
      if (node.kind === "region") {
        const startY = this.timelineY(node.startTime) + node.verticalOffset;
        const endY = node.endTime ? this.timelineY(node.endTime) + node.verticalOffset : startY + 500;
        const regWidth = node.spanWidth ?? 400;
        const regX = this.worldX(node.horizontalOffset) - regWidth / 2;
        const regHeight = endY - startY;
        const centerX = regX + regWidth / 2;
        const centerY = startY + regHeight / 2;
        
        if (Math.abs(x - centerX) < 50 && Math.abs(y - centerY) < 50) return node;
        continue;
      }

      if (node.kind === "span" && node.endTime !== null) {
        const offset = node.spanHeightOffset ?? 0;
        const startY = this.timelineY(node.startTime) + node.verticalOffset - offset / 2;
        const endY = this.timelineY(node.endTime) + node.verticalOffset + offset / 2;
        const ribbonWidth = node.spanWidth ?? 28;
        const rx = this.worldX(node.horizontalOffset) - ribbonWidth / 2;
        if (x >= rx && x <= rx + ribbonWidth && y >= startY && y <= endY) {
          return node;
        }
      } else if (node.kind === "note") {
        const nx = this.worldX(node.horizontalOffset);
        const ny = this.timelineY(node.startTime) + node.verticalOffset;
        const estWidth = node.title.length * 8; 
        if (Math.abs(nx - x) < (estWidth / 2) + 20 && Math.abs(ny - y) < 24) {
          return node;
        }
      } else {
        const anchorY = this.timelineY(node.startTime);
        const nx = this.worldX(node.horizontalOffset);
        const ny = anchorY + node.verticalOffset;
        if (Math.hypot(nx - x, ny - y) < 24) { 
          return node;
        }
      }
    }

    for (const node of this.nodes) {
      if (node.kind === "era") {
        const textY = this.canvas.clientHeight - 150 + node.verticalOffset;
        const laneWidth = node.spanWidth ?? 300;
        const textX = this.worldX(node.horizontalOffset);
        if (Math.abs(x - textX) < (laneWidth / 2) && Math.abs(y - textY) < 150) {
          return node;
        }
      }
    }
    return null;
  }
}

function formatMeasurement(diffYears: number): string[] {
  const totalDays = Math.round(diffYears * 365.25);
  const y = Math.floor(totalDays / 365.25);
  const remDaysY = totalDays - Math.floor(y * 365.25);
  const m = Math.floor(remDaysY / 30.4375);
  const d = Math.round(remDaysY - (m * 30.4375));

  const totalM = Math.floor(totalDays / 30.4375);
  const remDaysM = Math.round(totalDays - (totalM * 30.4375));

  const pY = y === 1 ? "year" : "years";
  const pM = m === 1 ? "month" : "months";
  const pD = d === 1 ? "day" : "days";
  const pTM = totalM === 1 ? "month" : "months";
  const pRDM = remDaysM === 1 ? "day" : "days";
  const pRemY = Math.round(remDaysY) === 1 ? "day" : "days";
  const pTD = totalDays === 1 ? "day" : "days";

  return [
    `${y} ${pY}, ${m} ${pM}, ${d} ${pD}`,
    `${y} ${pY}, ${Math.round(remDaysY)} ${pRemY}`,
    `${totalM} ${pTM}, ${remDaysM} ${pRDM}`,
    `${totalDays} ${pTD}`
  ];
}