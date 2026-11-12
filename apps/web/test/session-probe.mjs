import { QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createAppQueryClient } from "../src/app/session-cache.ts";
import { SessionProvider, useSession } from "../src/app/Session.tsx";

function SessionProbe() {
  const { state, eventsStage2Enabled } = useSession();
  return createElement("output", null, `${state}:${eventsStage2Enabled}`);
}

export async function renderSessionProbe(load) {
  const client = createAppQueryClient();
  // Read the resolved state without an SSR remount immediately retrying a failed query.
  client.setDefaultOptions({ queries: { retry: false, retryOnMount: false } });
  try {
    if (load)
      await client
        .fetchQuery({ queryKey: ["account-session", 0, true], queryFn: load })
        .catch(() => undefined);
    return renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          MemoryRouter,
          { initialEntries: ["/account"] },
          createElement(SessionProvider, null, createElement(SessionProbe)),
        ),
      ),
    );
  } finally {
    client.clear();
  }
}
