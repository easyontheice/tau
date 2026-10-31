import { App, TFile, Notice } from "obsidian";
import {
  normalizeHistoricalDate,
  historicalDateRange,
  historicalDateTimelinePosition,
  formatHistoricalDate,
  type HistoricalDate,
  type HistoricalDateInput,
  type Calendar,
  type YearDesignation,
} from "./historical-date";

export type TimelineKind = "event" | "span" | "span-left" | "era" | "note" | "region";

export type TimelineNode = {
  id: string; 
  file: TFile;
  timelineId: string;
  kind: TimelineKind;
  title: string;
  startTime: number;
  endTime: number | null;
  verticalOffset: number;
  horizontalOffset: number;
  spanWidth?: number;
  spanHeightOffset: number; 
  childOf: string | null;   
  successor: string | null; // <-- NEW: Lineage Succession
  branchTo: string[]; 
  influenceTo: string[]; 
  measureTo: string | null; 
  color: string | null;
  titleColor: string | null;
  dateColor: string | null;
  startDateJson: string;
  endDateJson: string | null;
  startAbsMin: number;
  startAbsMax: number;
  endAbsMin: number | null;
  endAbsMax: number | null;
  description: string | null;
  startDateDisplay: string; 
  endDateDisplay: string | null; 
  rawFrontmatter: Record<string, any>;
  isPhantom?: boolean; 
  isGlobal: boolean; 
  importance: number; 
  textDirection: "vertical" | "horizontal"; 
  borderStyle: "solid" | "dashed" | "none" | null; 
  imageUrl: string | null; 
  imageWidth: number | null;
  coordinates: string | null; 
};

export function parseFrontmatterDate(input: unknown): HistoricalDate | undefined {
  if (typeof input !== "string") return undefined;
  const cleaned = input.trim();
  if (!cleaned) return undefined;

  const regex = /^([+-]?\d{1,6})(?:-(\d{1,2})(?:-(\d{1,2}))?)?(?:\s*(BCE|CE))?$/i;
  const match = regex.exec(cleaned);
  if (!match) return undefined;

  let yearVal = Number(match[1]);
  const monthVal = match[2] ? Number(match[2]) : null;
  const dayVal = match[3] ? Number(match[3]) : null;
  let designation: YearDesignation = match[4] ? (match[4].toUpperCase() as YearDesignation) : yearVal <= 0 ? "BCE" : "CE";

  if (yearVal <= 0 && !match[4]) {
    designation = "BCE";
    yearVal = Math.abs(yearVal) + 1;
  } else if (yearVal < 0) {
    yearVal = Math.abs(yearVal);
  }

  const historicalInput: HistoricalDateInput = {
    year: Math.max(1, yearVal),
    yearDesignation: designation,
    month: monthVal,
    day: dayVal,
    calendar: "gregorian",
  };

  try {
    return normalizeHistoricalDate(historicalInput);
  } catch {
    return undefined;
  }
}

export function parseTimeTravel(input: string): number | null {
  if (typeof input !== "string" && typeof input !== "number") return null;
  const str = String(input);
  const regex = /(-?[\d.]+)\s*([ymd])/gi;
  let match;
  let totalYears = 0;
  let hasMatch = false;

  while ((match = regex.exec(str)) !== null) {
    hasMatch = true;
    const val = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === 'y') totalYears += val;
    if (unit === 'm') totalYears += val / 12;
    if (unit === 'd') totalYears += val / 365.25;
  }
  
  if (!hasMatch && !isNaN(parseFloat(str))) {
    return parseFloat(str);
  }
  
  return hasMatch ? totalYears : null;
}

export class VaultAdapter {
  constructor(private app: App) {}

  async loadTimelineNodes(targetTimelineId = "main"): Promise<TimelineNode[]> {
    const files = this.app.vault.getMarkdownFiles();
    const nodes: TimelineNode[] = [];

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm) continue;

      const timelineId = fm["timeline"] ?? fm["timeline-id"] ?? "main";
      if (timelineId !== targetTimelineId) continue;

      const rawStart = fm["start-date"] ?? fm["date"];
      const startDate = parseFrontmatterDate(rawStart);
      if (!startDate) continue;

      const rawEnd = fm["end-date"];
      const endDate = parseFrontmatterDate(rawEnd);

      const startRange = historicalDateRange(startDate);
      const endRange = endDate ? historicalDateRange(endDate) : undefined;

      const kind: TimelineKind = fm["timeline-kind"] ?? (endDate ? "span" : "event");
      const title = fm["title"] ?? file.basename;

      const isGlobal = fm["global-event"] === true || fm["global-event"] === "true";
      const importance = Number(fm["importance"] ?? 0);
      
      const textDirection = fm["text-direction"] === "horizontal" ? "horizontal" : "vertical";
      
      const rawBorder = fm["border-style"];
      const borderStyle = ["solid", "dashed", "none"].includes(rawBorder) ? rawBorder : null;

      const rawBranch = fm["branch-to"];
      let branchTo: string[] = [];
      if (Array.isArray(rawBranch)) {
        branchTo = rawBranch.map(String);
      } else if (typeof rawBranch === "string") {
        branchTo = rawBranch.split(",").map(s => s.trim()).filter(Boolean);
      }

      const rawInfluence = fm["influence-to"];
      let influenceTo: string[] = [];
      if (Array.isArray(rawInfluence)) {
        influenceTo = rawInfluence.map(String);
      } else if (typeof rawInfluence === "string") {
        influenceTo = rawInfluence.split(",").map(s => s.trim()).filter(Boolean);
      }

      let imageUrl: string | null = null;
      const rawImage = fm["image"];
      if (typeof rawImage === "string") {
        const cleanName = rawImage.replace(/[\[\]]/g, "").trim(); 
        const imgFile = this.app.metadataCache.getFirstLinkpathDest(cleanName, file.path);
        if (imgFile) {
          imageUrl = this.app.vault.getResourcePath(imgFile);
        }
      }
      
      const rawImageWidth = fm["image-width"];
      const imageWidth = rawImageWidth ? Number(rawImageWidth) : null;

      const coordinates = fm["coordinates"] ? String(fm["coordinates"]) : null;

      const startString = formatHistoricalDate(startDate);
      const endString = endDate ? formatHistoricalDate(endDate) : null;

      let description = fm["description"] ?? null;
      if (!description) {
        const content = await this.app.vault.cachedRead(file);
        const bodyContent = content.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
        if (bodyContent) {
          const firstBlock = bodyContent.split(/\n\s*\n/)[0];
          description = firstBlock
            .replace(/^#+\s+/g, "") 
            .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1") 
            .replace(/[*_~`]/g, "")
            .trim()
            .substring(0, 300);
            
          if (description.length === 300) description += "...";
        }
      }

      nodes.push({
        id: file.path,
        file,
        timelineId,
        kind,
        title,
        startTime: historicalDateTimelinePosition(startDate),
        endTime: endDate ? historicalDateTimelinePosition(endDate) : null,
        verticalOffset: Number(fm["vertical-offset"] ?? 0),
        horizontalOffset: Number(fm["horizontal-offset"] ?? 0),
        spanWidth: fm["span-width"] ? Number(fm["span-width"]) : undefined,
        spanHeightOffset: Number(fm["span-height-offset"] ?? 0), 
        childOf: fm["child-of"] ? String(fm["child-of"]) : null, 
        successor: fm["successor"] ? String(fm["successor"]) : null, // <-- Parsed Property
        branchTo,
        influenceTo,
        measureTo: fm["measure-to"] ? String(fm["measure-to"]) : null, 
        color: fm["color"] ?? null,
        titleColor: fm["title-color"] ?? null,
        dateColor: fm["date-color"] ?? null, 
        startDateJson: JSON.stringify(startDate),
        endDateJson: endDate ? JSON.stringify(endDate) : null,
        startAbsMin: startRange.absoluteMin,
        startAbsMax: startRange.absoluteMax,
        endAbsMin: endRange?.absoluteMin ?? null,
        endAbsMax: endRange?.absoluteMax ?? null,
        description, 
        startDateDisplay: startString, 
        endDateDisplay: endString,
        rawFrontmatter: fm,
        isGlobal,
        importance,
        textDirection,
        borderStyle,
        imageUrl, 
        imageWidth,
        coordinates,
      });

      const timeTravel = fm["time-travel"];
      if (timeTravel) {
        const offsetYears = parseTimeTravel(timeTravel);
        if (offsetYears !== null && offsetYears !== 0) {
          const dir = offsetYears > 0 ? "to" : "from";
          nodes.push({
            id: file.path + "_phantom",
            file,
            timelineId,
            kind: "event",
            title: `${timeTravel} ${dir} ${title}`,
            startTime: historicalDateTimelinePosition(startDate) + offsetYears,
            endTime: null,
            verticalOffset: 0, 
            horizontalOffset: Number(fm["horizontal-offset"] ?? 0) + 120, 
            spanWidth: undefined,
            spanHeightOffset: 0,
            childOf: title, 
            successor: null,
            branchTo: [],
            influenceTo: [],
            measureTo: null,
            color: "#78716c", 
            titleColor: "#78716c",
            dateColor: "#78716c",
            startDateJson: JSON.stringify(startDate),
            endDateJson: null,
            startAbsMin: 0, startAbsMax: 0, endAbsMin: null, endAbsMax: null,
            description: "Virtual Temporal Anomaly",
            startDateDisplay: "",
            endDateDisplay: null,
            rawFrontmatter: {},
            isPhantom: true,
            isGlobal: false, 
            importance, 
            textDirection: "horizontal",
            borderStyle: null,
            imageUrl: null, 
            imageWidth: null,
            coordinates: null,
          });
        }
      }
    }

    return nodes;
  }

  async saveNodeOffsets(file: TFile, horizontalOffset: number, verticalOffset: number): Promise<void> {
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm["horizontal-offset"] = Math.round(horizontalOffset);
        fm["vertical-offset"] = Math.round(verticalOffset);
      });
    } catch (error) {
      console.error("tau: Failed to save node offsets to frontmatter", error);
      new Notice(`Failed to save position for ${file.basename}`);
    }
  }
}