import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ScreenFrame } from "@/components/layout/ScreenFrame";
import { isChatPageAvailable } from "@/lib/navigation";

export const metadata: Metadata = {
  title: "Chat",
};

export const dynamic = "force-dynamic";

export default function ChatPage() {
  if (!isChatPageAvailable("web")) {
    notFound();
  }

  return (
    <ScreenFrame title="Chat">
      <p className="text-sm text-muted-readable">
        Chat can read all of your Cadence data, including notes and connected
        calendars. Change this in Settings.
      </p>
    </ScreenFrame>
  );
}
