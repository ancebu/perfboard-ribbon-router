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
