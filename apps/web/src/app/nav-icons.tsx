import {
  ArrowRightLeft,
  Calendar,
  ChartLine,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Ellipsis,
  FileText,
  LayoutDashboard,
  type LucideIcon,
  Medal,
  MonitorCheck,
  PanelsTopLeft,
  Plus,
  Settings,
  Truck,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import type { NavItemId } from "./navigation-model.js";

const icons = {
  overview: LayoutDashboard,
  companyOverview: ChartLine,
  myTrips: Truck,
  drafts: FileText,
  events: Calendar,
  drivers: UsersRound,
  qualifications: Medal,
  dispatch: MonitorCheck,
  reconciliation: ArrowRightLeft,
  applications: ClipboardList,
  members: UserRoundPlus,
  catalogs: PanelsTopLeft,
  settings: Settings,
  plus: Plus,
  collapse: ChevronLeft,
  expand: ChevronRight,
  check: Check,
  more: Ellipsis,
} satisfies Record<NavItemId | "plus" | "collapse" | "expand" | "check" | "more", LucideIcon>;
export function NavIcon({ name, size = 16 }: { name: keyof typeof icons; size?: number }) {
  const Icon = icons[name];
  return (
    <Icon className="nav-icon" size={size} strokeWidth={1.8} aria-hidden="true" focusable="false" />
  );
}
