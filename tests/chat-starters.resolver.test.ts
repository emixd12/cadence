import { describe, expect, it } from "vitest";

import document from "@/packages/core/src/data/chat-starters.json";
import {
  CHAT_STARTER_FALLBACK, CHAT_STARTER_LIBRARY, chatStarterLanes, pickChatStarters, type ChatStarterFacts,
} from "@cadence/core/resolvers/chat-starters.resolver";
import adviceLibrary from "@/packages/core/src/data/advice-library.json";
import { CHAT_FIXTURE_STARTER_FACTS } from "@/app/design-system/chat-fixtures";
import { CHAT_STARTER_PROMPTS, createChatClient, parseChatStarters } from "@/lib/ui/chat";

// Advisor plan Phase 5B (Emi, Nov 20): starter questions picked from the person's own week.

const QUIET: ChatStarterFacts = {
  today: "2026-11-20", todayTotal: 0, todayDone: 0, todayOpen: 0, movedToday: null, unmarked: 0,
  week: { decided: 0, rate: null }, month: { decided: 0, rate: null }, behaviors: [],
};
const texts = (facts: ChatStarterFacts) => pickChatStarters(facts).map((item) => item.text);

describe("chat starter library", () => {
  it("has unique ids, short plain questions, and real advice cards", () => {
    const ids = document.starters.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    const cards = new Set(adviceLibrary.cards.map((card) => card.id));
    for (const item of document.starters) {
      expect(item.text.length).toBeLessThanOrEqual(80);
      expect(item.text).toMatch(/[?.]$/);
      if ("advice_card" in item && item.advice_card) expect(cards.has(item.advice_card)).toBe(true);
    }
    expect(CHAT_STARTER_LIBRARY.starters.filter((item) => item.lane === "general").length).toBeGreaterThanOrEqual(3);
  });

  it("keeps today's three as the fallback", () => {
    expect(CHAT_STARTER_FALLBACK.map((item) => item.text)).toEqual(["What is on today?", "What did I skip this week?", "How is my week going?"]);
    expect(CHAT_STARTER_PROMPTS).toEqual(CHAT_STARTER_FALLBACK.map((item) => item.text));
  });
});

describe("picking starters", () => {
  it("gives three general questions to an account with nothing to go on", () => {
    const picked = pickChatStarters(QUIET);
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((item) => item.id)).size).toBe(3);
    for (const item of picked) expect(CHAT_STARTER_LIBRARY.starters.find((entry) => entry.id === item.id)?.lane).toBe("general");
  });

  it("names a slipping Behavior, mentions unmarked items, then today", () => {
    const lanes = chatStarterLanes(CHAT_FIXTURE_STARTER_FACTS);
    expect(lanes.get("low_behavior")).toBe("Piano practice");
    expect(lanes.get("steady_behavior")).toBe("Meds");
    const picked = pickChatStarters(CHAT_FIXTURE_STARTER_FACTS);
    expect(picked).toHaveLength(3);
    expect(picked[0]!.text).toContain("Piano practice");
    expect(CHAT_STARTER_LIBRARY.starters.find((entry) => entry.id === picked[1]!.id)?.lane).toBe("unmarked");
    expect(CHAT_STARTER_LIBRARY.starters.find((entry) => entry.id === picked[2]!.id)?.lane).toBe("today_open");
  });

  it("asks at most two pattern questions", () => {
    const busy: ChatStarterFacts = { ...CHAT_FIXTURE_STARTER_FACTS, movedToday: "Run", week: { decided: 18, rate: 0.4 }, signals: ["weekday_gap"] };
    const lanes = pickChatStarters(busy).map((item) => CHAT_STARTER_LIBRARY.starters.find((entry) => entry.id === item.id)!.lane);
    expect(lanes.slice(0, 2)).toEqual(["moved_today", "low_behavior"]);
    expect(lanes[2]).toBe("today_open");
  });

  it("is steady within a day and needs enough marks before naming a Behavior", () => {
    expect(texts(CHAT_FIXTURE_STARTER_FACTS)).toEqual(texts(CHAT_FIXTURE_STARTER_FACTS));
    const thin: ChatStarterFacts = { ...QUIET, behaviors: [{ title: "Piano practice", decided: 3, rate: 0 }], month: { decided: 3, rate: 0 } };
    expect(chatStarterLanes(thin).has("low_behavior")).toBe(false);
    expect(chatStarterLanes(thin).has("early")).toBe(true);
  });

  it("notices a slow or strong week only with enough marks", () => {
    const base = { ...QUIET, month: { decided: 40, rate: 0.8 } };
    expect(chatStarterLanes({ ...base, week: { decided: 10, rate: 0.5 } }).has("week_down")).toBe(true);
    expect(chatStarterLanes({ ...base, week: { decided: 3, rate: 0.2 } }).has("week_down")).toBe(false);
    expect(chatStarterLanes({ ...base, month: { decided: 40, rate: 0.5 }, week: { decided: 10, rate: 0.9 } }).has("week_up")).toBe(true);
  });

  it("shortens long titles and congratulates nobody", () => {
    const long = "A very long Behavior title that keeps going and going and going";
    const facts: ChatStarterFacts = { ...QUIET, behaviors: [{ title: long, decided: 10, rate: 0.1 }], month: { decided: 10, rate: 0.1 } };
    const text = pickChatStarters(facts)[0]!.text;
    expect(text).toContain("…");
    expect(text.length).toBeLessThan(90);
    for (const item of document.starters) expect(item.text).not.toMatch(/great|awesome|amazing|!/i);
  });
});

describe("starters on the wire", () => {
  it("keeps well-formed starters and falls back otherwise", async () => {
    expect(parseChatStarters({ starters: [{ id: "a", text: "Why does Run slip?" }, { id: "b", text: 4 }] })).toEqual(["Why does Run slip?"]);
    expect(parseChatStarters({ starters: [] })).toEqual(CHAT_STARTER_PROMPTS);
    expect(parseChatStarters(null)).toEqual(CHAT_STARTER_PROMPTS);
    const failing = createChatClient(async () => new Response("{}", { status: 503 }));
    await expect(failing.starters()).resolves.toEqual(CHAT_STARTER_PROMPTS);
    const offline = createChatClient(async () => { throw new TypeError("offline"); });
    await expect(offline.starters()).resolves.toEqual(CHAT_STARTER_PROMPTS);
  });
});
