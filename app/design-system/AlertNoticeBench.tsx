import { AlertNotice } from "@/components/feedback/AlertNotice";

// Advisor plan Phase 1C. The four states the advisor and its writes can report.
// The last block shows an advice line next to an alert, so the difference is checked
// side by side.
export function AlertNoticeBench() {
  return (
    <div className="grid max-w-xl gap-6">
      <AlertNotice kind="model_failed">
        Today&apos;s note could not be written. The suggested moves below still work.
      </AlertNotice>
      <AlertNotice kind="data_stale" label="Calendar not current">
        Google Calendar last refreshed at 7:40. Times that depend on it are not suggested.
      </AlertNotice>
      <AlertNotice kind="budget_reached">
        This month&apos;s advisor allowance is used up. Your Timeline and the Daily Brief still work. Quips return on December 1.
      </AlertNotice>
      <AlertNotice kind="write_refused" action={<button type="button" className="underline underline-offset-2">Move it again</button>}>
        Gym was just moved to 10:00 on another device.
      </AlertNotice>
      <div className="grid gap-2 border-t border-line pt-4">
        <p className="text-sm text-muted-readable">Advice, for comparison</p>
        <p className="text-base leading-6">Reading got done 9 of 10 times before 9 am this month. Keep it there?</p>
      </div>
    </div>
  );
}
