export const TRAVEL_EVIDENCE_VERSION = "1.0" as const;

export type TravelMode = "walking" | "cycling" | "transit" | "driving";

export type TravelNavigationPreference = "google_maps" | "apple_maps";

/** User-authored text only. Resolved provider coordinates are transient. */
export type TravelLocation = Readonly<{
  text: string;
}>;

export type TravelSettings = Readonly<{
  enabled: boolean;
  baseLocationText: string | null;
  mode: TravelMode | null;
  navigationPreference: TravelNavigationPreference | null;
  routingConsentAt: string | null;
  onboardingCompletedAt: string | null;
  updatedAt: string;
  /** Ticket 217. Absent means nothing learned yet: the travel-habit defaults apply. */
  habits?: TravelHabits;
}>;

export type TravelLeaveAnswer = "too_early" | "about_right" | "too_late";

/** A remembered travel mode. The key is a digest of the place text; no text or position. */
export type TravelPlaceMode = Readonly<{
  placeKey: string;
  mode: TravelMode;
  chosenAt: string;
}>;

/** One leave-time answer. The event reference is a digest; no title, time or location. */
export type TravelLeaveFeedback = Readonly<{
  eventRef: string;
  localDate: string;
  answer: TravelLeaveAnswer;
  answeredAt: string;
  rulesVersion: string;
}>;

/**
 * Ticket 217: learned only from what the user tells Cadence. Null minutes follow
 * the versioned defaults. `updatedAt` is null until the first habit change and is
 * the revision for habit writes, separate from the settings revision.
 */
export type TravelHabits = Readonly<{
  preparationMinutes: number | null;
  arrivalBufferMinutes: number | null;
  placeModes: readonly TravelPlaceMode[];
  leaveFeedback: readonly TravelLeaveFeedback[];
  updatedAt: string | null;
}>;

export type TravelPoint =
  | Readonly<{
      kind: "coordinates";
      latitude: number;
      longitude: number;
    }>
  | Readonly<{
      kind: "place_id";
      placeId: string;
    }>;

export type TravelEndpointSource =
  | "saved_base"
  | "behavior"
  | "calendar"
  | "device"
  | "correction"
  | "planned_stop";

export type TravelEndpoint = Readonly<{
  ref: string;
  point: TravelPoint;
  source: TravelEndpointSource;
  sourceRevision: string;
  observedAt?: string;
  accuracyMeters?: number;
  grantRevision?: string;
}>;

export type TravelRouteTiming =
  | Readonly<{ kind: "depart_at"; at: string }>
  | Readonly<{ kind: "arrive_by"; at: string }>;

/** Exact outbound provider projection. It intentionally carries no Cadence refs. */
export type TravelRouteRequest = Readonly<{
  origin: TravelPoint;
  destination: TravelPoint;
  mode: TravelMode;
  readyAt: string;
  timing: TravelRouteTiming;
}>;

export type TravelRouteEstimate = Readonly<{
  durationSeconds: number;
  departureAt: string;
  arrivalAt: string;
  warnings: string[];
  fallback: boolean;
  attribution: string;
  observedAt: string;
  expiresAt: string;
}>;

export type TravelCommitmentKind = "behavior" | "calendar" | "explicit_base_stop";
export type TravelAttendance = "physical" | "remote" | "hybrid" | "unknown";

export type TravelCommitment = Readonly<{
  ref: string;
  revision: string;
  kind: TravelCommitmentKind;
  startAt: string;
  endAt: string | null;
  attendance: TravelAttendance;
  endpoint: TravelEndpoint | null;
  mode: TravelMode | null;
  excluded?: boolean;
  /** Ticket 217: digest of the destination text, used to remember a mode for this place. */
  placeKey?: string | null;
}>;

export type TravelJourneyCorrection = Readonly<{
  journeyRef: string;
  targetRef: "origin" | string;
  appliesToRevision: string;
  endpoint: TravelEndpoint;
}>;

export type TravelBuffers = Readonly<{
  arrivalSeconds: number;
  exitSeconds: number;
  settlingSeconds: number;
  /**
   * Ticket 217 get-ready time before a leg that starts at Home or the current
   * position. It occupies time before departure; it never moves the departure
   * or the route request. Absent means zero.
   */
  preparationSeconds?: number;
}>;

export type TravelPlanningInput = Readonly<{
  journeyRef: string;
  journeyRevision: string;
  now: string;
  grantRevision: string;
  defaultMode: TravelMode;
  base: TravelEndpoint | null;
  device: TravelEndpoint | null;
  /** Informational schedule prediction. It never proves the immediate origin. */
  predictedOrigin: TravelEndpoint | null;
  corrections: TravelJourneyCorrection[];
  commitments: TravelCommitment[];
  buffers: TravelBuffers;
  maxDeviceAgeSeconds?: number;
  maxDeviceAccuracyMeters?: number;
  maxLegs?: number;
}>;

export type TravelLegRole = "outbound" | "onward" | "return";

export type TravelLegProvenance = Readonly<{
  originRef: string;
  originSource: TravelEndpointSource;
  originRevision: string;
  destinationRef: string;
  destinationSource: TravelEndpointSource;
  destinationRevision: string;
  grantRevision: string;
}>;

export type TravelPlannedLeg = Readonly<{
  id: string;
  role: TravelLegRole;
  journeyRef: string;
  originCommitmentRef: string | null;
  destinationCommitmentRef: string | null;
  /** Ticket 217: the destination's place digest; null for the return home. */
  destinationPlaceKey?: string | null;
  mode: TravelMode;
  readyAt: string;
  request: TravelRouteRequest;
  provenance: TravelLegProvenance;
}>;

export type TravelUnknownLeg = Readonly<{
  role: TravelLegRole;
  originCommitmentRef: string | null;
  destinationCommitmentRef: string | null;
  reason:
    | "origin_unknown"
    | "destination_unknown"
    | "attendance_unknown"
    | "timing_unknown"
    | "return_base_missing"
    | "leg_limit";
}>;

export type TravelPlanningResult = Readonly<{
  journeyRef: string;
  journeyRevision: string;
  grantRevision: string;
  commitments: TravelCommitment[];
  legs: TravelPlannedLeg[];
  unknownLegs: TravelUnknownLeg[];
}>;

export type TravelLegResult = Readonly<{
  legId: string;
  provenance: TravelLegProvenance;
  estimate: TravelRouteEstimate | null;
  unavailableReason?: string;
}>;

export type TravelCollisionCandidate = Readonly<{
  ref: string;
  kind: "behavior" | "commitment";
  startAt: string;
  endAt: string | null;
}>;

export type TravelEvidenceInput = Readonly<{
  plan: TravelPlanningResult;
  results: TravelLegResult[];
  collisionCandidates: TravelCollisionCandidate[];
  buffers: TravelBuffers;
  now: string;
  expectedJourneyRevision: string;
  expectedGrantRevision: string;
  modelProjection: "disabled" | "enabled";
}>;

export type TravelOccupiedSegment = Readonly<{
  id: string;
  kind: "commitment" | "preparation_buffer" | "arrival_buffer" | "exit_buffer" | "route" | "settling_buffer";
  startAt: string;
  endAt: string;
  sourceRefs: string[];
  legId: string | null;
}>;

export type TravelOccupiedSpan = Readonly<{
  startAt: string;
  endAt: string;
  segmentIds: string[];
}>;

export type TravelCollisionEvidence = Readonly<{
  candidateRef: string;
  segmentIds: string[];
  travelCreated: boolean;
}>;

/** Safe for UI/API projection: provider endpoints and place identifiers are absent. */
export type TravelEvidenceLeg = Readonly<{
  id: string;
  role: TravelLegRole;
  journeyRef: string;
  originCommitmentRef: string | null;
  destinationCommitmentRef: string | null;
  /** Ticket 217: lets the journey's mode choice name its place without any place text. */
  destinationPlaceKey?: string | null;
  mode: TravelMode;
  readyAt: string;
  provenance: TravelLegProvenance;
}>;

export type TravelResolvedLegEvidence = Readonly<{
  leg: TravelEvidenceLeg;
  state: "current" | "unavailable" | "stale" | "rejected_revision";
  estimate: TravelRouteEstimate | null;
  reason: string | null;
}>;

export type TravelTimingModelProjection = Readonly<{
  version: typeof TRAVEL_EVIDENCE_VERSION;
  journeyRef: string;
  legs: ReadonlyArray<Readonly<{
    ref: string;
    role: TravelLegRole;
    mode: TravelMode;
    departureAt: string;
    arrivalAt: string;
    durationSeconds: number;
    fallback: boolean;
    observedAt: string;
    expiresAt: string;
  }>>;
  occupiedSpans: TravelOccupiedSpan[];
  collisions: TravelCollisionEvidence[];
  completeTrip: boolean;
  finalAvailabilityAt: string | null;
}>;

export type TravelEvidenceResult = Readonly<{
  version: typeof TRAVEL_EVIDENCE_VERSION;
  journeyRef: string;
  legs: TravelResolvedLegEvidence[];
  segments: TravelOccupiedSegment[];
  occupiedSpans: TravelOccupiedSpan[];
  collisions: TravelCollisionEvidence[];
  completeTrip: boolean;
  finalAvailabilityAt: string | null;
  modelProjection: TravelTimingModelProjection | null;
  /** Snapshot of future Behaviors, including resolved stops omitted from this plan. */
  behaviorSources?: readonly Readonly<{
    ref: string; behaviorId: string; unresolved: boolean;
    /** Only exact schedules depend on learned duration. */
    durationSeconds?: number | null;
  }>[];
}>;
