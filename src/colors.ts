import { type TimelineNode } from "./vault-adapter";

/** Light colours meant for black text. Used for events and spans. */
export const LIGHT_PALETTE = ["#C6C0B9", "#D1D0D0", "#988686", "#FFFFFF", "#A8769D", "#8D9AA8", "#80A876", "#A89576", "#BCC4BE"];

/** Dark colours meant for white text. Used for left spans. */
export const DARK_PALETTE = ["#D6B588", "#705E46", "#422701", "#000000", "#5C4E4E", "#53404F", "#D11141", "#292929", "#394F3C", "#64859E"];

/** Event dots and connectors are drawn on the cream background, where white would disappear. */
const EVENT_PALETTE = LIGHT_PALETTE.filter((c) => c !== "#FFFFFF");

/** Which palette a node gets, or null if randomizing should leave it alone. */
export function paletteFor(node: TimelineNode): string[] | null {
  if (node.isPhantom) return null;
  // A child with no colour of its own inherits its parent's colour; keep that link intact
  if (node.childOf && !node.color) return null;
  if (node.kind === "span-left") return DARK_PALETTE;
  if (node.kind === "span") return LIGHT_PALETTE;
  if (node.kind === "event") return EVENT_PALETTE;
  return null; // notes, eras and regions are not recoloured
}

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * Deals colours like cards from a shuffled deck: every colour is used once before any repeats,
 * so a large import gets an even spread instead of clumps, yet the order is random every time.
 */
class ShuffleBag {
  private bag: string[] = [];

  constructor(private colors: string[], private random: () => number) {}

  next(avoid: Set<string>): string {
    let index = this.bag.findIndex((c) => !avoid.has(c));
    if (index < 0) {
      // Nothing usable left in this deck: shuffle in a fresh one
      this.bag.push(...shuffle([...this.colors], this.random));
      index = this.bag.findIndex((c) => !avoid.has(c));
    }
    return this.bag.splice(Math.max(0, index), 1)[0];
  }
}

/**
 * Picks a random colour for each eligible node. Nodes that are visually joined (successors,
 * predecessors and child-of parents) never get the same colour, so hatched transitions and
 * S-curves stay readable. Returns node id -> colour; ineligible nodes are left out.
 */
export function assignRandomColors(targets: TimelineNode[], allNodes: TimelineNode[], random: () => number = Math.random): Map<string, string> {
  const byName = new Map<string, TimelineNode>();
  for (const node of allNodes) {
    if (!byName.has(node.title)) byName.set(node.title, node);
    if (!byName.has(node.file.basename)) byName.set(node.file.basename, node);
  }
  const predecessors = new Map<string, TimelineNode[]>();
  for (const node of allNodes) {
    for (const name of node.successors) {
      const successor = byName.get(name);
      if (!successor) continue;
      const list = predecessors.get(successor.id) ?? [];
      list.push(node);
      predecessors.set(successor.id, list);
    }
  }

  const bags = new Map<string[], ShuffleBag>();
  const assigned = new Map<string, string>();
  const colorOf = (node: TimelineNode) => assigned.get(node.id) ?? node.color ?? undefined;

  const ordered = targets.filter((n) => paletteFor(n) !== null).sort((a, b) => a.startTime - b.startTime);
  for (const node of ordered) {
    const palette = paletteFor(node)!;
    let bag = bags.get(palette);
    if (!bag) {
      bag = new ShuffleBag(palette, random);
      bags.set(palette, bag);
    }

    const neighbours: TimelineNode[] = [...(predecessors.get(node.id) ?? [])];
    for (const name of node.successors) {
      const successor = byName.get(name);
      if (successor) neighbours.push(successor);
    }
    if (node.childOf) {
      const parent = byName.get(node.childOf);
      if (parent) neighbours.push(parent);
    }
    const avoid = new Set<string>();
    for (const n of neighbours) {
      const c = colorOf(n);
      if (c && n !== node) avoid.add(c.toUpperCase());
    }
    assigned.set(node.id, bag.next(avoid));
  }
  return assigned;
}

