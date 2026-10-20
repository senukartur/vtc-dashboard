export class RegistryError extends Error {
  code: string;
}
export type RegistryOrigin = { packId: string; file: string; sha256: string; sourceId?: string };
export function parseRegistries(
  layers: {
    root: string;
    packId: string;
    registries: string[];
    overlay?: boolean;
    sourceId?: string;
    files?: { file: string; sha256: string }[];
  }[],
  options?: { maxBytes?: number; maxFiles?: number; resolution?: "unique_providers" },
): Promise<{
  sourceMode?: "unique_providers";
  contexts?: { id: string; registries: RegistryOrigin[] }[];
  units: {
    type: string;
    id: string;
    values: Record<string, string | string[]>;
    scope?: string;
    contexts?: string[];
    origin: RegistryOrigin;
    coOrigins?: RegistryOrigin[];
    dependencies?: RegistryOrigin[];
    overlays: RegistryOrigin[];
  }[];
  manifest: RegistryOrigin[];
  sourceManifestSha256: string;
}>;
