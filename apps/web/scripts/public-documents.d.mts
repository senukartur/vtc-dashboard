export function renderPublicDocument(
  shell: string,
  locale: "ru" | "en",
  content: { title: string; description: string },
  markup: string,
): string;
export function withRendererCleanup<T>(
  work: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T>;
