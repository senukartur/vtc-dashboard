import type { readSelf } from "../src/features/account/transport.js";

export function renderSessionProbe(load?: () => ReturnType<typeof readSelf>): Promise<string>;
