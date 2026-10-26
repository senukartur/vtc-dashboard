import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Badge, Button, Card, Input, Table } from "../../shared/ui/primitives.js";
import { useMembersList } from "./queries.js";

export function DriversPage() {
  const { t } = useTranslation("drivers");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const membersQuery = useMembersList({ limit: 50, cursor });
  const members = membersQuery.data?.items ?? [];

  const filteredMembers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return members;
    return members.filter((m) => m.nickname.toLowerCase().includes(query));
  }, [members, search]);

  const roleLabel = (role: string) => {
    return t(`roles.${role}` as any) || role;
  };

  return (
    <div className="drivers-page stack space-y-6">
      <header className="page-heading">
        <h1 className="text-2xl font-bold">{t("directory.title")}</h1>
        <p className="lead muted">{t("directory.subtitle")}</p>
      </header>

      {/* Search and stats bar */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="w-full sm:max-w-xs">
            <Input
              type="search"
              placeholder={t("directory.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t("directory.searchPlaceholder")}
            />
          </div>
          <div className="text-sm muted">
            {t("directory.totalMembers")}: <strong>{members.length}</strong>
          </div>
        </div>
      </Card>

      {/* Loading state */}
      {membersQuery.isLoading && (
        <Card className="p-8 text-center" role="status" aria-busy="true">
          <p className="muted">{t("states.loading")}</p>
        </Card>
      )}

      {/* Error state */}
      {membersQuery.isError && (
        <Card className="p-6 text-center text-red-400">
          <p className="mb-3">{t("states.error")}</p>
          <Button variant="outline" onClick={() => void membersQuery.refetch()}>
            {t("states.retry")}
          </Button>
        </Card>
      )}

      {/* Members table */}
      {!membersQuery.isLoading && !membersQuery.isError && (
        <Card className="overflow-x-auto">
          {filteredMembers.length === 0 ? (
            <p className="muted py-8 text-center">{t("directory.emptySearch")}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">{t("directory.searchPlaceholder").replace("...", "")}</th>
                  <th scope="col">{t("directory.rolesCol")}</th>
                  <th scope="col">{t("directory.statusCol")}</th>
                  <th scope="col">{t("directory.actionsCol")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map((member, idx) => (
                  <tr
                    key={member.id}
                    className={member.formerMember ? "opacity-60 bg-gray-950/20" : undefined}
                  >
                    <td>{idx + 1}</td>
                    <td>
                      <Link
                        to={`/account/drivers/${member.id}`}
                        className="font-medium hover:underline flex items-center gap-2"
                      >
                        {member.nickname}
                      </Link>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {member.roles.map((r) => (
                          <Badge
                            key={r}
                            className={
                              r === "director"
                                ? "bg-amber-950 text-amber-300"
                                : r === "deputy_director"
                                  ? "bg-purple-950 text-purple-300"
                                  : r === "dispatcher"
                                    ? "bg-blue-950 text-blue-300"
                                    : "bg-gray-800 text-gray-200"
                            }
                          >
                            {roleLabel(r)}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td>
                      {member.formerMember ? (
                        <Badge className="bg-zinc-800 text-zinc-400">
                          {t("directory.formerMember")}
                        </Badge>
                      ) : (
                        <Badge className="bg-emerald-950 text-emerald-300">
                          {t("directory.activeMember")}
                        </Badge>
                      )}
                    </td>
                    <td>
                      <Button asChild variant="outline" className="text-xs py-1 px-3">
                        <Link to={`/account/drivers/${member.id}`}>
                          {t("directory.viewProfile")}
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          {/* Pagination controls if next page cursor exists */}
          {membersQuery.data?.nextCursor && (
            <div className="p-4 border-t border-gray-800 flex justify-end">
              <Button
                variant="outline"
                onClick={() => setCursor(membersQuery.data?.nextCursor ?? undefined)}
              >
                {t("directory.loadMore")}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
