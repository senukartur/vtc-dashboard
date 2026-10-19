const languageMarker = '<html lang="en">';
const robotsMarker = '<meta name="robots" content="noindex, nofollow" />';
const titleMarker = "<title>VTC Dashboard</title>";
const rootMarker = '<div id="root"></div>';

function escapeHtml(value) {
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

/** Substitute only original template markers; inserted copy is never interpreted as a replacement. */
export function renderPublicDocument(shell, locale, content, markup) {
  if (!["ru", "en"].includes(locale)) throw new Error("PUBLIC_DOCUMENT_LOCALE_INVALID");
  const replacements = new Map([
    [languageMarker, `<html lang="${locale}">`],
    [robotsMarker, '<meta name="robots" content="index, follow" />'],
    [
      titleMarker,
      `<title>${escapeHtml(content.title)}</title><meta name="description" content="${escapeHtml(content.description)}" />`,
    ],
    [rootMarker, `<div id="root">${markup}</div>`],
  ]);
  for (const marker of replacements.keys()) {
    const first = shell.indexOf(marker);
    if (first === -1 || shell.indexOf(marker, first + marker.length) !== -1)
      throw new Error("PUBLIC_DOCUMENT_TEMPLATE_INVALID");
  }
  return shell.replace(
    /<html lang="en">|<meta name="robots" content="noindex, nofollow" \/>|<title>VTC Dashboard<\/title>|<div id="root"><\/div>/g,
    (marker) => replacements.get(marker),
  );
}

/** Cleanup covers partial builds as well as renderer import, render and write failures. */
export async function withRendererCleanup(work, cleanup) {
  let outcome;
  let cleanupFailure;
  try {
    outcome = { value: await work() };
  } catch (error) {
    outcome = { error };
  } finally {
    try {
      await cleanup();
    } catch (error) {
      cleanupFailure = { error };
    }
  }
  if (cleanupFailure && "error" in outcome)
    throw new AggregateError(
      [outcome.error, cleanupFailure.error],
      "PUBLIC_DOCUMENT_BUILD_AND_CLEANUP_FAILED",
    );
  if (cleanupFailure) throw cleanupFailure.error;
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}
