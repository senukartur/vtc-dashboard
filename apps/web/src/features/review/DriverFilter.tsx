import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { queryString, useCursorPages } from "../../shared/paging.js";
import { Pager } from "../../shared/ui/pager.js";
import { Button, Input, Label, Select } from "../../shared/ui/primitives.js";
import { State } from "../trips/components.js";
import { useTripQuery } from "../trips/queries.js";
import { pageSize } from "./review-model.js";

export function DriverFilter({
  ownerId,
  memberId,
  change,
}: {
  ownerId: string | undefined;
  memberId: string | undefined;
  change: (id: string) => void;
}) {
  const { t, i18n } = useTranslation("trips");
  const id = useId();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const pages = useCursorPages(`/members:${i18n.resolvedLanguage}`);
  const query = useTripQuery(
    `/members?${queryString({ limit: pageSize, cursor: pages.cursor })}`,
    "EnvelopeListMemberSummary",
    open,
    false,
    true,
  );
  pages.recover(query.error);
  const items = query.data?.data.data.items;
  const selected = items?.find((item) => item.id === ownerId);
  const profile = useTripQuery(
    `/members/${ownerId ?? ""}`,
    "EnvelopeMemberProfile",
    !!ownerId && !selected && ownerId !== memberId,
  );
  const label = selected?.nickname ?? profile.data?.data.data.member.nickname;
  const normalize = (value: string) => value.toLocaleLowerCase(i18n.resolvedLanguage);
  const search = normalize(term.trim());
  const matches = items?.filter(
    (item) => item.id !== memberId && normalize(item.nickname).includes(search),
  );
  return (
    <div className="dispatch-driver-filter">
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {ownerId
          ? t("dispatchDriverSelected", { driver: label ?? t("dispatchSelectedDriver") })
          : t("dispatchAllDrivers")}
      </Button>
      <div hidden={!open} id={id} className="dispatch-driver-options">
        {open && (
          <>
            <Label htmlFor={`${id}-search`}>{t("dispatchDriverSearch")}</Label>
            <Input
              id={`${id}-search`}
              type="search"
              value={term}
              maxLength={128}
              onChange={(event) => setTerm(event.target.value)}
            />
            <Label htmlFor={`${id}-driver`}>{t("owner")}</Label>
            <Select
              id={`${id}-driver`}
              value={ownerId ?? ""}
              disabled={query.isPlaceholderData}
              onChange={(event) => change(event.target.value)}
            >
              <option value="">{t("dispatchAllDrivers")}</option>
              {ownerId && !matches?.some((item) => item.id === ownerId) && (
                <option value={ownerId}>{label ?? t("dispatchSelectedDriver")}</option>
              )}
              {matches?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nickname}
                </option>
              ))}
            </Select>
            {matches?.length === 0 && <small>{t("dispatchNoDriversOnPage")}</small>}
            <State query={query} />
            <Pager
              pages={pages}
              nextCursor={query.data?.data.data.nextCursor}
              busy={query.isPlaceholderData}
            />
          </>
        )}
      </div>
    </div>
  );
}
