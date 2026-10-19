import { QueryClient } from "@tanstack/react-query";
export const createAppQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });
export function clearPrivateQueries(client: QueryClient) {
  void client.cancelQueries({ predicate: (query) => query.meta?.private === true });
  client.removeQueries({ predicate: (query) => query.meta?.private === true });
  client.getMutationCache().clear();
}
