import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ALERT_NOTICE_LABELS, AlertNotice, type AlertNoticeKind } from "@/components/feedback/AlertNotice";

const KINDS = Object.keys(ALERT_NOTICE_LABELS) as AlertNoticeKind[];

describe("AlertNotice", () => {
  it("covers the four advisor failure states", () => {
    expect(KINDS.sort()).toEqual(["budget_reached", "data_stale", "model_failed", "write_refused"]);
  });

  it.each(KINDS)("marks %s with the warning icon and the alert signal label", (kind) => {
    const html = renderToStaticMarkup(<AlertNotice kind={kind}>Details.</AlertNotice>);
    expect(html).toContain(`data-alert-kind="${kind}"`);
    expect(html).toContain("text-alert-signal");
    expect(html).toContain(ALERT_NOTICE_LABELS[kind]);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("Details.");
  });

  it("announces a refused write at once and standing states politely", () => {
    expect(renderToStaticMarkup(<AlertNotice kind="write_refused">x</AlertNotice>)).toContain('role="alert"');
    for (const kind of ["model_failed", "data_stale", "budget_reached"] as const) {
      expect(renderToStaticMarkup(<AlertNotice kind={kind}>x</AlertNotice>)).toContain('role="status"');
    }
  });

  it("takes a specific label and one action", () => {
    const html = renderToStaticMarkup(
      <AlertNotice kind="data_stale" label="Calendar not current" action={<a href="#refresh">Refresh Google Calendar</a>}>
        Last refreshed at 7:40.
      </AlertNotice>,
    );
    expect(html).toContain("Calendar not current");
    expect(html).not.toContain(ALERT_NOTICE_LABELS.data_stale);
    expect(html).toContain("Refresh Google Calendar");
  });
});
