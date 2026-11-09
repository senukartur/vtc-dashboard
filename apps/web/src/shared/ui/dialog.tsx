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
  onEscapeKeyDown,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="dialog-overlay" />
      <Primitive.Content
        className={cn("dialog-content", className)}
        onEscapeKeyDown={(event) => {
          onEscapeKeyDown?.(event);
          // Escape closes an open combobox first; Radix listens before React's input handler.
          if (
            event.target instanceof Element &&
            event.target.closest('[role="combobox"][aria-expanded="true"]')
          )
            event.preventDefault();
        }}
        {...props}
      >
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  );
}
