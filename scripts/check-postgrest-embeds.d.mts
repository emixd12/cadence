export type ForeignKey = {
  relation: string;
  foreignKeyName: string;
  columns: string[];
  referencedRelation: string;
  referencedColumns: string[];
};
export type Candidate = ForeignKey & { direction: "many-to-one" | "one-to-many" };
export type RelationshipData = { relations: Map<string, "table" | "view">; foreignKeys: ForeignKey[] };
export type RelationshipGraph = {
  relations: Map<string, "table" | "view">;
  candidates(parent: string, child: string): Candidate[];
  ambiguousPairs(): { a: string; b: string; foreignKeys: ForeignKey[] }[];
  hasRelation(name: string): boolean;
};
export type SelectItem =
  | { kind: "star" }
  | { kind: "field"; alias: string | null; name: string; cast: string | null; json: string | null }
  | { kind: "aggregate"; alias: string | null; name: string; cast: string | null }
  | {
    kind: "embed"; alias: string | null; name: string; spread: boolean; hint: string | null; hints: string[];
    modifiers: string[]; children: SelectItem[]; start: number; end: number; head: string; raw: string; cast: string | null;
  };
export type EmbedItem = Extract<SelectItem, { kind: "embed" }>;
export type EmbedIssue = {
  embed: EmbedItem; parent: string; child: string; candidates: string[]; problem: string; corrections: string[];
};
export type FileCheckResult = {
  failures: string[]; allowed: string[]; notAnalysed: Map<string, number>; notAnalysedCalls: string[];
  analysed: number; withEmbeds: number; embedsChecked: number; embedsSkipped: number;
};

export const TYPES_FILE: string;
export const SCAN_DIRS: string[];
export const NEGATIVE_FIXTURE: string;
export const ALLOWLIST: Map<string, string>;
export class SelectParseError extends Error {}
export function parseRelationships(typesSource: string, schema?: string): RelationshipData;
export function buildRelationshipGraph(data: RelationshipData): RelationshipGraph;
export function parseSelect(text: string): SelectItem[];
export function listEmbeds(items: SelectItem[]): { embed: EmbedItem; parent: EmbedItem | null }[];
export function checkSelect(items: SelectItem[], rootTable: string, graph: RelationshipGraph): {
  issues: EmbedIssue[]; skipped: { embed: EmbedItem; reason: string }[]; checked: number;
};
export function loadGraph(root: string): RelationshipGraph;
export function checkFiles(root: string, files: string[]): FileCheckResult;
