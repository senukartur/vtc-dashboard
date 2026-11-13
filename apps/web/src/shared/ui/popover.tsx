// Adapted from shadcn/ui d2fba50; see third_party/shadcn-ui/LICENSE.
import { Popover as Primitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../cn.js";

export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;
export const PopoverAnchor = Primitive.Anchor;

export function PopoverContent({
  className,
  align = "start",
  sideOffset = 4,
  collisionPadding = 8,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn("popover-content", className)}
        {...props}
      />
    </Primitive.Portal>
  );
}
