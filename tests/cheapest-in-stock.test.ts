// The fifth Ask Copper tool, find_cheapest_in_stock: the cheapest product with
// at least one color on the shelf today. Stock is faked, so no AI key is needed.
import { getProducts } from "@/lib/copper/catalog";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  sku: string;
  product: string;
  color: string;
  units_in_stock: number;
  next_shipment: string;
};

let inventory: Row[] | null = [];

vi.mock("@/lib/copper/inventory", () => ({
  readInventory: async () => (inventory ? structuredClone(inventory) : null),
}));

const row = (product: string, color: string, units: number): Row => ({
  sku: `${product}-${color}`,
  product,
  color,
  units_in_stock: units,
  next_shipment: "2026-11-20",
});

// Today's seed (Product Bible Section 10).
const SEED = (): Row[] => [
  row("Copper Home", "Polished Copper", 240),
  row("Copper Home", "Patina Teal", 6),
  row("Copper Home", "Night Sky", 185),
  row("Copper Notes", "Brushed Copper", 310),
  row("Copper Notes", "Desert Sand", 92),
  row("Copper Notes", "Night Sky", 0),
];

const priceOf = (name: string) =>
  getProducts().find((product) => product.name === name)!.priceUsd;

async function load() {
  return import("@/lib/copper/assistant/tools");
}

describe("find_cheapest_in_stock", () => {
  beforeEach(() => {
    inventory = SEED();
  });

  it("finds the cheapest product with stock and the colors you can buy, price from the catalog", async () => {
    const { findCheapestInStock } = await load();
    const result = await findCheapestInStock({});
    expect(result).toEqual({
      status: "ok",
      priceUsd: priceOf("Copper Notes"),
      options: [
        {
          product: "Copper Notes",
          // Night Sky has 0 units, so it is left out.
          colors: [
            { color: "Brushed Copper", stock: "in_stock" },
            { color: "Desert Sand", stock: "in_stock" },
          ],
        },
      ],
    });
  });

  it("moves to the next product when the cheapest one is all back-ordered, and flags low stock", async () => {
    inventory = SEED().map((r) =>
      r.product === "Copper Notes" ? { ...r, units_in_stock: 0 } : r,
    );
    const { findCheapestInStock } = await load();
    const result = await findCheapestInStock({});
    expect(result).toMatchObject({
      status: "ok",
      priceUsd: priceOf("Copper Home"),
    });
    expect(result.status === "ok" && result.options[0].colors).toContainEqual({
      color: "Patina Teal",
      stock: "low_stock",
    });
  });

  it("can be limited to one product", async () => {
    const { findCheapestInStock } = await load();
    const result = await findCheapestInStock({ product: "copper-home" });
    expect(result).toMatchObject({
      status: "ok",
      priceUsd: priceOf("Copper Home"),
    });
    expect(result.status === "ok" && result.options).toHaveLength(1);
  });

  it("says nothing is in stock instead of guessing", async () => {
    inventory = SEED().map((r) => ({ ...r, units_in_stock: 0 }));
    const { findCheapestInStock } = await load();
    expect(await findCheapestInStock({})).toEqual({ status: "none_in_stock" });
  });

  it("says stock can't be checked when the stock list can't be read", async () => {
    inventory = null;
    const { findCheapestInStock } = await load();
    const result = await findCheapestInStock({});
    expect(result.status).toBe("unavailable");
  });

  it("reads stock fresh on every call", async () => {
    const { findCheapestInStock } = await load();
    const before = await findCheapestInStock({});
    inventory = SEED().map((r) =>
      r.product === "Copper Notes" ? { ...r, units_in_stock: 0 } : r,
    );
    const after = await findCheapestInStock({});
    expect(before).not.toEqual(after);
  });

  it("is registered as the fifth tool, described for the model, and rejects an unknown product", async () => {
    const { copperTools, cheapestInStockInput } = await load();
    expect(Object.keys(copperTools)).toContain("find_cheapest_in_stock");
    expect(copperTools.find_cheapest_in_stock.description).toMatch(/cheapest/i);
    expect(
      cheapestInStockInput.safeParse({ product: "copper-phone" }).success,
    ).toBe(false);
    expect(cheapestInStockInput.safeParse({}).success).toBe(true);
  });
});
