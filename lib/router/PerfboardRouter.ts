import type { GridNode, Net, ManualRoute } from "./types";

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
      const firstTerminal = net.terminals[0];
      if (firstTerminal) {
        const first = this.grid.get(this.getKey(firstTerminal.i, firstTerminal.j));
        if (first) sources.push(first);
      }
      targets.shift(); // Remove first from targets
    }

    if (sources.length === 0 || targets.length === 0) return true;

    // Standard A* Loop
    const openSet: GridNode[] = [...sources];
    const cameFrom: Map<GridNode, GridNode> = new Map();
    const gScore: Map<GridNode, number> = new Map();
    const fScore: Map<GridNode, number> = new Map();

    for (const source of sources) {
      gScore.set(source, 0);
      fScore.set(source, this.heuristic(source, targets));
    }

    while (openSet.length > 0) {
      // Get node with lowest fScore
      openSet.sort((a, b) => (fScore.get(a) ?? Infinity) - (fScore.get(b) ?? Infinity));
      const current = openSet.shift()!;

      // Check if we reached any target
      if (targets.includes(current)) {
        const path = this.reconstructPath(cameFrom, current);
        // Claim all unclaimed nodes in the path
        for (const node of path) {
          if (!node.netName) {
            node.netName = net.name;
          }
        }
        net.routedPath = path;
        return true;
      }

      const neighbors = this.getNeighbors(current, net.name, targets);
      for (const neighbor of neighbors) {
        const tentativeG = (gScore.get(current) ?? Infinity) + this.getMoveCost(current, neighbor);
        
        if (tentativeG < (gScore.get(neighbor) ?? Infinity)) {
          cameFrom.set(neighbor, current);
          gScore.set(neighbor, tentativeG);
          fScore.set(neighbor, tentativeG + this.heuristic(neighbor, targets));
          
          if (!openSet.includes(neighbor)) {
            openSet.push(neighbor);
          }
        }
      }
    }

    return false; // Failed to route
  }

  private heuristic(node: GridNode, targets: GridNode[]): number {
    let minDist = Infinity;
    for (const target of targets) {
      const di = Math.abs(node.i - target.i);
      const dj = Math.abs(node.j - target.j);
      // Euclidean distance heuristic
      const dist = Math.sqrt(di * di + dj * dj);
      if (dist < minDist) minDist = dist;
    }
    return minDist === Infinity ? 0 : minDist;
  }

  private reconstructPath(cameFrom: Map<GridNode, GridNode>, current: GridNode): GridNode[] {
    const totalPath = [current];
    while (cameFrom.has(current)) {
      current = cameFrom.get(current)!;
      totalPath.unshift(current);
    }
    return totalPath;
  }

  public ripUpNet(net: Net) {
    if (!net.routedPath) return;
    
    for (const node of net.routedPath) {
      // Don't rip up manual routes or terminals
      if (!node.isManual && !node.isTerminal) {
        node.netName = undefined as unknown as string;
        node.isJumper = false;
      }
    }
    net.routedPath = undefined as unknown as GridNode[];
  }
}
