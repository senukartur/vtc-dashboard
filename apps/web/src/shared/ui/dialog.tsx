// Adapted from shadcn/ui d2fba50; see third_party/shadcn-ui/LICENSE.
import { Dialog as Primitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../cn.js";

export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;
export const DialogTitle = Primitive.Title;
export const DialogDescription = Primitive.Description;

export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="dialog-overlay" />
      <Primitive.Content className={cn("dialog-content", className)} {...props}>
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  );
}
