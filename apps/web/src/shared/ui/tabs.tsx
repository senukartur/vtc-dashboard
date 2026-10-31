// Underline tabs over Radix Tabs: tablist/tab/tabpanel roles, arrow/Home/End roving focus and
// panel labelling come from the primitive. Callers name the list with aria-label(ledby).
import { Tabs as Primitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../cn.js";

export const Tabs = Primitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof Primitive.List>) {
  return <Primitive.List data-slot="tabs-list" className={cn("tabs-list", className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: ComponentProps<typeof Primitive.Trigger>) {
  return (
    <Primitive.Trigger
      data-slot="tabs-trigger"
      className={cn("tabs-trigger", className)}
      {...props}
    />
  );
}
export function TabsContent({ className, ...props }: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Content
      data-slot="tabs-content"
      className={cn("tabs-content", className)}
      {...props}
    />
  );
}
