/**
 * Test file for tscircuit router on a 5x7cm perfboard
 * 
 * Circuit: Header pin providing 3v3 -> powers 2 resistors -> controlled by 2 MOSFETs via push buttons
 * 
 * Board: 5x7 cm perfboard with 2.54mm pitch
 * - 5cm / 2.54mm ≈ 20 columns
 * - 7cm / 2.54mm ≈ 28 rows
 */

import { PerfboardRouter } from "./lib/router/PerfboardRouter.js";
import type { Net, ManualRoute } from "./lib/router/types.js";
import { routeAllNets } from "./lib/router/negotiator.js";

// Board dimensions (5x7 cm with 2.54mm pitch)
const COLS = 20; // ~5cm
const ROWS = 28; // ~7cm

console.log("=== tscircuit Perfboard Router Test ===");
console.log(`Board: ${COLS}x${ROWS} grid (5x7 cm, 2.54mm pitch)`);
console.log("");

// Create router instance
const router = new PerfboardRouter(COLS, ROWS);

// Component placements (grid coordinates)
// Header pin for 3v3 power input at top-left
const HEADER_3V3 = { i: 2, j: 2 };

// Two resistors (R1, R2) positioned in middle area
const R1_POS = { i: 5, j: 10 };
const R2_POS = { i: 8, j: 10 };

// Two MOSFETs (Q1, Q2) below resistors
const Q1_POS = { i: 5, j: 15 };
const Q2_POS = { i: 8, j: 15 };

// Two push buttons (SW1, SW2) near bottom for MOSFET gate control
const SW1_POS = { i: 4, j: 20 };
const SW2_POS = { i: 9, j: 20 };

// Ground connection points
const GND_HEADER = { i: 3, j: 2 };
const R1_GND = { i: 6, j: 10 };
const R2_GND = { i: 9, j: 10 };
const Q1_SOURCE = { i: 5, j: 17 };
const Q2_SOURCE = { i: 8, j: 17 };

console.log("Component Placement:");
console.log(`  Header 3V3: (${HEADER_3V3.i}, ${HEADER_3V3.j})`);
console.log(`  Header GND: (${GND_HEADER.i}, ${GND_HEADER.j})`);
console.log(`  Resistor R1: (${R1_POS.i}, ${R1_POS.j})`);
console.log(`  Resistor R2: (${R2_POS.i}, ${R2_POS.j})`);
console.log(`  MOSFET Q1: (${Q1_POS.i}, ${Q1_POS.j})`);
console.log(`  MOSFET Q2: (${Q2_POS.i}, ${Q2_POS.j})`);
console.log(`  Button SW1: (${SW1_POS.i}, ${SW1_POS.j})`);
console.log(`  Button SW2: (${SW2_POS.i}, ${SW2_POS.j})`);
console.log("");

// Define nets for the circuit
const nets: Net[] = [
  // 3V3 Power net: Header -> R1 -> R2 (resistors powered by 3v3)
  {
    name: "NET_3V3",
    terminals: [HEADER_3V3, R1_POS, R2_POS],
  },
  // Ground net: Header GND -> Q1 Source -> Q2 Source
  {
    name: "GND",
    terminals: [GND_HEADER, Q1_SOURCE, Q2_SOURCE],
  },
  // R1 to Q1 Drain (resistor controls MOSFET drain) - adjacent pins
  {
    name: "NET_R1_Q1",
    terminals: [{ i: R1_POS.i, j: R1_POS.j + 1 }, { i: Q1_POS.i, j: Q1_POS.j - 1 }], // R1 bottom to Q1 drain
  },
  // R2 to Q2 Drain - adjacent pins
  {
    name: "NET_R2_Q2",
    terminals: [{ i: R2_POS.i, j: R2_POS.j + 1 }, { i: Q2_POS.i, j: Q2_POS.j - 1 }], // R2 bottom to Q2 drain
  },
  // SW1 to Q1 Gate (button controls MOSFET gate)
  {
    name: "NET_SW1_Q1_GATE",
    terminals: [SW1_POS, { i: Q1_POS.i + 1, j: Q1_POS.j }], // Q1 gate pin
  },
  // SW2 to Q2 Gate
  {
    name: "NET_SW2_Q2_GATE",
    terminals: [SW2_POS, { i: Q2_POS.i - 1, j: Q2_POS.j }], // Q2 gate pin
  },
];

// Optional manual routes (pre-routed traces that are protected)
const manualRoutes: ManualRoute[] = [
  // Pre-route ground connection between Q1 and Q2 sources
  {
    netName: "GND",
    path: [
      { i: Q1_SOURCE.i, j: Q1_SOURCE.j },
      { i: Q1_SOURCE.i + 1, j: Q1_SOURCE.j },
      { i: Q1_SOURCE.i + 2, j: Q1_SOURCE.j },
      { i: Q2_SOURCE.i, j: Q2_SOURCE.j },
    ],
  },
  // Pre-route 3V3 power from header to near resistors (stop before terminals)
  {
    netName: "NET_3V3",
    path: [
      { i: HEADER_3V3.i, j: HEADER_3V3.j },
      { i: HEADER_3V3.i, j: HEADER_3V3.j + 1 },
      { i: HEADER_3V3.i + 1, j: HEADER_3V3.j + 1 },
      { i: HEADER_3V3.i + 2, j: HEADER_3V3.j + 1 },
      { i: R1_POS.i - 1, j: R1_POS.j },
      { i: R1_POS.i + 1, j: R1_POS.j },
      { i: R2_POS.i - 1, j: R2_POS.j },
    ],
  },
];

console.log("Seeding terminals...");
for (const net of nets) {
  for (const terminal of net.terminals) {
    router.seedTerminal(terminal.i, terminal.j, net.name);
  }
}

console.log("Seeding manual routes...");
for (const route of manualRoutes) {
  router.seedManualRoute(route.netName, route.path);
}

console.log("");
console.log("Routing nets...");
console.log("");

// Route all nets using the negotiator (with rip-up and retry)
routeAllNets(router, nets);

// Report results
let successCount = 0;
let failCount = 0;

for (const net of nets) {
  if (net.routedPath && net.routedPath.length > 0) {
    console.log(`✓ NET "${net.name}" routed successfully (${net.routedPath.length} segments)`);
    successCount++;
  } else {
    console.log(`✗ NET "${net.name}" FAILED to route`);
    failCount++;
  }
}

console.log("");
console.log(`=== Summary ===`);
console.log(`Successful: ${successCount}/${nets.length}`);
console.log(`Failed: ${failCount}/${nets.length}`);

if (failCount === 0) {
  console.log("");
  console.log("🎉 All nets routed successfully!");
  console.log("");
  console.log("Circuit description:");
  console.log("  - 3V3 power from header pin powers two resistors (R1, R2)");
  console.log("  - Each resistor connects to a MOSFET drain (Q1, Q2)");
  console.log("  - Push buttons (SW1, SW2) control MOSFET gates");
  console.log("  - MOSFET sources connected to ground");
  console.log("  - When button pressed, MOSFET turns on, completing circuit through resistor");
} else {
  console.log("");
  console.log("⚠️ Some nets failed to route. Consider adjusting component placement or adding manual routes.");
}

// Export for potential visualization
export { router, nets, manualRoutes };
