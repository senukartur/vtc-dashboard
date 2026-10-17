import { createHash } from "node:crypto";
import type { TxContext } from "@vtc/db";

// Test-only architectural sketches; these do not create production port implementations.
class Failures {
  private next: string | undefined;
  failNext(operation: string) {
    this.next = operation;
  }
  protected check(operation: string) {
    if (this.next === operation) {
      this.next = undefined;
      throw new Error(`SYNTHETIC_${operation}_FAILURE`);
    }
  }
  reset() {
    this.next = undefined;
  }
}

export class MailFake extends Failures {
  private sent: {
    deliveryId: string;
    template: string;
    recipientRef: string;
    privatePayloadRef: string;
  }[] = [];
  get deliveries() {
    return structuredClone(this.sent);
  }
  async deliver(input: (typeof this.sent)[number]) {
    this.check("deliver");
    this.sent.push(structuredClone(input));
    return { providerReceipt: `synthetic:${input.deliveryId}` };
  }
  override reset() {
    super.reset();
    this.sent = [];
  }
}

export class BlobFake extends Failures {
  private objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  async putPrivate(input: {
    objectId: string;
    bytes: AsyncIterable<Uint8Array>;
    contentType: string;
    expectedSha256?: string;
  }) {
    this.check("put");
    const chunks: Buffer[] = [];
    for await (const chunk of input.bytes) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (input.expectedSha256 !== undefined && input.expectedSha256 !== sha256)
      throw new Error("SYNTHETIC_CHECKSUM_MISMATCH");
    if (this.objects.has(input.objectId)) throw new Error("SYNTHETIC_OBJECT_EXISTS");
    this.objects.set(input.objectId, {
      bytes: Uint8Array.from(bytes),
      contentType: input.contentType,
    });
    return { sha256, byteLength: bytes.byteLength };
  }
  async readPrivate(objectId: string): Promise<AsyncIterable<Uint8Array>> {
    this.check("read");
    const object = this.objects.get(objectId);
    if (!object) throw new Error("SYNTHETIC_OBJECT_MISSING");
    const bytes = Uint8Array.from(object.bytes);
    return (async function* () {
      yield bytes;
    })();
  }
  async removeUnreferenced(objectId: string) {
    this.check("remove");
    this.objects.delete(objectId);
  }
  override reset() {
    super.reset();
    this.objects.clear();
  }
}

export class IdentityFake extends Failures {
  private saved: {
    tx: TxContext;
    input: { userId: string; email: string; name: string; passwordHash: string };
  }[] = [];
  get inserts() {
    return this.saved.map(({ tx, input }) => ({ tx, input: structuredClone(input) }));
  }
  async prepareCredential(_password: string) {
    this.check("prepare");
    return { passwordHash: "NONFUNCTIONAL_SYNTHETIC_CREDENTIAL" };
  }
  async insertWithCredential(tx: TxContext, input: (typeof this.saved)[number]["input"]) {
    this.check("insert");
    this.saved.push({ tx, input: structuredClone(input) });
  }
  override reset() {
    super.reset();
    this.saved = [];
  }
}

export type ProviderResult =
  | { status: "known"; externalId: string }
  | { status: "unavailable"; reasonCode: string }
  | { status: "ambiguous"; candidates: string[] };
export class ProviderFake extends Failures {
  constructor(
    private result: ProviderResult = { status: "unavailable", reasonCode: "synthetic_unavailable" },
  ) {
    super();
  }
  async lookup() {
    this.check("lookup");
    return structuredClone(this.result);
  }
  set(result: ProviderResult) {
    this.result = structuredClone(result);
  }
  override reset() {
    super.reset();
    this.result = { status: "unavailable", reasonCode: "synthetic_unavailable" };
  }
}
