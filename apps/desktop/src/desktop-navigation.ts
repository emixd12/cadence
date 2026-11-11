import { revealSettingsTarget } from "@/components/settings/SettingsSections";

// Run after the requested screen commits. Export anchors can mount after its
// local data read, so one animation frame alone is insufficient.
// Ticket 302: an anchor inside a closed Settings row or drawer opens it, and the
// target is held in place while panels above finish loading.
export function scrollAfterDesktopNavigation(anchor?: string): () => void {
  let frame = 0;
  let observer: MutationObserver | undefined;
  let timeout: number | undefined;
  let finished = false;
  let release: () => void = () => undefined;

  function stopWaiting() {
    finished = true;
    window.cancelAnimationFrame(frame);
    observer?.disconnect();
    window.clearTimeout(timeout);
  }
  function scroll() {
    if (finished) return;
    if (!anchor) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      stopWaiting();
      return;
    }
    const target = document.getElementById(anchor);
    if (target) {
      stopWaiting();
      release = revealSettingsTarget(target, { block: "start" });
    } else if (!observer) {
      observer = new MutationObserver(() => {
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(scroll);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      timeout = window.setTimeout(stopWaiting, 10_000);
    }
  }
  frame = window.requestAnimationFrame(scroll);
  return () => {
    stopWaiting();
    release();
  };
}
