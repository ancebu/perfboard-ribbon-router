# Implementation Blueprint: tscircuit Perfboard Ribbon Router

This document is the definitive technical specification for an AI agent or developer to implement a constraint-driven, 2D graph autorouter for tscircuit. It integrates physical embroidery semantics (mirrored ribbons), 45-degree diagonal "bishop" jumps, insulated jumper wire fallbacks, and protected manual pre-routes.

## 1. Architectural Overview

Standard PCB autorouters fail at perfboard simulation because they use continuous shape-based polygons. This system bypasses them by using a **2D Node-Graph Maze Router**.

*   **The Mirrored Ribbon Model**: Physical embroidery wraps around the perfboard, intrinsically occupying both the Top and Bottom layers simultaneously. Therefore, the virtual grid is strictly 2D. Claiming a grid dot `(i, j)` claims it for both physical layers, creating a robust, mirrored "ribbon" of copper.
*   **Grid & Traces**: 100-mil (2.54mm) grid pitch, 1.0mm trace width.
*   **Movement Rules**: 
    1.  **Orthogonal**: 1-step (cost: 1.0).
    2.  **Diagonal "Chess Bishop"**: 1-step jump (cost: 1.414). Unconditionally allowed if the target dot is free, ignoring what is on the orthogonal corners.
    3.  **Jumper Wire Fallback**: 2-step orthogonal leap over an occupied dot (cost: 50.0). Represents a floating insulated wire on the top layer.
*   **Hybrid Routing**: Users can pre-route sections manually. These are hard-locked and act as multi-source terminals for the autorouter.

## 2. Core Data Structures (`lib/router/types.ts`)

```typescript
export interface GridNode {
  i: number;
  j: number;
  x: number; // mm
  y: number; // mm
  netName?: string;        // Claimed by a ribbon
  isTerminal?: boolean;    // Component pin lives here
  isManual?: boolean;      // Hard-locked by human pre-route
  isJumper?: boolean;      // True if this specific segment is an insulated jumper leap
  isBlocked?: boolean;     // Mechanical keepout
}

export interface Net {
  name: string;
  terminals: { i: number; j: number }[];
  routedPath?: GridNode[]; // Array of claimed nodes
}

export interface ManualRoute {
  netName: string;
  path: { i: number; j: number }[];
}
```

## 3. The Ribbon Router Engine (`lib/router/PerfboardRouter.ts`)

This class handles grid initialization, seeding, and the A* pathfinding logic.

```typescript
import { GridNode, Net, ManualRoute } from "./types";

export class PerfboardRouter {
  grid: Map<string, GridNode> = new Map();
  cols: number;
  rows: number;
  GRID_PITCH = 2.54; // mm

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.initGrid();
  }

  private getKey(i: number, j: number): string {
    return `${i},${j}`;
  }

  private initGrid() {
    for (let i = 0; i < this.cols; i++) {
      for (let j = 0; j < this.rows; j++) {
        this.grid.set(this.getKey(i, j), {
          i, j, x: i * this.GRID_PITCH, y: j * this.GRID_PITCH
        });
      }
    }
  }

  // 1. Seed Component Pins
  public seedTerminal(i: number, j: number, netName: string) {
    const node = this.grid.get(this.getKey(i, j));
    if (node) {
      node.netName = netName;
      node.isTerminal = true;
    }
  }

  // 2. Seed Manual Routes (Hard Lock)
  public seedManualRoute(netName: string, path: { i: number; j: number }[]) {
    for (const point of path) {
      const node = this.grid.get(this.getKey(point.i, point.j));
      if (!node || node.isBlocked) continue;

      if (node.netName && node.netName !== netName) {
        throw new Error(`Manual route conflict at ${point.i},${point.j}`);
      }

      node.netName = netName;
      node.isManual = true; // Protect from rip-up
    }
  }

  // 3. Cost Function
  private getMoveCost(from: GridNode, to: GridNode): number {
    if (to.isJumper) return 50.0; // Insulated jumper leap penalty
    
    const di = Math.abs(from.i - to.i);
    const dj = Math.abs(from.j - to.j);

    if (di === 1 && dj === 1) return 1.414; // Diagonal Bishop
    return 1.0; // Standard Orthogonal
  }

  // 4. Neighbor Generation (8-way + Jumper Leap)
  private getNeighbors(current: GridNode, netName: string, targets: GridNode[]): GridNode[] {
    const neighbors: GridNode[] = [];
    const { i, j } = current;

    // Standard 1-step candidates (Ortho + Diagonal)
    const candidates = [
      { i: i + 1, j }, { i: i - 1, j }, { i, j: j + 1 }, { i, j: j - 1 }, // Ortho
      { i: i + 1, j: j + 1 }, { i: i - 1, j: j + 1 }, { i: i + 1, j: j - 1 }, { i: i - 1, j: j - 1 } // Bishop
    ];

    for (const c of candidates) {
      const node = this.grid.get(this.getKey(c.i, c.j));
      if (!node || node.isBlocked) continue;
      
      const isOwnNet = node.netName === netName;
      const isForeignNet = node.netName && !isOwnNet;

      // Can only land on empty space or our own net
      if (!isForeignNet) {
        // If it's our own manual net, only allow stepping onto it if it's a target
        // or if we are already on a manual node (to allow traversing our own manual path)
        if (isOwnNet && node.isManual && !targets.includes(node) && !current.isManual) {
          // Do not use manual routes as pass-through highways
          continue;
        }
        neighbors.push(node);
      }
    }

    // Jumper Wire Fallback (2-step orthogonal leap over foreign net)
    const longJumps = [
      { i: i + 2, j }, { i: i - 2, j }, { i, j: j + 2 }, { i, j: j - 2 },
    ];

    for (const jump of longJumps) {
      const targetNode = this.grid.get(this.getKey(jump.i, jump.j));
      // The dot exactly in between the 2-step jump
      const blockingNode = this.grid.get(this.getKey((i + jump.i) / 2, (j + jump.j) / 2));

      if (!targetNode || !blockingNode) continue;
      if (targetNode.isBlocked) continue;
      
      // Can only jump over a node claimed by ANOTHER net
      if (blockingNode.netName && blockingNode.netName !== netName) {
        // Target must be free or our own net
        if (!targetNode.netName || targetNode.netName === netName) {
          // Mark this node as a jumper so getMoveCost applies the penalty
          targetNode.isJumper = true; 
          neighbors.push(targetNode);
        }
      }
    }

    return neighbors;
  }

  // 5. Multi-Source A* Implementation
  public routeNet(net: Net): boolean {
    const sources: GridNode[] = [];
    const targets: GridNode[] = [];

    // Identify sources (manual routes) and targets (unrouted terminals)
    for (const terminal of net.terminals) {
      const node = this.grid.get(this.getKey(terminal.i, terminal.j));
      if (node) {
        if (node.isManual) sources.push(node);
        else targets.push(node);
      }
    }

    this.grid.forEach(node => {
      if (node.netName === net.name && node.isManual) sources.push(node);
    });

    // If no manual routes exist, the first terminal is the source
    if (sources.length === 0 && net.terminals.length > 0) {
      const first = this.grid.get(this.getKey(net.terminals[0].i, net.terminals[0].j));
      if (first) sources.push(first);
      targets.shift(); // Remove first from targets
    }

    if (sources.length === 0 || targets.length === 0) return true;

    // Standard A* Loop
    // - Open set initialized with all sources (g=0)
    // - For current node, get neighbors passing `net.name` and `targets`
    // - If neighbor is in targets, reconstruct path, claim unclaimed nodes in path, return true.
    // (Standard A* boilerplate omitted for brevity, but utilizes getMoveCost and getNeighbors)
    
    return false; // Failed to route
  }
}
```

## 4. Negotiation & Rip-Up Strategy (`lib/router/negotiator.ts`)

Because wires can block each other, a pure A* will fail on dense boards. The negotiator handles rip-up and reroute, **strictly ignoring manual routes**.

```typescript
import { PerfboardRouter } from "./PerfboardRouter";
import { Net } from "./types";

export function routeAllNets(router: PerfboardRouter, nets: Net[]) {
  let failedNets: Net[] = [...nets];
  let iterations = 5; // Max rip-up attempts

  while (failedNets.length > 0 && iterations > 0) {
    const stillFailed: Net[] = [];

    for (const net of failedNets) {
      const success = router.routeNet(net);
      
      if (!success) {
        // Find nets blocking this path
        const blockers = findBlockingNets(router, net);
        
        for (const blocker of blockers) {
          // CRITICAL: Never rip up manual routes
          const hasManual = blocker.routedPath?.some(n => n.isManual);
          if (hasManual) continue;
          
          router.ripUpNet(blocker);
        }
        
        // Retry routing after rip-up (simplified for docs)
        if (!router.routeNet(net)) {
          stillFailed.push(net);
        }
      }
    }
    
    failedNets = stillFailed;
    iterations--;
  }
}
```

## 5. tscircuit Integration & Output (`src/PerfboardBoard.tsx`)

This React component orchestrates the router and translates the virtual grid paths into real tscircuit primitives. Because of the Mirrored Ribbon model, every solved path generates **two identical `<trace>` elements** (Top and Bottom). **No fake perfboard vias are emitted.**

```tsx
import { PerfboardRouter } from "../lib/router/PerfboardRouter";
import { Net, ManualRoute } from "../lib/router/types";

export const PerfboardBoard = ({ cols, rows, components, nets, manualRoutes }) => {
  // 1. Initialize Router
  const router = new PerfboardRouter(cols, rows);

  // 2. Seed Terminals & Manual Routes
  components.forEach(comp => {
    comp.pins.forEach(pin => router.seedTerminal(pin.i, pin.j, pin.netName));
  });
  manualRoutes.forEach(route => router.seedManualRoute(route.netName, route.path));

  // 3. Run Router
  nets.forEach(net => router.routeNet(net));

  // 4. Materialize Ribbons to tscircuit
  const traces = [];
  
  nets.forEach(net => {
    if (!net.routedPath || net.routedPath.length < 2) return;

    const pathXY = net.routedPath.map(n => [n.x, n.y]);
    const hasJumper = net.routedPath.some(n => n.isJumper);

    // Emit identical trace on Top and Bottom (The Mirrored Ribbon)
    traces.push({ net: net.name, layer: "top", route: pathXY });
    traces.push({ net: net.name, layer: "bottom", route: pathXY });

    // Emit Vias at Jumper Boundaries
    if (hasJumper) {
      // Logic: Find indices where isJumper === true.
      // Emit a via at the node BEFORE the jump, and the node AFTER the jump.
      // This electrically connects the bottom ribbon to the floating top jumper.
    }
  });

  return (
    <board width={cols * 2.54} height={rows * 2.54}>
      {/* 1. Real Components (Through-hole) */}
      {components.map(comp => (
        <comp.componentType key={comp.id} {...comp.props} />
      ))}

      {/* 2. Mirrored Ribbon Traces (1mm width) */}
      {traces.map((trace, idx) => (
        <trace
          key={`trace-${idx}`}
          width={1.0}
          layer={trace.layer}
          net={trace.net}
          path={trace.route}
        />
      ))}
    </board>
  );
};
```

## 6. 3D Rendering Strategy (The Visual Bypass)

To achieve the "real perfboard" look without destroying KiCad DRC or causing 3D collisions, implement these rules in the tscircuit 3D viewer:

1.  **Canonical Perfboard Mesh**: Generate a single custom 3D mesh representing the physical perfboard (board substrate + array of holes + copper rings). Tag this object as `userData: { visual: true, electrical: false }`. **Do not export this to KiCad.**
2.  **Vialess Component Models**: The 3D asset pipeline must use **vialess** versions of all STEP/GLB models. If a model contains baked vias, hide the submesh via scene-graph filtering.
3.  **Trace Rendering**: The 1mm `pcb_trace` elements are rendered natively. Because they exist on both Top and Bottom layers, they will perfectly appear to stitch through the visual perfboard holes.
4.  **Jumper Wire Visuals**: When the router performs a Jumper leap (`isJumper = true`), the 3D viewer should render the Top layer trace segment with a distinct blue cylindrical mesh to visually represent the insulated jumper wire floating above the board.
