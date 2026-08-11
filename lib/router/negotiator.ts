import type { PerfboardRouter } from "./PerfboardRouter";
import type { Net } from "./types";

function findBlockingNets(router: PerfboardRouter, net: Net): Net[] {
  const blockingNets = new Set<string>();
  
  if (!net.routedPath) return [];
  
  // Note: getNeighbors is private, so this is a simplified placeholder
  // In a real implementation, you'd have access to all nets directly
  
  // Return placeholder nets - in a real implementation, you'd have access to all nets
  return Array.from(blockingNets).map(name => ({ name, terminals: [] }));
}

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
          const hasManual = blocker.routedPath?.some((n: { isManual?: boolean }) => n.isManual);
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
