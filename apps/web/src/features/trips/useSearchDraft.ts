import { useEffect, useEffectEvent, useState } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { tripSearch } from "./list-model.js";

/** Back/Forward restores the URL's search. Other controls can update the URL while typing. */
export function useSearchDraft(committed: string, onCommit: (value: string) => void) {
  const { key } = useLocation();
  const navigation = useNavigationType();
  const [location, setLocation] = useState({ key, committed });
  const [draft, setDraft] = useState(committed);
  if (location.key !== key) {
    setLocation({ key, committed });
    if (location.committed !== committed || navigation === "POP") setDraft(committed);
  }

  const search = tripSearch(draft);
  const commit = useEffectEvent(onCommit);
  useEffect(() => {
    if (search === committed) return;
    const timer = window.setTimeout(() => commit(search), 300);
    return () => window.clearTimeout(timer);
  }, [search, committed]);

  return { draft, setDraft };
}
