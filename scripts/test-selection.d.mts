export type SelectableLane =
  | "unit"
  | "contracts"
  | "integration"
  | "persistence"
  | "recovery"
  | "e2e";
export const selectableLanes: SelectableLane[];
export const browserProjects: string[];
export function laneOf(token: string): SelectableLane | undefined;
export function groupSelection(
  tokens: string[],
  exists?: (path: string) => boolean,
): { lane: SelectableLane; files: string[] }[];
export function serializeSelection(tokens: string[]): string;
export function parseSelection(value: string | undefined): string[];
export function validProject(value: string | undefined): boolean;
export function validShard(value: string | undefined): boolean;
export const ciGroups: Record<"core" | "integration" | "persistence-recovery" | "e2e", string[]>;
export function parseLocalArguments(argv: string[]): {
  focus: string;
  probe: boolean;
  skipCheck: boolean;
  project: string;
  shard: string;
  tokens: string[];
};
export function listTestFiles(root: string): string[];
export function affectedTests(
  changed: string[],
  inventory: string[],
  exists?: (path: string) => boolean,
): { tokens: string[]; reasons: string[] };
