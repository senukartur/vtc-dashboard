import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { Card } from "../../shared/ui/primitives.js";
import { CompanyOverview } from "./CompanyOverview.js";
import { PersonalOverview } from "./PersonalOverview.js";
import "./dashboard.css";

/**
 * My overview (`/account/dashboard`, the default) or the company overview (`/account/company`).
 * Gate: without company.read no overview query hook mounts, so nothing is requested.
 */
export function DashboardPage({ view = "personal" }: { view?: "personal" | "company" }) {
  const { t } = useTranslation("dashboard");
  const session = useSession();
  if (!session.self?.capabilities.includes("company.read"))
    return (
      <div className="dashboard-page">
        <header className="dashboard-header">
          <div className="dashboard-title">
            <h1>{t(view === "company" ? "title" : "personal.title")}</h1>
            {view === "company" && <p className="dashboard-subtitle">{t("subtitle")}</p>}
          </div>
        </header>
        <Card className="dashboard-forbidden">
          <p>{t("states.forbidden")}</p>
        </Card>
      </div>
    );
  return view === "company" ? <CompanyOverview /> : <PersonalOverview />;
}
