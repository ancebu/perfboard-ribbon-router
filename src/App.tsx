import React, { useMemo } from 'react'
import { CircuitJsonPreview } from '@tscircuit/runframe'
import { PerfboardRouter } from '../lib/router/PerfboardRouter'
import { routeAllNets } from '../lib/router/negotiator'
import type { Net, ManualRoute } from '../lib/router/types'
import type { AnyCircuitElement } from 'circuit-json'

const COLS = 20
const ROWS = 28
const PITCH = 2.54

// 1. Run the existing router logic
function runRouter() {
  const router = new PerfboardRouter(COLS, ROWS)

  const HEADER_3V3 = { i: 2, j: 2 }
  const R1_POS = { i: 5, j: 10 }
  const R2_POS = { i: 8, j: 10 }
  const Q1_POS = { i: 5, j: 15 }
  const Q2_POS = { i: 8, j: 15 }
  const SW1_POS = { i: 4, j: 20 }
  const SW2_POS = { i: 9, j: 20 }
  const GND_HEADER = { i: 3, j: 2 }
  const Q1_SOURCE = { i: 5, j: 17 }
  const Q2_SOURCE = { i: 8, j: 17 }

  const nets: Net[] = [
    { name: "NET_3V3", terminals: [HEADER_3V3, R1_POS, R2_POS] },
    { name: "GND", terminals: [GND_HEADER, Q1_SOURCE, Q2_SOURCE] },
    { name: "NET_R1_Q1", terminals: [{ i: R1_POS.i, j: R1_POS.j + 1 }, { i: Q1_POS.i, j: Q1_POS.j - 1 }] },
    { name: "NET_R2_Q2", terminals: [{ i: R2_POS.i, j: R2_POS.j + 1 }, { i: Q2_POS.i, j: Q2_POS.j - 1 }] },
    { name: "NET_SW1_Q1_GATE", terminals: [SW1_POS, { i: Q1_POS.i + 1, j: Q1_POS.j }] },
    { name: "NET_SW2_Q2_GATE", terminals: [SW2_POS, { i: Q2_POS.i - 1, j: Q2_POS.j }] },
  ]

  const manualRoutes: ManualRoute[] = [
    {
      netName: "GND",
      path: [
        { i: Q1_SOURCE.i, j: Q1_SOURCE.j }, { i: Q1_SOURCE.i + 1, j: Q1_SOURCE.j },
        { i: Q1_SOURCE.i + 2, j: Q1_SOURCE.j }, { i: Q2_SOURCE.i, j: Q2_SOURCE.j },
      ],
    },
    {
      netName: "NET_3V3",
      path: [
        { i: HEADER_3V3.i, j: HEADER_3V3.j }, { i: HEADER_3V3.i, j: HEADER_3V3.j + 1 },
        { i: HEADER_3V3.i + 1, j: HEADER_3V3.j + 1 }, { i: HEADER_3V3.i + 2, j: HEADER_3V3.j + 1 },
        { i: R1_POS.i - 1, j: R1_POS.j }, { i: R1_POS.i + 1, j: R1_POS.j }, { i: R2_POS.i - 1, j: R2_POS.j },
      ],
    },
  ]

  for (const net of nets) {
    for (const terminal of net.terminals) router.seedTerminal(terminal.i, terminal.j, net.name)
  }
  for (const route of manualRoutes) router.seedManualRoute(route.netName, route.path)

  routeAllNets(router, nets)
  return nets
}

// 2. Convert Router Output -> Circuit JSON
function convertToCircuitJson(nets: Net[]): AnyCircuitElement[] {
  const elements: AnyCircuitElement[] = []
  const boardWidth = COLS * PITCH
  const boardHeight = ROWS * PITCH

  elements.push({
    type: "pcb_board", pcb_board_id: "board_0",
    center: { x: boardWidth / 2, y: boardHeight / 2 },
    width: boardWidth, height: boardHeight, thickness: 1.6, material: "fr4",
  })

  // Generate Perfboard Holes (Visual Mesh)
  for (let i = 0; i < COLS; i++) {
    for (let j = 0; j < ROWS; j++) {
      elements.push({
        type: "pcb_plated_hole", pcb_plated_hole_id: `hole_${i}_${j}`,
        shape: "circle", hole_diameter: 0.8, outer_diameter: 1.4,
        x: i * PITCH, y: j * PITCH, layers: ["top", "bottom"],
      })
    }
  }

  // Generate Traces & Jumpers
  let jumperCount = 0
  for (const net of nets) {
    if (!net.routedPath || net.routedPath.length < 2) continue

    const routePoints = net.routedPath.map(n => ({ x: n.x, y: n.y, width: 1.0, layer: "top" as const }))

    // Mirrored Ribbons
    elements.push({ type: "pcb_trace", pcb_trace_id: `trace_top_${net.name}`, route: routePoints })
    elements.push({ type: "pcb_trace", pcb_trace_id: `trace_bottom_${net.name}`, route: routePoints.map(p => ({ ...p, layer: "bottom" as const })) })

    // Jumper Wires
    for (let idx = 1; idx < net.routedPath.length; idx++) {
      const node = net.routedPath[idx]
      if (node.isJumper) {
        const prev = net.routedPath[idx - 1]
        const mx = (prev.x + node.x) / 2
        const my = (prev.y + node.y) / 2
        const length = Math.sqrt((node.x - prev.x) ** 2 + (node.y - prev.y) ** 2)
        const angle = Math.atan2(node.y - prev.y, node.x - prev.x) * (180 / Math.PI)

        const pc_id = `jumper_pc_${jumperCount}`
        elements.push({
          type: "pcb_component", pcb_component_id: pc_id,
          center: { x: mx, y: my }, layer: "top", rotation: 0, width: length, height: 1.0,
        })
        elements.push({
          type: "cad_component", cad_component_id: `cad_jumper_${jumperCount}`,
          pcb_component_id: pc_id, position: { x: mx, y: my, z: 2.0 },
          rotation: { x: 0, y: 0, z: angle },
          model_glb_url: "https://modelviewer.dev/shared-assets/models/Astronaut.glb", // Placeholder 3D model
        })
        jumperCount++
      }
    }
  }
  return elements
}

// 3. Render UI
export default function App() {
  const circuitJson = useMemo(() => convertToCircuitJson(runRouter()), [])

  return (
    <div style={{ width: "100vw", height: "100vh", backgroundColor: "#1e1e1e" }}>
      <CircuitJsonPreview 
        circuitJson={circuitJson} 
        defaultTab="3d" 
        showCodeTab={false}
      />
    </div>
  )
}
