import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ChatPage } from "@/components/chat/ChatPage";
import { CadencePageBanner } from "@/components/layout/ScreenFrame";
import { isChatPageAvailable } from "@/lib/navigation";

export const metadata: Metadata = {
  title: "Chat",
};

export const dynamic = "force-dynamic";

type ChatRouteProps = Readonly<{
  searchParams?: Promise<{ c?: string | string[]; view?: string | string[] }>;
}>;

export default async function ChatRoute({ searchParams }: ChatRouteProps) {
  if (!isChatPageAvailable("web")) {
    notFound();
  }
  // `?c=<id>` keeps the open conversation across a reload.
  // `?view=past` opens the list (the side menu's "All conversations").
  const params = await searchParams;
  const requested = params?.c;
  const conversationId = typeof requested === "string" && requested ? requested : undefined;
  const initialView = params?.view === "past" ? "past" : "thread";

  return (
    <div className="flex w-full flex-col">
      <CadencePageBanner />
      <div className="mx-auto flex w-full max-w-3xl flex-col px-4 sm:px-6 lg:px-10">
        <h1 className="pt-4 text-3xl font-bold leading-tight sm:text-4xl">Chat</h1>
        <div className="pt-4">
          {/* A new ?c= or ?view= from the side menu starts the page fresh. */}
          <ChatPage
            key={`${conversationId ?? "new"}:${initialView}`}
            syncUrl
            initialConversationId={conversationId}
            initialView={initialView}
          />
        </div>
      </div>
    </div>
  );
}
