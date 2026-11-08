// Module 2: the four tools Ask Copper can use. Products and prices come from
// lib/copper/catalog.ts and stock from lib/copper/inventory.ts, so the
// chatbot never has to make them up.
// The contract for each tool is in specs/module-2/spec.md.
import { tool } from "ai";
import { z } from "zod";
import {
  getPlans,
  getProducts,
  type Plan,
  type ProductId,
} from "@/lib/copper/catalog";
import { readInventory } from "@/lib/copper/inventory";

export type ProductList = {
  products: {
    id: ProductId;
    name: string;
    type: string;
    priceUsd: number;
    colors: string[];
  }[];
};

export type Prices = {
  products: { id: ProductId; name: string; priceUsd: number }[];
  plans: {
    id: Plan["id"];
    name: string;
    monthlyUsd: number;
    annualUsd: number;
  }[];
};

export type CalculateCostInput = {
  products: ProductId[];
  plan: Plan["id"];
  billing: "monthly" | "annual";
  years: number;
};

export type CostBreakdown = {
  lines: { item: string; usd: number }[];
  totalUsd: number;
};

export type CheckAvailabilityInput = { product: ProductId; color?: string };

export type Stock = "in_stock" | "low_stock" | "backordered";

export type Availability =
  | {
      status: "ok";
      product: string;
      colors: { color: string; stock: Stock; restockDate: string | null }[];
    }
  | { status: "not_a_color"; product: string; color: string; colors: string[] }
  | { status: "unavailable"; message: string };

/** Round to whole cents. */
const toCents = (amount: number) => Math.round(amount * 100) / 100;

/** get_products: what Copper sells and which colors each one comes in. */
export function listProducts(): ProductList {
  return {
    products: getProducts().map((product) => ({
      id: product.id,
      name: product.name,
      type: product.type,
      priceUsd: product.priceUsd,
      colors: product.colors,
    })),
  };
}

/** get_prices: every product and plan price, read from the catalog. */
export function getPrices(): Prices {
  return {
    products: getProducts().map((product) => ({
      id: product.id,
      name: product.name,
      priceUsd: product.priceUsd,
    })),
    plans: getPlans().map((plan) => ({
      id: plan.id,
      name: plan.name,
      monthlyUsd: plan.monthlyUsd,
      annualUsd: plan.annualUsd,
    })),
  };
}

export const calculateCostInput: z.ZodType<CalculateCostInput> = z.object({
  products: z.array(z.enum(["copper-home", "copper-notes"])).max(5),
  plan: z.enum(["free", "copper-plus"]),
  billing: z.enum(["monthly", "annual"]),
  years: z.number().int().min(1).max(5),
});

/** calculate_cost: the total cost of devices plus a plan over some years. */
export function calculateCost(input: CalculateCostInput): CostBreakdown {
  const catalog = getProducts();
  const lines: CostBreakdown["lines"] = [];

  // Each device is paid for once.
  for (const id of input.products) {
    const product = catalog.find((candidate) => candidate.id === id);
    if (product)
      lines.push({ item: product.name, usd: toCents(product.priceUsd) });
  }

  // Copper Plus covers the whole household, so it's one line. Free adds none.
  const plan = getPlans().find((candidate) => candidate.id === input.plan);
  if (plan && plan.id === "copper-plus") {
    const usd =
      input.billing === "monthly"
        ? plan.monthlyUsd * 12 * input.years
        : plan.annualUsd * input.years;
    lines.push({
      item: `${plan.name} (${input.billing}, ${input.years} ${
        input.years === 1 ? "year" : "years"
      })`,
      usd: toCents(usd),
    });
  }

  const totalUsd = toCents(lines.reduce((sum, line) => sum + line.usd, 0));
  return { lines, totalUsd };
}

export const checkAvailabilityInput: z.ZodType<CheckAvailabilityInput> =
  z.object({
    product: z.enum(["copper-home", "copper-notes"]),
    color: z.string().optional(),
  });

/** 0 units is backordered, 1 to 9 is low, 10 or more is in stock. */
function stockLevel(units: number): Stock {
  if (units <= 0) return "backordered";
  if (units < 10) return "low_stock";
  return "in_stock";
}

/** check_availability: stock for one product (or one of its colors), read fresh each time. */
export async function checkAvailability(
  input: CheckAvailabilityInput,
): Promise<Availability> {
  const product = getProducts().find(
    (candidate) => candidate.id === input.product,
  );
  if (!product) {
    return {
      status: "unavailable",
      message: "That product isn't in the catalog.",
    };
  }

  // A color the product doesn't come in is always "not_a_color", even if the
  // stock list can't be read, so check the catalog before reading stock.
  const wanted = input.color?.trim().toLowerCase();
  const catalogColors =
    wanted === undefined
      ? product.colors
      : product.colors.filter((color) => color.toLowerCase() === wanted);
  if (wanted !== undefined && catalogColors.length === 0) {
    return {
      status: "not_a_color",
      product: product.name,
      color: input.color ?? "",
      colors: product.colors,
    };
  }

  const rows = await readInventory();
  if (rows === null) {
    return {
      status: "unavailable",
      message:
        "Stock can't be checked right now. Please try again in a little while.",
    };
  }

  // Stock rows hold the display name ("Copper Notes"), not the id.
  const colors: { color: string; stock: Stock; restockDate: string | null }[] =
    [];
  for (const color of catalogColors) {
    const row = rows.find(
      (candidate) =>
        candidate.product === product.name &&
        candidate.color.toLowerCase() === color.toLowerCase(),
    );
    if (!row) continue;
    const stock = stockLevel(row.units_in_stock);
    colors.push({
      color,
      stock,
      restockDate: stock === "backordered" ? row.next_shipment : null,
    });
  }
  return { status: "ok", product: product.name, colors };
}

export type CheapestInStockInput = { product?: ProductId };

export type CheapestInStock =
  | {
      status: "ok";
      priceUsd: number;
      options: {
        product: string;
        colors: { color: string; stock: Stock }[];
      }[];
    }
  | { status: "none_in_stock" }
  | { status: "unavailable"; message: string };

export const cheapestInStockInput: z.ZodType<CheapestInStockInput> = z.object({
  product: z.enum(["copper-home", "copper-notes"]).optional(),
});

/**
 * find_cheapest_in_stock: the cheapest Copper product that has a color on the
 * shelf today. A color doesn't change the price (price is per product), so
 * "cheapest color in stock" means the cheapest product with stock, and which of
 * its colors can be bought now. Stock is read fresh each time.
 */
export async function findCheapestInStock(
  input: CheapestInStockInput,
): Promise<CheapestInStock> {
  const rows = await readInventory();
  if (rows === null) {
    return {
      status: "unavailable",
      message:
        "Stock can't be checked right now. Please try again in a little while.",
    };
  }

  const candidates = getProducts()
    .filter(
      (product) => input.product === undefined || product.id === input.product,
    )
    .map((product) => ({
      product,
      // Back-ordered colors can't be bought today, so they are left out.
      colors: product.colors.flatMap((color) => {
        const row = rows.find(
          (candidate) =>
            candidate.product === product.name &&
            candidate.color.toLowerCase() === color.toLowerCase(),
        );
        const stock = row ? stockLevel(row.units_in_stock) : "backordered";
        return stock === "backordered" ? [] : [{ color, stock }];
      }),
    }))
    .filter((candidate) => candidate.colors.length > 0);

  if (candidates.length === 0) return { status: "none_in_stock" };

  const priceUsd = Math.min(
    ...candidates.map((candidate) => candidate.product.priceUsd),
  );
  return {
    status: "ok",
    priceUsd,
    options: candidates
      .filter((candidate) => candidate.product.priceUsd === priceUsd)
      .map((candidate) => ({
        product: candidate.product.name,
        colors: candidate.colors,
      })),
  };
}

const get_products = tool({
  description:
    "List every Copper product with its price and the colors it comes in; says nothing about stock.",
  inputSchema: z.object({}),
  execute: async () => listProducts(),
});

const get_prices = tool({
  description:
    "Get the current price of every Copper product and the monthly and yearly price of every plan.",
  inputSchema: z.object({}),
  execute: async () => getPrices(),
});

const calculate_cost = tool({
  description:
    "Work out the total cost of up to five Copper devices plus the Free or Copper Plus plan, billed monthly or annually, for 1 to 5 years.",
  inputSchema: calculateCostInput,
  execute: async (input) => calculateCost(input),
});

const check_availability = tool({
  description:
    "Check whether a Copper product, or one of its colors, is in stock today, low on stock or back-ordered.",
  inputSchema: checkAvailabilityInput,
  execute: async (input) => checkAvailability(input),
});

const find_cheapest_in_stock = tool({
  description:
    "Find the cheapest Copper product that has at least one color in stock today, and which colors can be bought now. Optionally limit it to one product. Every color of a product costs the same.",
  inputSchema: cheapestInStockInput,
  execute: async (input) => findCheapestInStock(input),
});

export const copperTools = {
  get_products,
  get_prices,
  calculate_cost,
  check_availability,
  find_cheapest_in_stock,
};
