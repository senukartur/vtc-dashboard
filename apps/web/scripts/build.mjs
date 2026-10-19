// A build from a development container must still compile React in production mode.
process.env.NODE_ENV = "production";
const { readFile, writeFile, rm } = await import("node:fs/promises");
const { build } = await import("vite");
await build({ mode: "production" });
// Build public copy from the same React component without a new server framework.
await build({
  mode: "production",
  build: {
    ssr: "src/features/landing/render.tsx",
    outDir: ".local/public-render",
    rollupOptions: { output: { entryFileNames: "render.mjs" } },
  },
});
const { renderPublic, publicContent } = await import("../.local/public-render/render.mjs");
const shell = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
for (const locale of ["ru", "en"]) {
  const content = publicContent[locale];
  const html = shell
    .replace('lang="en"', `lang="${locale}"`)
    .replace(
      '<meta name="robots" content="noindex, nofollow" />',
      '<meta name="robots" content="index, follow" />',
    )
    .replace(
      "<title>VTC Dashboard</title>",
      `<title>${content.title}</title><meta name="description" content="${content.description}" /><link rel="alternate" hreflang="ru" href="/" /><link rel="alternate" hreflang="en" href="/en" />`,
    )
    .replace('<div id="root"></div>', `<div id="root">${renderPublic(locale)}</div>`);
  await writeFile(new URL(`../dist/public-${locale}.html`, import.meta.url), html);
}
await rm(new URL("../.local/public-render", import.meta.url), { recursive: true });
