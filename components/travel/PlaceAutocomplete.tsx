"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import {
  PLACE_SEARCH_MIN_QUERY_LENGTH,
  matchSavedPlaces,
  mergePlaceSearchSuggestions,
  normalizePlaceSearchQuery,
} from "@cadence/core/services/place-search";
import type { PlaceSearchSuggestion } from "@cadence/core/types/place-search";
import { webPlaceSearchClient, type PlaceSearchClient } from "@/lib/ui/place-search";

const DEBOUNCE_MS = 350;

const PlaceSearchContext = createContext<PlaceSearchClient | null | undefined>(undefined);

/**
 * Overrides the place-search client for a subtree (e.g. Cadence for Mac passes a
 * Bearer-authenticated client when linked, or null in local-only mode). Outside a
 * provider, web components use `webPlaceSearchClient`.
 */
export function PlaceSearchProvider({
  client,
  children,
}: Readonly<{
  client: PlaceSearchClient | null;
  children: ReactNode;
}>) {
  return <PlaceSearchContext.Provider value={client}>{children}</PlaceSearchContext.Provider>;
}

export function usePlaceSearchClient(override?: PlaceSearchClient | null): PlaceSearchClient | null {
  const fromContext = useContext(PlaceSearchContext);
  if (override !== undefined) return override;
  if (fromContext !== undefined) return fromContext;
  return webPlaceSearchClient;
}

export type PlaceAutocompleteProps = Readonly<{
  id?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (suggestion: PlaceSearchSuggestion) => void;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  onEnter?: () => void;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
  ariaInvalid?: boolean;
  ariaLabel?: string;
  className?: string;
  wrapperClassName?: string;
  savedPlaces?: readonly string[];
  searchClient?: PlaceSearchClient | null;
}>;

/**
 * Cadence-native place and address combobox ("The Quiet Ledger").
 * Matches saved places instantly at zero cost, then queries Geoapify after a 350 ms
 * debounce for 3+ characters. Free-text entry always works, including offline.
 */
export function PlaceAutocomplete({
  id,
  inputRef,
  name,
  value,
  onChange,
  onSelect,
  onBlur,
  onEnter,
  required = false,
  maxLength = 500,
  placeholder,
  ariaInvalid = false,
  ariaLabel,
  className,
  wrapperClassName,
  savedPlaces = [],
  searchClient,
}: PlaceAutocompleteProps) {
  const generatedId = useId();
  const inputId = id ?? `${generatedId}-input`;
  const listboxId = `${generatedId}-listbox`;
  const client = usePlaceSearchClient(searchClient);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [remoteState, setRemoteState] = useState<Readonly<{
    query: string;
    suggestions: readonly PlaceSearchSuggestion[];
    attribution: string | null;
    rateLimited: boolean;
  }> | null>(null);
  const [lastSelectedValue, setLastSelectedValue] = useState<string | null>(null);

  const normalizedQuery = normalizePlaceSearchQuery(value);
  const localSuggestions = useMemo(
    () => (focused && normalizedQuery.length >= 1 ? matchSavedPlaces(savedPlaces, normalizedQuery) : []),
    [focused, normalizedQuery, savedPlaces],
  );
  const matchesSelected = lastSelectedValue !== null && lastSelectedValue === value;
  const shouldSearchRemote =
    focused && !dismissed && Boolean(client) && normalizedQuery.length >= PLACE_SEARCH_MIN_QUERY_LENGTH && !matchesSelected;

  useEffect(() => {
    if (!shouldSearchRemote || !client) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void client.search(normalizedQuery, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        if (result.kind === "ok") {
          setRemoteState({
            query: normalizedQuery,
            suggestions: result.suggestions,
            attribution: result.attribution,
            rateLimited: false,
          });
        } else if (result.kind === "rate_limited") {
          setRemoteState({
            query: normalizedQuery,
            suggestions: [],
            attribution: null,
            rateLimited: true,
          });
        } else {
          setRemoteState({
            query: normalizedQuery,
            suggestions: [],
            attribution: null,
            rateLimited: false,
          });
        }
      });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [client, normalizedQuery, shouldSearchRemote]);

  const currentRemote = shouldSearchRemote && remoteState?.query === normalizedQuery ? remoteState : null;
  const searching = shouldSearchRemote && currentRemote === null;
  const rateLimited = currentRemote?.rateLimited ?? false;
  const attribution = currentRemote?.attribution ?? null;
  const suggestions = useMemo(
    () => mergePlaceSearchSuggestions(localSuggestions, currentRemote?.suggestions ?? []),
    [currentRemote, localSuggestions],
  );

  const hasRemote = suggestions.some((item) => item.source === "geoapify");
  const showPopup = focused && !dismissed && (suggestions.length > 0 || rateLimited || searching);
  const boundedActiveIndex = activeIndex >= 0 && activeIndex < suggestions.length ? activeIndex : -1;

  const selectSuggestion = (suggestion: PlaceSearchSuggestion) => {
    setLastSelectedValue(suggestion.formatted);
    setDismissed(true);
    setActiveIndex(-1);
    onSelect(suggestion);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && suggestions.length > 0) {
      event.preventDefault();
      setDismissed(false);
      setActiveIndex((index) => (index < 0 || index >= suggestions.length - 1 ? 0 : index + 1));
      return;
    }
    if (event.key === "ArrowUp" && suggestions.length > 0) {
      event.preventDefault();
      setDismissed(false);
      setActiveIndex((index) => (index <= 0 || index >= suggestions.length ? suggestions.length - 1 : index - 1));
      return;
    }
    if (event.key === "Escape" && showPopup) {
      event.preventDefault();
      setDismissed(true);
      setActiveIndex(-1);
      return;
    }
    if (event.key === "Enter") {
      if (showPopup && boundedActiveIndex >= 0) {
        event.preventDefault();
        selectSuggestion(suggestions[boundedActiveIndex]!);
        return;
      }
      if (onEnter) {
        event.preventDefault();
        setDismissed(true);
        onEnter();
      }
    }
  };

  const activeOptionId = boundedActiveIndex >= 0
    ? `${listboxId}-option-${boundedActiveIndex}`
    : undefined;

  return (
    <div className={wrapperClassName ? `relative min-w-0 ${wrapperClassName}` : "relative min-w-0"}>
      <input
        ref={inputRef}
        id={inputId}
        name={name}
        value={value}
        maxLength={maxLength}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={showPopup}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        aria-autocomplete="list"
        aria-invalid={ariaInvalid ? "true" : undefined}
        aria-label={ariaLabel}
        onFocus={() => {
          setFocused(true);
          setDismissed(false);
        }}
        onBlur={(event) => {
          setFocused(false);
          setActiveIndex(-1);
          onBlur?.(event);
        }}
        onChange={(event) => {
          setLastSelectedValue(null);
          setDismissed(false);
          setActiveIndex(-1);
          onChange(event.currentTarget.value);
        }}
        onKeyDown={handleKeyDown}
        className={className}
      />
      {showPopup ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Place suggestions"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-none border border-line bg-background"
        >
          {suggestions.length > 0 ? (
            <div className="divide-y divide-line">
              {suggestions.map((suggestion, index) => {
                const active = index === boundedActiveIndex;
                return (
                  <div
                    key={suggestion.id}
                    id={`${listboxId}-option-${index}`}
                    role="option"
                    aria-selected={active}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      selectSuggestion(suggestion);
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={[
                      "cursor-pointer px-3 py-2 text-left transition-colors",
                      active ? "bg-[var(--timeline-row-hover,#eef6ff)]" : "hover:bg-[var(--timeline-row-hover,#eef6ff)]",
                    ].join(" ")}
                  >
                    <div className="text-sm leading-5 text-foreground">{suggestion.title}</div>
                    {suggestion.subtitle ? (
                      <div className="text-xs leading-4 text-muted-readable">{suggestion.subtitle}</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          {searching && suggestions.length === 0 ? (
            <div className="px-3 py-2 text-xs leading-4 text-muted-readable">Searching places…</div>
          ) : null}
          {rateLimited ? (
            <div className="border-t border-line px-3 py-2 text-xs leading-4 text-muted-readable">
              Too many searches for now. You can keep typing the place directly.
            </div>
          ) : null}
          {hasRemote && attribution ? (
            <div className="border-t border-line px-3 py-1.5 text-[11px] leading-4 text-muted-readable">
              {attribution}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
