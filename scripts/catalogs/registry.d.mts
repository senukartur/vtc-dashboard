export class RegistryError extends Error {
  code: string;
}
export function parseRegistries(
  layers: { root: string; packId: string; registries: string[]; overlay?: boolean }[],
  options?: { maxBytes?: number; maxFiles?: number },
): Promise<{
  units: {
    type: string;
    id: string;
    values: Record<string, string | string[]>;
    origin: { packId: string; file: string; sha256: string };
    overlays: { packId: string; file: string; sha256: string }[];
  }[];
  manifest: { packId: string; file: string; sha256: string }[];
  sourceManifestSha256: string;
}>;
