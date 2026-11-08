"use client";

// The parts of one Ask Copper answer, drawn as stations on a rail: the tools
// Copper can use, its thinking, each tool call, and what's happening now.
import { BrainIcon, ListIcon, Loader2Icon, WrenchIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  type Progress,
  type ToolStep,
  TOOL_LABELS,
} from "@/lib/copper/assistant/progress";
import { cn } from "@/lib/utils";

const money = (amount: number) => `$${amount.toFixed(2)}`;

const PRODUCT_NAMES: Record<string, string> = {
  "copper-home": "Copper Home",
  "copper-notes": "Copper Notes",
};
const PLAN_NAMES: Record<string, string> = {
  free: "Free",
  "copper-plus": "Copper Plus",
};

const productName = (id: unknown) => PRODUCT_NAMES[String(id)] ?? String(id);

/** "2026-11-14" becomes "Nov 14, 2026". */
function niceDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Turns **bold** and `code` in a thought summary into real formatting. */
function Markdown({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**"))
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        if (part.startsWith("`") && part.endsWith("`"))
          return (
            <code key={index} className="font-mono">
              {part.slice(1, -1)}
            </code>
          );
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

/** One station on the rail: a round node with an icon, a label and contents. */
export function Station({
  icon,
  label,
  nodeClassName,
  children,
}: {
  icon: ReactNode;
  label?: string;
  nodeClassName: string;
  children?: ReactNode;
}) {
  return (
    <div className="relative pb-5 pl-9">
      <span
        className={cn(
          "ring-secondary absolute top-0 left-0 flex size-6 items-center justify-center rounded-full text-white ring-4",
          nodeClassName,
        )}
      >
        {icon}
      </span>
      {label && (
        <p className="text-muted-foreground mb-1.5 pt-1 text-[11px] font-semibold tracking-widest uppercase">
          {label}
        </p>
      )}
      {children}
    </div>
  );
}

/** Station 1: the menu of tools the model was handed. */
export function ToolsStation({
  tools,
  used,
}: {
  tools: boolean;
  used: Set<string>;
}) {
  const names = Object.keys(TOOL_LABELS);
  return (
    <Station
      icon={<ListIcon className="size-3.5" />}
      label={tools ? "Tools Copper can use" : "Tools given to Copper: none"}
      nodeClassName={tools ? "bg-primary" : "bg-chart-3"}
    >
      <div className="flex flex-wrap gap-1.5">
        {names.map((name) => (
          <span
            key={name}
            className={cn(
              "rounded-md px-2 py-0.5 font-mono text-xs",
              !tools && "text-muted-foreground line-through",
              tools && used.has(name) && "bg-accent font-bold text-white",
              tools && !used.has(name) && "bg-muted text-muted-foreground",
              !tools && "bg-muted",
            )}
          >
            {name}
          </span>
        ))}
      </div>
      {!tools && (
        <p className="text-muted-foreground mt-1.5 text-sm">
          Copper has to answer from memory alone.
        </p>
      )}
    </Station>
  );
}

/** Station 2: Copper's own short account of what it's doing. */
export function ThinkingStation({
  text,
  tools,
}: {
  text: string;
  tools: boolean;
}) {
  return (
    <Station
      icon={<BrainIcon className="size-3.5" />}
      label="Copper is thinking"
      nodeClassName={tools ? "bg-primary" : "bg-chart-3"}
    >
      <p
        data-testid="thinking"
        className="text-muted-foreground border-l-2 pl-3 text-sm italic"
      >
        <Markdown text={text} />
      </p>
    </Station>
  );
}

/** What went into a tool, as a labelled list (never raw JSON). */
function SentList({ step }: { step: ToolStep }) {
  const input = (step.input ?? null) as Record<string, unknown> | null;
  if (step.name === "get_prices")
    return <p>Nothing, it just asked for the price list.</p>;
  if (step.name === "get_products")
    return <p>Nothing, it just asked what Copper sells.</p>;
  if (!input) return <p className="italic">filling in the details…</p>;

  const rows: [string, string][] = [];
  if (step.name === "calculate_cost") {
    const products = (input.products as unknown[]) ?? [];
    rows.push(
      [
        "Products",
        products.length ? products.map(productName).join(", ") : "None",
      ],
      ["Plan", PLAN_NAMES[String(input.plan)] ?? String(input.plan)],
      ["Billing", String(input.billing)],
      ["Years", String(input.years)],
    );
  } else if (step.name === "check_availability") {
    rows.push(["Product", productName(input.product)]);
    if (input.color) rows.push(["Color", String(input.color)]);
  } else if (step.name === "find_cheapest_in_stock") {
    rows.push([
      "Product",
      input.product ? productName(input.product) : "Any product",
    ]);
  } else {
    for (const [key, value] of Object.entries(input))
      rows.push([key, String(value)]);
  }
  return (
    <dl className="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-0.5">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Pill({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <Badge className={cn("rounded-full border-0 text-xs", className)}>
      {children}
    </Badge>
  );
}

/** What a tool sent back, in plain language for each tool. */
function CameBack({ step }: { step: ToolStep }) {
  const output = step.output as Record<string, unknown> | string | undefined;
  if (step.state === "error")
    return (
      <p className="text-chart-3">
        {String(output ?? "Something went wrong.")}
      </p>
    );
  if (!output || typeof output === "string")
    return <p>{String(output ?? "")}</p>;

  if (step.name === "calculate_cost") {
    const lines = (output.lines as { item: string; usd: number }[]) ?? [];
    return (
      <div>
        {lines.map((line) => (
          <div key={line.item} className="flex justify-between gap-3">
            <span>{line.item}</span>
            <span>{money(line.usd)}</span>
          </div>
        ))}
        <div className="mt-1 flex items-baseline justify-between gap-3 border-t pt-1">
          <span className="font-semibold">Total</span>
          <span className="text-primary text-lg font-bold">
            {money(Number(output.totalUsd))}
          </span>
        </div>
      </div>
    );
  }

  if (step.name === "get_products") {
    const products =
      (output.products as {
        name: string;
        type: string;
        priceUsd: number;
        colors: string[];
      }[]) ?? [];
    return (
      <div className="flex flex-col gap-2">
        {products.map((product) => (
          <div key={product.name}>
            <div className="flex justify-between gap-3 font-medium">
              <span>{product.name}</span>
              <span>{money(product.priceUsd)}</span>
            </div>
            <p className="text-muted-foreground text-xs">{product.type}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {product.colors.map((color) => (
                <Pill key={color} className="bg-accent text-white">
                  {color}
                </Pill>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (step.name === "get_prices") {
    const products =
      (output.products as { name: string; priceUsd: number }[]) ?? [];
    const plans =
      (output.plans as {
        name: string;
        monthlyUsd: number;
        annualUsd: number;
      }[]) ?? [];
    return (
      <div>
        {products.map((product) => (
          <div key={product.name} className="flex justify-between gap-3">
            <span>{product.name}</span>
            <span>{money(product.priceUsd)}</span>
          </div>
        ))}
        {plans
          .filter((plan) => plan.monthlyUsd > 0)
          .map((plan) => (
            <div key={plan.name} className="flex justify-between gap-3">
              <span>{plan.name}</span>
              <span>{`$${plan.monthlyUsd}/mo · $${plan.annualUsd}/yr`}</span>
            </div>
          ))}
      </div>
    );
  }

  if (step.name === "check_availability") {
    if (output.status === "unavailable") return <p>{String(output.message)}</p>;
    if (output.status === "not_a_color") {
      const colors = (output.colors as string[]) ?? [];
      return (
        <p>
          {String(output.product)} doesn&apos;t come in {String(output.color)}.
          It comes in {colors.join(", ")}.
        </p>
      );
    }
    const colors =
      (output.colors as {
        color: string;
        stock: string;
        restockDate: string | null;
      }[]) ?? [];
    return (
      <div className="flex flex-col gap-1">
        {colors.map((row) => (
          <div
            key={row.color}
            className="flex items-center justify-between gap-3"
          >
            <span>{row.color}</span>
            {row.stock === "in_stock" && (
              <Pill className="bg-accent text-white">In stock</Pill>
            )}
            {row.stock === "low_stock" && (
              <Pill className="bg-chart-4 text-chart-5">Low stock</Pill>
            )}
            {row.stock === "backordered" && (
              <Pill className="bg-chart-3 text-white">
                Back-ordered
                {row.restockDate ? ` until ${niceDate(row.restockDate)}` : ""}
              </Pill>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (step.name === "find_cheapest_in_stock") {
    if (output.status === "none_in_stock") return <p>Nothing is in stock.</p>;
    if (output.status === "unavailable") return <p>{String(output.message)}</p>;
    const options =
      (output.options as {
        product: string;
        colors: { color: string; stock: string }[];
      }[]) ?? [];
    return (
      <div className="flex flex-col gap-2">
        {options.map((option) => (
          <div key={option.product}>
            <div className="flex justify-between gap-3 font-medium">
              <span>{option.product}</span>
              <span>{money(Number(output.priceUsd))}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {option.colors.map((row) => (
                <Pill
                  key={row.color}
                  className={
                    row.stock === "low_stock"
                      ? "bg-chart-4 text-chart-5"
                      : "bg-accent text-white"
                  }
                >
                  {row.color}
                  {row.stock === "low_stock" ? " (low stock)" : ""}
                </Pill>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return <p>{JSON.stringify(output)}</p>;
}

/** Station 3: one tool call, always open, as a round trip. */
export function ToolStation({
  step,
  number,
}: {
  step: ToolStep;
  number: number;
}) {
  const running = step.state === "calling";
  return (
    <Station
      icon={<WrenchIcon className="size-3.5" />}
      label={running ? "Copper is calling a tool" : "Copper called a tool"}
      nodeClassName="bg-accent"
    >
      <div
        data-testid="tool-call"
        data-tool={step.name}
        className="bg-card overflow-hidden rounded-lg border text-sm"
      >
        <div className="bg-accent flex items-center gap-2 px-3 py-1.5 text-white">
          <span className="font-mono font-bold">{step.name}()</span>
          <span className="rounded bg-white/20 px-1.5 text-xs">
            tool {number}
          </span>
          <span className="ml-auto text-xs">
            {TOOL_LABELS[step.name] ?? step.name}
          </span>
        </div>
        <div className="p-3">
          <p className="text-muted-foreground mb-1 text-[11px] font-semibold tracking-widest uppercase">
            → What Copper sent
          </p>
          <SentList step={step} />
        </div>
        <div className="bg-accent/10 border-t p-3">
          <p className="text-muted-foreground mb-1 text-[11px] font-semibold tracking-widest uppercase">
            ← What came back
          </p>
          {running ? (
            <p className="flex items-center gap-2 italic">
              <Loader2Icon className="size-3.5 animate-spin" />
              the app is running the code…
            </p>
          ) : (
            <CameBack step={step} />
          )}
        </div>
      </div>
    </Station>
  );
}

/** Station 4: what's happening right now, while Copper is working. */
export function WorkingStation({
  progress,
  tools,
}: {
  progress: Progress;
  tools: boolean;
}) {
  const text = progress.reply
    ? "Writing the answer…"
    : !tools
      ? "Answering from memory…"
      : progress.steps.length
        ? "Deciding what to do next…"
        : "Reading your question…";
  return (
    <Station
      icon={
        <span className="flex gap-0.5">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="size-1 animate-bounce rounded-full bg-white"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
      }
      nodeClassName={cn("animate-pulse", tools ? "bg-primary" : "bg-chart-3")}
    >
      <p className="text-muted-foreground pt-0.5 text-sm">{text}</p>
    </Station>
  );
}
