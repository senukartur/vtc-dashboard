import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  renderPublicDocument,
  withRendererCleanup,
} from "../../apps/web/scripts/public-documents.mjs";

const shell = await readFile(resolve("apps/web/index.html"), "utf8");
const content = { title: "Fictional company", description: "Fictional description" };
const markup = "<section><h1>Fictional public content</h1></section>";
describe("public document generation", () => {
  test.each(["ru", "en"] as const)(
    "generates meaningful %s HTML without invalid relative language annotations",
    (locale) => {
      const document = renderPublicDocument(shell, locale, content, markup);
      expect(document).toContain(`<html lang="${locale}">`);
      expect(document).toContain('<meta name="robots" content="index, follow" />');
      expect(document).toContain(`<title>${content.title}</title>`);
      expect(document).toContain(`<meta name="description" content="${content.description}" />`);
      expect(document).toContain(markup);
      expect(document).not.toContain("hreflang=");
    },
  );
  test("missing or duplicated template markers fail the build instead of leaving incomplete public HTML", () => {
    for (const marker of [
      '<html lang="en">',
      '<meta name="robots" content="noindex, nofollow" />',
      "<title>VTC Dashboard</title>",
      '<div id="root"></div>',
    ]) {
      expect(() => renderPublicDocument(shell.replace(marker, ""), "en", content, markup)).toThrow(
        "PUBLIC_DOCUMENT_TEMPLATE_INVALID",
      );
      expect(() =>
        renderPublicDocument(
          shell.replace(marker, () => marker + marker),
          "en",
          content,
          markup,
        ),
      ).toThrow("PUBLIC_DOCUMENT_TEMPLATE_INVALID");
    }
  });
  test("literal dollar sequences and template-like inserted markup survive without recursive substitution", () => {
    const literal = "$& $' $$ $`";
    const inserted = `<section>${literal}<div id="root"></div><title>VTC Dashboard</title></section>`;
    const document = renderPublicDocument(
      shell,
      "en",
      { title: `Title ${literal}`, description: `Description ${literal}` },
      inserted,
    );
    expect(document).toContain(`<div id="root">${inserted}</div>`);
    expect(document).toContain("<title>Title $&amp; $&#39; $$ $`</title>");
    expect(document).toContain(
      '<meta name="description" content="Description $&amp; $&#39; $$ $`" />',
    );
  });
  test("metadata text is escaped for its HTML context", () => {
    const document = renderPublicDocument(
      shell,
      "en",
      { title: '<Fictional> & "title"', description: '<Description> & "copy"' },
      markup,
    );
    expect(document).toContain("<title>&lt;Fictional&gt; &amp; &quot;title&quot;</title>");
    expect(document).toContain('content="&lt;Description&gt; &amp; &quot;copy&quot;"');
  });
});
describe("temporary renderer cleanup", () => {
  test.each([false, true])(
    "removes actual partial renderer files when generation fails=%s",
    async (fail) => {
      const directory = await mkdtemp(join(tmpdir(), "vtc016-render-"));
      const cleanup = vi.fn(async () => {
        await rm(directory, { recursive: true, force: true });
      });
      try {
        const generated = withRendererCleanup(async () => {
          await writeFile(join(directory, "render.mjs"), "// Synthetic partial renderer");
          if (fail) throw new Error("SYNTHETIC_GENERATION_FAILED");
          return "generated";
        }, cleanup);
        if (fail) await expect(generated).rejects.toThrow("SYNTHETIC_GENERATION_FAILED");
        else await expect(generated).resolves.toBe("generated");
        expect(cleanup).toHaveBeenCalledOnce();
        await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
  test("a cleanup failure fails successful generation and retains both failures when generation also fails", async () => {
    const cleanupFailure = new Error("SYNTHETIC_CLEANUP_FAILED");
    const cleanup = vi.fn(async () => {
      throw cleanupFailure;
    });
    await expect(withRendererCleanup(async () => "generated", cleanup)).rejects.toBe(
      cleanupFailure,
    );
    const generationFailure = new Error("SYNTHETIC_GENERATION_FAILED");
    const failure = await withRendererCleanup(async () => {
      throw generationFailure;
    }, cleanup).catch((error) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toEqual([generationFailure, cleanupFailure]);
    expect(cleanup).toHaveBeenCalledTimes(2);
  });
});
