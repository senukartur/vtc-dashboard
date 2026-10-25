import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Fields, State } from "./components.js";
import { useTripQuery } from "./queries.js";
import type { DTO } from "./transport.js";
export function HistoricalRules({ basis }: { basis: DTO["EvaluationSnapshot"] }) {
  const { t } = useTranslation("trips"),
    [open, setOpen] = useState(false),
    query = useTripQuery(
      `/qualification-levels/${basis.levelId}/rule-versions/${basis.ruleVersionId}`,
      "EnvelopeQualificationRuleVersion",
      open && !!basis.levelId && !!basis.ruleVersionId,
    ),
    rules = query.data?.data.data;
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t("historicalRules")}</summary>
      {open && (
        <div className="stack">
          {basis.levelId && basis.ruleVersionId ? (
            <>
              <State query={query} />
              {rules && (
                <>
                  <Fields
                    values={{
                      ruleVersionId: rules.id,
                      levelId: rules.levelId,
                      effectiveAt: rules.effectiveAt,
                      requiredTrips: rules.requiredTrips,
                      requiredDistanceM: rules.requiredDistanceM,
                    }}
                  />
                  {rules.rules.map((rule) => (
                    <div key={rule.type}>
                      <h4>{t(rule.type)}</h4>
                      <Fields values={rule} />
                    </div>
                  ))}
                </>
              )}
            </>
          ) : (
            <p>{t("unknown")}</p>
          )}
        </div>
      )}
    </details>
  );
}
