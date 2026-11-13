import type { SourceLinkCoordinator } from "@/lib/ui/source-links";
import type { DesktopConnectorBroker } from "./connector-broker";

// Ticket 330: Complete from Hevy on a linked Mac. Links are hosted records, so the Mac
// reads and saves them through the authenticated broker, never in SQLite. Saving first
// runs account sync, so a Behavior created on this Mac exists on the account, and syncs
// again afterwards so this Mac receives the saved link (contract 5).

type Sync = () => Promise<unknown>;

export function desktopSourceLinkCoordinator(broker: Pick<DesktopConnectorBroker, "sourceLinkState" | "sourceLinkSave">, sync: Sync): SourceLinkCoordinator {
  return {
    getState: (behaviorId) => broker.sourceLinkState(behaviorId),
    async save(input) {
      await sync().catch(() => undefined);
      const result = await broker.sourceLinkSave(input);
      if (result.saved) void sync().catch(() => undefined);
      return result;
    },
  };
}
