import { it, expect, vi } from "vitest";
import {
  readIcloudCalendarEvents,
  adaptIcloudEvent,
  parseIcalendar,
} from "@/lib/services/icloud-calendar-provider";
const HOME = {
  id: "ic_home",
  name: "Home",
  isDefault: false,
  href: "https://p42-caldav.icloud.com/123/calendars/home/",
  timezone: null,
};
const range = {
  startLocalDate: "2026-10-31",
  endLocalDate: "2026-11-03",
  timezone: "America/New_York",
  selectedCalendarIds: ["ic_home"],
};
const event = (
  extra = "",
  start = "20261031T130000Z",
  end = "DTEND:20261031T140000Z",
) => `BEGIN:VEVENT\nUID:same\nDTSTART:${start}\n${end}\n${extra}\nEND:VEVENT`;
const ical = (events: string) =>
  `BEGIN:VCALENDAR\nVERSION:2.0\n${events}\nEND:VCALENDAR`;
const item = (events: string, path = "x.ics") =>
  `<d:response><d:href>${HOME.href}${path}</d:href><d:propstat><d:prop><c:calendar-data><![CDATA[${ical(events)}]]></c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const xml = (content: string) =>
  `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${content}</d:multistatus>`;
async function read(body: string) {
  const r = await readIcloudCalendarEvents({
    login: {
      appleId: "synthetic@example.invalid",
      appPassword: "abcd-efgh-ijkl-mnop",
    },
    deadlineAt: Date.now() + 25000,
    accountId: "account-1",
    connectionGeneration: 1,
    calendars: [HOME],
    range,
    fetchedAt: "2026-10-31T12:00:00Z",
    fetch: vi.fn(
      async () =>
        new Response(body, {
          status: 207,
          headers: { "content-type": "application/xml" },
        }),
    ),
  });
  return r.ok ? r.snapshot : r.partialSnapshot;
}
it("P1 rejects malformed multistatus with a wrong-namespace response instead of claiming empty complete", async () => {
  const s = await read(
    xml(
      item(event())
        .replace("<d:response>", "<response>")
        .replace("</d:response>", "</response>"),
    ),
  );
  expect(s.completeness).toBe("incomplete");
});
it("P2 rejects unsupported EXRULE recurrence instead of marking complete", async () => {
  const s = await read(xml(item(event("EXRULE:FREQ=DAILY"))));
  expect(s.completeness).toBe("incomplete");
});
it("P3 does not overwrite conflicting duplicate identities with the last event while marking complete", async () => {
  const s = await read(
    xml(
      item(event()) +
        item(event("", "20261031T160000Z", "DTEND:20261031T170000Z"), "y.ics"),
    ),
  );
  expect(s.completeness).toBe("incomplete");
});
it("P4 UTC DTSTART plus P1D stays 24 hours across profile DST", () => {
  const result = adaptIcloudEvent(
    parseIcalendar(ical(event("", "20261031T130000Z", "DURATION:P1D")))
      .components[0]!,
    { accountId: "account-1", calendar: HOME, range, etag: null },
  );
  expect(result).toMatchObject({
    kind: "event",
    event: { endAt: "2026-11-01T13:00:00Z", duration: { seconds: 86400 } },
  });
});
it("P5 rejects comma-separated single-value TZID parameters", async () => {
  const raw = event().replace(
    "DTSTART:20261031T130000Z",
    "DTSTART;TZID=UTC,America/New_York:20261031T130000",
  );
  const s = await read(xml(item(raw)));
  expect(s.completeness).toBe("incomplete");
});
it("P6 rejects unsupported THISANDFUTURE recurrence range", async () => {
  const s = await read(
    xml(item(event("RECURRENCE-ID;RANGE=THISANDFUTURE:20261031T130000Z"))),
  );
  expect(s.completeness).toBe("incomplete");
});
it("P7 rejects an embedded unsupported timezone instead of silently using IANA namesake", async () => {
  const zone =
    "BEGIN:VTIMEZONE\nTZID:America/New_York\nBEGIN:STANDARD\nDTSTART:19700101T000000\nTZOFFSETFROM:+0900\nTZOFFSETTO:+0900\nEND:STANDARD\nEND:VTIMEZONE";
  const raw = event("", "20261031T130000Z", "DTEND:20261031T190000Z").replace(
    "DTSTART:20261031T130000Z",
    "DTSTART;TZID=America/New_York:20261031T130000",
  );
  const s = await read(xml(item(zone + "\n" + raw)));
  expect(s.completeness).toBe("incomplete");
});
it("P8 rejects EXDATE that still modifies the returned event", async () => {
  const s = await read(xml(item(event("EXDATE:20261031T130000Z"))));
  expect(s.completeness).toBe("incomplete");
});
it("P9 rejects malformed multistatus with direct failure status instead of complete empty", async () => {
  const s = await read(xml("<d:status>HTTP/1.1 503 Unavailable</d:status>"));
  expect(s.completeness).toBe("incomplete");
});
it("P10 rejects unsupported collection timezone instead of silently falling back to profile timezone", async () => {
  const { listIcloudCalendars } =
    await import("@/lib/services/icloud-calendar-provider");
  const body = xml(
    `<d:response><d:href>${HOME.href}</d:href><d:propstat><d:prop><d:resourcetype><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set><c:calendar-timezone><![CDATA[BEGIN:VCALENDAR\nBEGIN:VTIMEZONE\nTZID:Custom/Foo\nBEGIN:STANDARD\nDTSTART:19700101T000000\nTZOFFSETFROM:+0900\nTZOFFSETTO:+0900\nEND:STANDARD\nEND:VTIMEZONE\nEND:VCALENDAR]]></c:calendar-timezone></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
  );
  const login = {
    appleId: "synthetic@example.invalid",
    appPassword: "abcd-efgh-ijkl-mnop",
  };
  const calendars = await listIcloudCalendars(
    {
      login,
      deadlineAt: Date.now() + 25000,
      fetch: vi.fn(
        async () =>
          new Response(body, {
            status: 207,
            headers: { "content-type": "application/xml" },
          }),
      ),
    },
    {
      principal: "/123/principal/",
      home: new URL("https://p42-caldav.icloud.com/123/calendars/"),
    },
  );
  const floating = event()
    .replace("20261031T130000Z", "20261031T130000")
    .replace("20261031T140000Z", "20261031T140000");
  const result = await readIcloudCalendarEvents({
    login,
    deadlineAt: Date.now() + 25000,
    accountId: "account-1",
    connectionGeneration: 1,
    calendars,
    range: { ...range, selectedCalendarIds: calendars.map((c) => c.id) },
    fetchedAt: "2026-10-31T12:00:00Z",
    fetch: vi.fn(
      async () =>
        new Response(xml(item(floating)), {
          status: 207,
          headers: { "content-type": "application/xml" },
        }),
    ),
  });
  expect(
    result.ok
      ? result.snapshot.completeness
      : result.partialSnapshot.completeness,
  ).toBe("incomplete");
});

it.each([
  ["20260307T130000Z", "2026-03-07", "2026-03-08T13:00:00Z", "P1D", 86400],
  ["20261031T130000Z", "2026-10-31", "2026-11-01T13:00:00Z", "P1D", 86400],
  ["20260307T130000Z", "2026-03-07", "2026-03-14T13:00:00Z", "P1W", 604800],
  ["20261031T130000Z", "2026-10-31", "2026-11-07T13:00:00Z", "P1W", 604800],
])(
  "UTC duration stays independent of profile DST: %s %s",
  (start, date, endAt, duration, seconds) => {
    const result = adaptIcloudEvent(
      parseIcalendar(ical(event("", start as string, `DURATION:${duration}`)))
        .components[0]!,
      {
        accountId: "account-1",
        calendar: HOME,
        range: {
          ...range,
          startLocalDate: date as string,
          endLocalDate: date as string,
        },
        etag: null,
      },
    );
    expect(result).toMatchObject({
      kind: "event",
      event: { endAt, duration: { seconds } },
    });
  },
);

it.each([
  ["20260307T080000", "2026-03-07", "2026-03-08T12:00:00Z", 82800],
  ["20261031T090000", "2026-10-31", "2026-11-01T14:00:00Z", 90000],
])(
  "zoned nominal days retain their wall time: %s",
  (start, date, endAt, seconds) => {
    const raw = event("", start as string, "DURATION:P1D").replace(
      "DTSTART:",
      "DTSTART;TZID=America/New_York:",
    );
    const result = adaptIcloudEvent(parseIcalendar(ical(raw)).components[0]!, {
      accountId: "account-1",
      calendar: HOME,
      range: {
        ...range,
        startLocalDate: date as string,
        endLocalDate: date as string,
      },
      etag: null,
    });
    expect(result).toMatchObject({
      kind: "event",
      event: { endAt, duration: { seconds } },
    });
  },
);

it("accepts equivalent duplicate records without double counting", async () => {
  const s = await read(xml(item(event()) + item(event(), "copy.ics")));
  expect(s.completeness).toBe("complete");
  expect(s.events).toHaveLength(1);
});
it.each([false, true])(
  "quarantines live/cancelled conflicts in either order (%s)",
  async (reverse) => {
    const items = [item(event()), item(event("STATUS:CANCELLED"), "copy.ics")];
    if (reverse) items.reverse();
    const s = await read(xml(items.join("") + item(event(), "again.ics")));
    expect(s.completeness).toBe("incomplete");
    expect(s.freshness.canAssertNoOverlap).toBe(false);
    expect(s.events).toHaveLength(0);
    expect(s.tombstones).toHaveLength(0);
  },
);
it("accepts a safe namespace extension beside an actually empty multistatus", async () => {
  const s = await read(
    xml('<x:version xmlns:x="urn:example:safe">1</x:version>'),
  );
  expect(s.completeness).toBe("complete");
  expect(s.events).toHaveLength(0);
});
it.each([
  "TZID=UTC,America/New_York",
  'TZID="UTC","America/New_York"',
  "VALUE=DATE-TIME,DATE",
  'VALUE="DATE-TIME,DATE"',
])("rejects multivalued interpreted parameter %s", async (parameter) => {
  const raw = event().replace("DTSTART:", `DTSTART;${parameter}:`);
  expect((await read(xml(item(raw)))).completeness).toBe("incomplete");
});

it("rejects response records concealed in extension containers", async () => {
  const s = await read(
    xml(`<x:wrapper xmlns:x="urn:example">${item(event())}</x:wrapper>`),
  );
  expect(s.completeness).toBe("incomplete");
});
