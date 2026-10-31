# Tau (τ) ⏳

![Screenshot](img/example_1.png)

**An infinite, canvas-based vertical timeline and cartographic engine for Obsidian.**

[![Buy Me A Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/easyontheice)

Tau was born out of sheer frustration with the current landscape of timeline plugins. Most existing tools are fundamentally rigid—forcing non-linear historical events into strictly linear grids, horizontal scroll corridors, or markdown tables with zero spatial freedom. They collapse when handling overlapping eras, parallel civilizations, or complex causal relationships.

Tau changes that paradigm. Powered by a custom, hardware-accelerated **HTML5 Canvas renderer**, Tau treats your vault as an interactive historical atlas. Drag events anywhere across an infinite vertical coordinate space, map diverging dynasties with dynastic lane packing, visualize causal influence with vector links, and never write raw YAML again.

*Special credit to [UsefulCharts](https://usefulcharts.com/) for inspiring the visual language and layout architecture of this engine.*

![Screenshot](img/inspector_1.png)

---

## 🏗️ Architectural Overview & Core Concepts

Tau operates on a decoupled data model:
1. **The Source of Truth:** Your standard Obsidian Markdown notes. All coordinates, lineages, color tokens, and metadata live directly inside the note's YAML frontmatter.
2. **The World Coordinate System:** Time flows vertically along the Y-axis (supporting astronomical BCE/CE dates), while the X-axis represents your customizable thematic lanes, offsets, and spatial groupings.
3. **The Non-Destructive Canvas:** Dragging, scattering, or linking nodes on the canvas immediately synchronizes with your markdown frontmatter using Obsidian's native `app.fileManager` API without altering your note body.

---

## 📑 Complete YAML Frontmatter Schema

Every note designated for Tau must contain `timeline: main` (or your targeted timeline identifier). Below is an annotated, fully loaded YAML example showing every supported property:

```yaml
---
timeline: main
title: "Eastern Roman Empire"
timeline-kind: span-left
start-date: "395 CE"
end-date: "1453 CE"
color: "#7c2d12"
title-color: "#fef3c7"
date-color: "#fed7aa"
text-direction: vertical
border-style: none
importance: 1.5
coordinates: "41.0082, 28.9784"
horizontal-offset: 0
vertical-offset: 0
span-width: 34
span-height-offset: 0
global-event: false
successor: "Ottoman Empire"
child-of: "Roman Empire"
branch-to:
  - "Empire of Trebizond"
  - "Despotate of Epirus"
influence-to:
  - "Kievan Rus"
measure-to: "Fall of Constantinople"
time-travel: ""
image: "byzantine-double-eagle.png"
image-width: 120
---

# Historical Context & Markdown Body
Content written here is completely preserved. Double-clicking this node on the timeline opens the native Markdown Inspector view without editing your metadata.

```

### Property Dictionary

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `timeline` | String | `main` | Associates the file with a specific timeline instance. |
| `title` | String | *Filename* | The display title rendered on the canvas. |
| `timeline-kind` | String | `event` | Geometry mode: `event`, `span`, `span-left`, `era`, `region`, or `note`. |
| `start-date` | String | *Required* | Formatted date (e.g., `1453 CE`, `27 BCE`, `1789-07-14`). |
| `end-date` | String | *Optional* | Terminus date (required for spans, eras, and regions). |
| `color` | String (Hex) | `#1c1917` | Fill color for dots, ribbons, backgrounds, and links. |
| `title-color` | String (Hex) | `#000000` | Text color for node labels. |
| `date-color` | String (Hex) | *Dynamic* | Explicit override for date labels (falls back to theme default). |
| `text-direction` | String | *Auto* | Forces `vertical` or `horizontal` text orientation. |
| `border-style` | String | `none` | For notes: `solid`, `dashed`, or `none`. |
| `importance` | Float | `0` | Scales font and indicator sizes. Values `< 0` flag the item as a minor node. |
| `coordinates` | String | `""` | Geographic `latitude, longitude` coordinates for spatial mapping. |
| `horizontal-offset` | Integer | `0` | X-axis pixel displacement relative to the spine. |
| `vertical-offset` | Integer | `0` | Y-axis pixel displacement relative to the true date coordinate. |
| `span-width` | Integer | *Dynamic* | Manual width override for ribbons and background columns. |
| `span-height-offset` | Integer | `0` | Extends ribbon start/end bounds independently of dates. |
| `global-event` | Boolean | `false` | Renders a full-bleed horizontal dividing line across the entire viewport. |
| `successor` | String | `""` | Fuses the node into a single dynastic lane with the target node. |
| `child-of` | String | `""` | Targets a parent node for a cubic Bezier S-curve link. |
| `branch-to` | List | `[]` | Targets one or more nodes for orthogonal subway-style divergence. |
| `influence-to` | List | `[]` | Targets one or more nodes for dashed directional influence vectors. |
| `measure-to` | String | `""` | Draws an interactive measurement line calculating temporal distance. |
| `image` | String | `""` | Obsidian link (`[[image.png]]`) or vault path to render inline artwork. |
| `image-width` | Integer | `100` | Rendered pixel width of the inline image artifact. |

---

## 🎨 Supported Node Geometries (`timeline-kind`)

Tau adapts its rendering pipelines based on the semantic role of the note:

1. **Point Events (`event`):** Discrete moments in history. Rendered as a circular milestone connected to the left time spine via horizontal anchor lines. Can be promoted to a **Global Event** (`global-event: true`) to draw an epochal divider across the screen.
2. **Spans (`span`):** Continuous historical intervals. Rendered as floating vertical ribbons whose heights directly reflect their chronological duration. Includes automatic edge-clamping for labels.
3. **Left Spans (`span-left`):** The Legend Zone. Occupies a dedicated column cluster along the left ruler edge. Ideal for macro-civilizations, empires, and dynasties. Packed with collision-avoidance algorithms.
4. **Eras (`era`):** Broad contextual backdrops. Painted as ultra-low-opacity vertical bands that span the entire height of the viewport behind your active events.
5. **Regions (`region`):** Spatial boundary boxes that bracket both time and horizontal space, grouping distinct localized sub-histories together.
6. **Notes (`note`):** Floating annotations with configurable borders (`solid`, `dashed`, `none`) for historiographical debates, source citations, or context blocks.

---

## 🔥 Deep-Dive: Core Engine Features

### 1. Absolute Spatial Freedom & Auto-Scatter

Unlike traditional timeline tools that collapse overlapping dates into illegible stacks, Tau gives you complete manual control over node placement.

* **Direct Canvas Manipulation:** Click and drag any node or cluster. When you release the pointer, Tau writes the exact pixel offset directly into your frontmatter (`horizontal-offset` and `vertical-offset`).
* **Auto-Scatter:** Right-click anywhere and trigger **Auto-Scatter All Events**. The engine calculates chronological spacing and programmatically disperses all floating events horizontally across 50 lanes between `X: 20` and `X: 1000` with staggered vertical offsets, eliminating visual pileups in a single pass.

### 2. Advanced Lineage, Topology & Linking

Tau is a relational network graph mapped onto chronological space:

* **Child-Of (S-Curves):** Generates smooth cubic Bezier curves originating from a parent node’s coordinates down to its child.
* **Branch-To (Subway Splits):** Creates thick, orthogonal, right-angle tracks that split from the bottom of an empire or event into one or more divergent successors.
* **Influence-To (Vector Rays):** Emits dashed directional arrows with calculated vector arrowheads, showing cultural, intellectual, or military impact across disparate regions.
* **Measure-To (Temporal Ruler):** Draws an amber measurement arc between any two nodes. The engine calculates the real-time temporal delta and displays a breakdown showing:
* Years, months, and days
* Total elapsed days
* Decimal year differences



### 3. Dynastic Succession & The Assimilation Zone

When displaying successive dynasties in the left legend (`span-left`), chronological overlaps frequently occur during wars of succession, civil fragmentation, or assimilation periods.

* **Lineage Chaining:** Specifying a `successor` forces the engine to bypass normal collision separation. Tau locks the successor into the *exact same horizontal column* as the predecessor.
* **Hatched Integration Zones:** Where Empire A and its `successor` Empire B overlap in time, Tau generates an intersection clipping mask filled with a **45-degree dual-color hatching pattern**, blending the primary hues of both civilizations to represent the transition of power.

### 4. Dual-Modal Interface: Reading vs. Authoring

Tau keeps viewing and editing strictly decoupled to avoid cognitive friction:

* **The Reader (Double-Click):** Double-clicking any node opens the native **Inspector Panel**. It strips out frontmatter completely and uses Obsidian's Markdown engine to display rendered text, links, tasks, and embedded images.
* **The Author (Right-Click → Edit Node Properties):** Opens the **Master Editor HUD**. This unified modal maps every visual and relational attribute to native inputs, dropdowns, and color pickers. Saving updates the note's frontmatter and automatically sanitizes/renames the markdown file to match your new title with collision detection.

### 5. Power User Tools

* **The Clutter Filter:** Assign an `importance` integer to your nodes. Setting `importance: -1` flags an item as low-priority. Toggle **Hide Minor Nodes** from the context menu to clear minor events from the canvas while preserving your macro-historical timeline.
* **Shift-Drag Lasso Selection:** Hold `Shift` and drag across the canvas to draw an area bounding box. All enclosed nodes are multi-selected, allowing you to reposition entire historical eras as a unified group or trigger batch deletions.
* **Intelligent Sticky Headers:** For long spans (`span` and `span-left`) that stretch beyond the screen height, the title text automatically slides along the ribbon and pins itself near the viewport boundary, guaranteeing label visibility during vertical scrolling.
* **Horizontal Raycast Alignment:** Right-click an event, select **Align Horizontally To...**, and click any other node on the board. The source event immediately snaps to the target's horizontal coordinate lane.

---

## 🖱️ Context Menu Cheat Sheet

Right-click anywhere on the canvas or directly on a node to access the command HUD:

| Menu Item | Target | Description |
| --- | --- | --- |
| **Edit Node Properties** | Node | Opens the Master Editor HUD for full YAML configuration. |
| **Open Markdown File** | Node | Opens the source `.md` file in an Obsidian workspace tab. |
| **Delete Node(s)** | Node | Moves the selected node (or multi-selected group) directly to the trash. |
| **Align Horizontally To...** | Node | Raycasts to a clicked target and snaps the current node to its X-coordinate. |
| **Succeeded by...** | Node | Raycasts to assign a dynastic successor for lane-sharing and hatched assimilation. |
| **Child of...** | Node | Raycasts to create a Bezier S-curve from a parent node. |
| **Branch to...** | Node | Raycasts to generate an orthogonal subway divergence line. |
| **Influence to...** | Node | Raycasts to establish a dashed directional vector arrow. |
| **Measure to...** | Node | Raycasts to calculate and display real-time chronological distances. |
| **New Node** | Canvas | Generates a blank note template and opens the Master Editor HUD. |
| **Set Left Strip Width** | Canvas | Adjusts the pixel width of the left dynastic legend (set to `0` to hide). |
| **Auto-Scatter All Events** | Canvas | Automatically disperses overlapping events into clean, readable lanes. |
| **Toggle Minor Nodes** | Canvas | Hides or reveals all nodes with `importance < 0`. |
| **Toggle Visibility Toggles** | Canvas | Independent display switches for Titles, Event Dates, Span Dates, Left-Span Dates, Gridlines, and Anchor Spines. |

---

## ⌨️ Controls & Navigation

* **Pan Timeline:** Left-click and drag on an empty section of the canvas.
* **Temporal Zoom:** Hold `Ctrl` (or `Cmd` on macOS) and scroll the mouse wheel to compress or expand the view scale (from days to tens of thousands of years).
* **Horizontal Pan:** Hold `Shift` and scroll the mouse wheel to traverse horizontal lanes.
* **Move Node(s):** Click and drag a selected node or lassoed group.
* **Multi-Select Lasso:** Hold `Shift`, then click and drag a bounding box around multiple nodes.
* **Open Reader:** Double-click any node.
* **Context Actions:** Right-click canvas or node.

---

## 🛠️ Installation

### Via Obsidian Community Plugins (Recommended)

1. Open Obsidian **Settings** → **Community Plugins**.
2. Ensure Community Plugins are enabled, then click **Browse**.
3. Search for **Tau**.
4. Click **Install**, then **Enable**.

### Manual Installation

1. Download the latest release assets (`main.js`, `manifest.json`, `styles.css`) from the [Releases](https://github.com/) page.
2. Inside your Obsidian vault, navigate to `.obsidian/plugins/` and create a directory named `tau`.
3. Paste the downloaded files into `.obsidian/plugins/tau/`.
4. Reload Obsidian and enable **Tau** in your Community Plugins tab.

---

## 📜 License

MIT License. Built for historical researchers, world-builders, fiction writers, and knowledge archivists.
