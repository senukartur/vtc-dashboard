import { describe, expect, test } from "vitest";
import {
  badgeVariants,
  buttonVariants,
  inputVariants,
  selectVariants,
  tableVariants,
} from "../../apps/web/src/shared/ui/variants.ts";

const classes = (value: string) => value.split(/\s+/).filter(Boolean);

describe("compact control size variants", () => {
  const primitives = [
    ["button", buttonVariants],
    ["input", inputVariants],
    ["select", selectVariants],
    ["badge", badgeVariants],
    ["table", tableVariants],
  ] as const;

  for (const [base, variants] of primitives) {
    test(`${base} defaults to the small size carried by its base class`, () => {
      expect(variants()).toBe(variants({ size: "sm" }));
      expect(classes(variants())).toContain(base);
      expect(classes(variants()).some((name) => name.endsWith("-xs"))).toBe(false);
    });
    test(`${base} extra-small size adds exactly its xs class`, () => {
      const xs = classes(variants({ size: "xs" }));
      expect(xs).toContain(base);
      expect(xs.filter((name) => name.endsWith("-xs"))).toEqual([`${base}-xs`]);
    });
  }

  test("button variant and size combine without replacing each other", () => {
    expect(classes(buttonVariants())).toEqual(["button", "button-primary"]);
    expect(classes(buttonVariants({ variant: "outline", size: "xs" }))).toEqual([
      "button",
      "button-outline",
      "button-xs",
    ]);
    expect(classes(buttonVariants({ variant: "ghost" }))).toEqual(["button", "button-ghost"]);
  });

  test("only the approved compact sizes are accepted", () => {
    // @ts-expect-error large controls were replaced by the compact scale
    expect(classes(buttonVariants({ size: "lg" }))).not.toContain("button-lg");
  });
});
