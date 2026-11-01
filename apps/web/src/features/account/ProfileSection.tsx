import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { rolePrecedence } from "../../app/navigation-model.js";
import { Badge, Button } from "../../shared/ui/primitives.js";
import { SettingsRow } from "./SettingsRow.js";
import type { DTO } from "./transport.js";

export function ProfileSection({ self }: { self: DTO["Self"] }) {
  const { t } = useTranslation("account");
  const roles = rolePrecedence.filter((role) => self.member.roles.includes(role));
  const company = self.capabilities.includes("company.read");
  return (
    <div className="settings-card">
      <SettingsRow
        id="profile-nickname"
        title={t("nickname")}
        hint={t("nicknameHint")}
        value={<span>{self.member.nickname}</span>}
      />
      <SettingsRow
        id="profile-roles"
        title={t("roles")}
        value={
          roles.length ? (
            roles.map((role) => <Badge key={role}>{t(`administration:${role}`)}</Badge>)
          ) : (
            <span className="muted">{t("noRoles")}</span>
          )
        }
      />
      {company && (
        <SettingsRow
          id="profile-driver"
          title={t("driverProfile")}
          hint={t("driverProfileHint")}
          action={
            <Button asChild size="xs" variant="outline">
              <Link to={`/account/drivers/${encodeURIComponent(self.member.id)}`}>
                {t("openProfile")}
              </Link>
            </Button>
          }
        />
      )}
    </div>
  );
}
