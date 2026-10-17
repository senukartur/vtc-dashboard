export const repository: string;
export const maxImageBytes: number;
export const shaPattern: RegExp;
export interface SelectedRelease {
  revision: string;
  runId: number;
  attempt: number;
  artifactId: number;
  mode: string;
}
export function requireRelease(input: unknown): SelectedRelease;
export function validateManifest(
  value: unknown,
  selected: SelectedRelease,
): {
  version: number;
  revision: string;
  runId: number;
  attempt: number;
  bytes: number;
  imageId: string;
  sha256: string;
};
