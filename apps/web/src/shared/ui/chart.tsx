// Small Recharts composition adapted from shadcn/ui d2fba50; see third_party/shadcn-ui/LICENSE.
import type { ReactElement } from "react";
import { ResponsiveContainer } from "recharts";

/** Geometry supplements an adjacent exact text/table alternative. Never put domain arithmetic here. */
export function ChartContainer({ children }: { children: ReactElement }) {
  return (
    <div className="chart" aria-hidden="true">
      <ResponsiveContainer initialDimension={{ width: 320, height: 180 }}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}
