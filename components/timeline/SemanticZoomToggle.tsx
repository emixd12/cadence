"use client";

import type { SemanticZoomLayer } from "./use-semantic-zoom";

const OPTIONS: readonly Readonly<{ layer: SemanticZoomLayer; label: string }>[] = [
  { layer: "parents", label: "Routines" },
  { layer: "sub_behaviors", label: "All steps" },
];

/** The accessible Semantic Zoom control: the same two layers as pinch and Ctrl/Cmd + =/-. */
export function SemanticZoomToggle({
  layer,
  onChange,
  className = "",
}: Readonly<{
  layer: SemanticZoomLayer;
  onChange: (layer: SemanticZoomLayer) => void;
  className?: string;
}>) {
  return (
    <div role="group" aria-label="Timeline detail" className={["flex items-center gap-4 text-sm", className].join(" ")} data-semantic-zoom-toggle>
      {OPTIONS.map((option) => {
        const pressed = option.layer === layer;
        return (
          <button
            key={option.layer}
            type="button"
            aria-pressed={pressed}
            onClick={() => { if (!pressed) onChange(option.layer); }}
            className={[
              "min-h-11 leading-5 underline-offset-4 transition-colors sm:min-h-8",
              pressed ? "text-foreground no-underline" : "text-muted-readable underline hover:text-foreground",
            ].join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
