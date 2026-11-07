import { Component, type ErrorInfo, type ReactNode } from "react";

// Ticket 285: a render error must not unmount the whole Mac app and leave a blank window.
// "screen" keeps the navigation, account sync and Settings mounted around the failed screen.
// "app" is the last resort around the whole product when the shell itself fails.
type Props = Readonly<{
  scope: "screen" | "app";
  /** A change (for example, opening another screen) clears the failure and renders again. */
  resetKey?: unknown;
  children: ReactNode;
}>;
type State = { failed: boolean; resetKey: unknown };

// Both messages approved by the owner on November 7, 2026 (D21).
export const DESKTOP_SCREEN_RECOVERY_MESSAGE = "This screen could not be shown. Try again, or open another screen.";
export const DESKTOP_APP_RECOVERY_MESSAGE = "Cadence could not open. Quit and reopen the app to try again.";

export class DesktopErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (Object.is(props.resetKey, state.resetKey)) return null;
    return { failed: false, resetKey: props.resetKey };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Only the error and component stack; no user data is added here.
    console.error("Cadence desktop render error", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.scope === "app") {
      return <main role="alert" className="p-8 text-base">{DESKTOP_APP_RECOVERY_MESSAGE}</main>;
    }
    return (
      <div role="alert" className="m-6 grid max-w-xl gap-3 border border-line p-4 text-base">
        <p>{DESKTOP_SCREEN_RECOVERY_MESSAGE}</p>
        <button type="button" className="product-action product-action-primary min-h-11 justify-self-start"
          onClick={() => this.setState({ failed: false })}>
          Try again
        </button>
      </div>
    );
  }
}
