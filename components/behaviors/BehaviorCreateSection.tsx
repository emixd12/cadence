"use client";

import { useCallback, useRef, useState } from "react";

import { BehaviorForm } from "@/components/behaviors/BehaviorForm";
import { createLinkMessage, SourceLinkCreateChoice, type SourceLinkChoice } from "@/components/behaviors/SourceLinkSettings";
import { webSourceLinkCoordinator, type SourceLinkCoordinator } from "@/lib/ui/source-links";
import { dispatchBehaviorCreated } from "@/components/behaviors/behavior-events";
import type {
  BehaviorActionState,
  BehaviorFormAction,
  CategoryOption,
} from "@/lib/types/behavior";

type BehaviorCreateSectionProps = Readonly<{
  action: BehaviorFormAction;
  categories: CategoryOption[];
  defaultTimezone: string;
  defaultOpen: boolean;
  reminderRuntime?: "web" | "desktop";
  /** Ticket 329: saves the Complete from Hevy choice after the Behavior is created. */
  sourceLinkCoordinator?: SourceLinkCoordinator;
}>;

export function BehaviorCreateSection({
  action,
  categories,
  defaultTimezone,
  defaultOpen,
  reminderRuntime = "web",
  sourceLinkCoordinator = webSourceLinkCoordinator,
}: BehaviorCreateSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [successMessage, setSuccessMessage] = useState("");
  const [formKey, setFormKey] = useState(0);

  const linkChoice = useRef<SourceLinkChoice>({ mode: "off", selectorKeys: [] });
  const handleLinkChoice = useCallback((choice: SourceLinkChoice) => { linkChoice.current = choice; }, []);

  const handleSuccess = useCallback((state: BehaviorActionState) => {
    setSuccessMessage(state.message);
    const choice = linkChoice.current;

    if (state.behavior) {
      dispatchBehaviorCreated(state.behavior);
      // Ticket 329: the link is its own hosted record, saved once the Behavior exists.
      if (choice.mode !== "off") {
        const behaviorId = state.behavior.id;
        void sourceLinkCoordinator.save({ behaviorId, mode: choice.mode, selectorKeys: choice.selectorKeys })
          .then((result) => setSuccessMessage(createLinkMessage(result)))
          .catch(() => setSuccessMessage(createLinkMessage(null)));
      }
    }

    linkChoice.current = { mode: "off", selectorKeys: [] };
    setIsOpen(false);
    setFormKey((key) => key + 1);
  }, [sourceLinkCoordinator]);

  return (
    <section id="create-behavior" className="scroll-mt-20">
      <details
        className="group"
        open={isOpen}
        onToggle={(event) => {
          const nextOpen = event.currentTarget.open;

          setIsOpen(nextOpen);

          if (nextOpen) {
            setSuccessMessage("");
          }
        }}
      >
        <summary className="product-disclosure-trigger flex min-h-12 items-center py-4 text-2xl leading-tight text-foreground">
          <span
            aria-hidden="true"
            className="product-disclosure-indicator"
          />
          <span
            className="product-disclosure-trigger-label"
            style={{
              flex: isOpen ? "1 1 auto" : "0 1 auto",
            }}
          >
            Create behavior
          </span>
        </summary>
        <div className="py-4 pl-4">
          <BehaviorForm
            reminderRuntime={reminderRuntime}
            key={formKey}
            mode="create"
            action={action}
            categories={categories}
            defaultTimezone={defaultTimezone}
            onSuccess={handleSuccess}
            extraFields={reminderRuntime !== "desktop"
              ? <SourceLinkCreateChoice onChange={handleLinkChoice} coordinator={sourceLinkCoordinator} />
              : null}
          />
        </div>
      </details>

      {successMessage ? (
        <p
          className="mt-4 text-sm leading-6 text-foreground"
          role="status"
        >
          {successMessage}
        </p>
      ) : null}
    </section>
  );
}
