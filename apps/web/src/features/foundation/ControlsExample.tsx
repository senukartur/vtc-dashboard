import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, Input, Label, Select } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../shared/ui/tabs.js";

const periods = ["week", "month", "year"] as const;
type Period = (typeof periods)[number];
const periodLabels = { week: "periodWeek", month: "periodMonth", year: "periodYear" } as const;

// Fictional presentation of the compact size scale; it sends nothing and stores nothing.
export function ControlsExample() {
  const { t } = useTranslation("foundation");
  const [period, setPeriod] = useState<Period>("month");
  return (
    <Card className="controls-example" aria-labelledby="controls-title">
      <h2 id="controls-title">{t("controlsTitle")}</h2>
      <p className="muted">{t("controlsHelp")}</p>
      <div className="control-row">
        <Button type="button">{t("controlsSave")}</Button>
        <Button type="button" variant="outline">
          {t("controlsCancel")}
        </Button>
        <Button type="button" variant="outline" size="xs">
          {t("controlsRowAction")}
        </Button>
      </div>
      <div className="control-row">
        <div className="field">
          <Label htmlFor="controls-filter">{t("controlsFilter")}</Label>
          <Select id="controls-filter" size="xs" defaultValue="all">
            <option value="all">{t("controlsFilterAll")}</option>
            <option value="accepted">{t("controlsFilterAccepted")}</option>
            <option value="pending">{t("controlsFilterPending")}</option>
          </Select>
        </div>
        <div className="field">
          <Label htmlFor="controls-search">{t("controlsSearch")}</Label>
          <Input
            id="controls-search"
            size="xs"
            autoComplete="off"
            placeholder={t("controlsSearchPlaceholder")}
          />
        </div>
      </div>
      <SegmentedControl
        aria-label={t("controlsPeriod")}
        value={period}
        onValueChange={setPeriod}
        options={periods.map((item) => ({ value: item, label: t(periodLabels[item]) }))}
      />
      <Tabs defaultValue="overview">
        <TabsList aria-label={t("controlsTabs")}>
          <TabsTrigger value="overview">{t("controlsOverview")}</TabsTrigger>
          <TabsTrigger value="log">{t("controlsLog")}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <p className="muted">{t("controlsOverviewText")}</p>
        </TabsContent>
        <TabsContent value="log">
          <p className="muted">{t("controlsLogText")}</p>
        </TabsContent>
      </Tabs>
    </Card>
  );
}
