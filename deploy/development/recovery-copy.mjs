import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

// Run in private owner storage. The 32-byte key must be kept independently of the encrypted copy.
try {
  const [operation, input, keyPath, output] = process.argv.slice(2);
  if (operation === "key" && input && !keyPath && !output) {
    await writeFile(input, randomBytes(32), { flag: "wx", mode: 0o600 });
  } else if (operation === "seal" && input && keyPath && !output) {
    const key = await readFile(keyPath);
    if (key.length !== 32) throw new Error("KEY_INVALID");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const target = createWriteStream(input, { flags: "wx", mode: 0o600 });
    target.write(Buffer.concat([Buffer.from("VTC011E1"), iv]));
    try {
      await pipeline(process.stdin, cipher, target, { end: false });
      target.end(cipher.getAuthTag());
      await new Promise((accept, reject) => {
        target.once("finish", accept);
        target.once("error", reject);
      });
    } catch {
      target.destroy();
      await rm(input, { force: true });
      throw new Error("SEAL_FAILED");
    }
  } else if (operation === "open" && input && keyPath && output) {
    const key = await readFile(keyPath);
    const size = (await stat(input)).size;
    if (key.length !== 32 || size < 36) throw new Error("ENCRYPTED_COPY_INVALID");
    const source = await open(input, "r");
    const header = Buffer.alloc(20);
    const tag = Buffer.alloc(16);
    await source.read(header, 0, 20, 0);
    await source.read(tag, 0, 16, size - 16);
    await source.close();
    if (header.subarray(0, 8).toString() !== "VTC011E1") throw new Error("ENCRYPTED_COPY_INVALID");
    const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(8));
    decipher.setAuthTag(tag);
    const temporary = `${output}.unverified-${randomBytes(8).toString("hex")}`;
    // Reserve the final output first so a successful decrypt cannot replace an existing file.
    const reserved = await open(output, "wx", 0o600);
    await reserved.close();
    try {
      await pipeline(
        createReadStream(input, { start: 20, end: size - 17 }),
        decipher,
        createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
      );
      await rename(temporary, output);
    } catch {
      await rm(temporary, { force: true });
      await rm(output, { force: true });
      throw new Error("COPY_AUTHENTICATION_FAILED");
    }
  } else throw new Error("ARGUMENTS_INVALID");
  console.error("Private recovery copy: success");
} catch {
  console.error("Private recovery copy: failed");
  process.exitCode = 1;
}
