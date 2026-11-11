"use client";

import { useActionState, useEffect, useState } from "react";

import {
  TIMEZONE_ACTION_INITIAL_STATE,
  type TimezoneActionState,
} from "@/lib/types/settings";
import { DesktopDraftGuard } from "@/lib/desktop-draft";
import { SettingsSectionHeading } from "@/components/settings/settings-heading";

export type TimezoneUpdateAction = (
  state: TimezoneActionState,
  formData: FormData,
) => Promise<TimezoneActionState>;

type BrowserTimezoneState = {
  status: "checking" | "available" | "unavailable";
  value: string;
};

type TimezonePanelProps = Readonly<{
  currentTimezone: string;
  updateTimezoneAction: TimezoneUpdateAction;
}>;

type TimezoneControlProps = Readonly<{
  onValueChange: (value: string) => void;
  options: string[];
  useTextInput: boolean;
  value: string;
}>;

export function TimezonePanel({
  currentTimezone,
  updateTimezoneAction,
}: TimezonePanelProps) {
  const [state, formAction, isPending] = useActionState(
    updateTimezoneAction,
    TIMEZONE_ACTION_INITIAL_STATE,
  );
  const savedTimezone = state.timezone ?? currentTimezone;
  const [selectedTimezone, setSelectedTimezone] = useState(savedTimezone);
  const [browserTimezone, setBrowserTimezone] =
    useState<BrowserTimezoneState>({
      status: "checking",
      value: "",
    });
  const [timezoneOptions, setTimezoneOptions] = useState<string[]>([]);
  const [hasReadTimezoneOptions, setHasReadTimezoneOptions] = useState(false);
  const selectOptions = buildSelectOptions({
    browserTimezone,
    savedTimezone,
    timezoneOptions,
  });
  const showDetectedHint =
    browserTimezone.status === "available" &&
    browserTimezone.value !== selectedTimezone;

  useEffect(() => {
    let isActive = true;
    const timeoutId = window.setTimeout(() => {
      if (!isActive) {
        return;
      }

      setBrowserTimezone(readBrowserTimezone());
      setTimezoneOptions(readSupportedTimezones());
      setHasReadTimezoneOptions(true);
    }, 0);

    return () => {
      isActive = false;
      window.clearTimeout(timeoutId);
    };
  }, []);

  return (
    <section
      id="timezone"
      className="scroll-mt-20 bg-background py-4 first:pt-0 last:pb-0"
    >
      <SettingsSectionHeading>Timezone</SettingsSectionHeading>
      <form
        key={savedTimezone}
        action={formAction}
        className="mt-4 grid min-w-0 max-w-md grid-cols-1 gap-3"
      >
        <DesktopDraftGuard
          dirty={selectedTimezone !== savedTimezone}
          pending={isPending}
          onDiscard={() => setSelectedTimezone(savedTimezone)}
        />
        <label htmlFor="timezone-select" className="sr-only">
          Timezone
        </label>
        <TimezoneControl
          onValueChange={setSelectedTimezone}
          options={selectOptions}
          useTextInput={
            hasReadTimezoneOptions && timezoneOptions.length === 0
          }
          value={selectedTimezone}
        />
        {showDetectedHint ? (
          <p className="text-sm leading-6 text-muted-readable">
            Detected {browserTimezone.value}.{" "}
            <button
              type="button"
              onClick={() => setSelectedTimezone(browserTimezone.value)}
              className="product-action product-action-secondary"
            >
              Use detected timezone
            </button>
          </p>
        ) : null}
        <p className="text-sm leading-6 text-muted-readable">
          Saving updates active behavior schedules and future unresolved
          occurrences. Past and resolved history stays unchanged.
        </p>
        <button
          type="submit"
          disabled={isPending}
          className="product-action product-action-primary min-h-11 w-fit py-2 text-sm"
        >
          {isPending ? "Saving..." : "Save timezone"}
        </button>
        {state.message ? (
          <p
            role={state.status === "error" ? "alert" : "status"}
            className={[
              "text-sm leading-6",
              state.status === "error" ? "text-accent" : "text-muted-readable",
            ].join(" ")}
          >
            {state.message}
          </p>
        ) : null}
      </form>
    </section>
  );
}

export function TimezoneControl({
  onValueChange,
  options,
  useTextInput,
  value,
}: TimezoneControlProps) {
  if (useTextInput) {
    return (
      <input
        id="timezone-select"
        name="timezone"
        type="text"
        required
        autoComplete="off"
        value={value}
        onChange={(event) => onValueChange(event.currentTarget.value)}
        className="min-h-11 min-w-0 w-full border border-line bg-background px-3 py-2 text-base"
      />
    );
  }

  return (
    <select
      id="timezone-select"
      name="timezone"
      required
      value={value}
      onChange={(event) => onValueChange(event.currentTarget.value)}
      className="product-select min-h-11 min-w-0 w-full border border-line bg-background pl-3 py-2 text-base"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function buildSelectOptions({
  browserTimezone,
  savedTimezone,
  timezoneOptions,
}: Readonly<{
  browserTimezone: BrowserTimezoneState;
  savedTimezone: string;
  timezoneOptions: string[];
}>): string[] {
  const missingOptions = [
    savedTimezone,
    ...(browserTimezone.status === "available"
      ? [browserTimezone.value]
      : []),
  ].filter(
    (option, index, options) =>
      !timezoneOptions.includes(option) && options.indexOf(option) === index,
  );

  return [...missingOptions, ...timezoneOptions];
}

function readBrowserTimezone(): BrowserTimezoneState {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (!timezone) {
    return {
      status: "unavailable",
      value: "",
    };
  }

  return {
    status: "available",
    value: timezone,
  };
}

function readSupportedTimezones(): string[] {
  if (typeof Intl.supportedValuesOf !== "function") {
    return [];
  }

  return Intl.supportedValuesOf("timeZone");
}
