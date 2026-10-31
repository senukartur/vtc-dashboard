// Adapted from shadcn/ui d2fba50; see third_party/shadcn-ui/LICENSE.
import type { VariantProps } from "class-variance-authority";
import { Label as LabelPrimitive, Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../cn.js";
import {
  badgeVariants,
  buttonVariants,
  inputVariants,
  selectVariants,
  tableVariants,
} from "./variants.js";

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export function Input({
  className,
  size,
  ...props
}: Omit<ComponentProps<"input">, "size"> & VariantProps<typeof inputVariants>) {
  return <input data-slot="input" className={cn(inputVariants({ size }), className)} {...props} />;
}
// Native select keeps platform keyboard behavior; only its box metrics are styled.
export function Select({
  className,
  size,
  ...props
}: Omit<ComponentProps<"select">, "size"> & VariantProps<typeof selectVariants>) {
  return (
    <select data-slot="select" className={cn(selectVariants({ size }), className)} {...props} />
  );
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
export function Badge({
  className,
  size,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ size }), className)} {...props} />;
}
export function Table({
  className,
  size,
  ...props
}: ComponentProps<"table"> & VariantProps<typeof tableVariants>) {
  return <table data-slot="table" className={cn(tableVariants({ size }), className)} {...props} />;
}
