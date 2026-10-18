// Adapted from shadcn/ui d2fba50; see third_party/shadcn-ui/LICENSE.
import { cva, type VariantProps } from "class-variance-authority";
import { Label as LabelPrimitive, Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../cn.js";

const buttonVariants = cva("button", {
  variants: {
    variant: { default: "button-primary", outline: "button-outline", ghost: "button-ghost" },
  },
  defaultVariants: { variant: "default" },
});

export function Button({
  className,
  variant,
  asChild = false,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp data-slot="button" className={cn(buttonVariants({ variant }), className)} {...props} />
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input data-slot="input" className={cn("input", className)} {...props} />;
}
export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn("label", className)} {...props} />;
}
export function FieldError({ id, children }: { id: string; children?: string | undefined }) {
  return children ? (
    <p id={id} className="field-error" role="alert">
      {children}
    </p>
  ) : null;
}
export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section data-slot="card" className={cn("card", className)} {...props} />;
}
export function Badge({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="badge" className={cn("badge", className)} {...props} />;
}
export function Table({ className, ...props }: ComponentProps<"table">) {
  return <table data-slot="table" className={cn("table", className)} {...props} />;
}
