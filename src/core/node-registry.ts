import type { Series } from "./series.js";

const stableArgument = (arg: unknown): string => (isSeries(arg) ? `#${arg.id}` : stableValue(arg));

export const nodeKey = (name: string, ...args: readonly unknown[]): string =>
  `${name}(${args.map(stableArgument).join(",")})`;

export class NodeRegistry {
  private readonly series = new Map<string, Series<unknown>>();

  public getOrCreate<T>(key: string, create: () => Series<T>): Series<T> {
    const existing = this.series.get(key);
    if (existing !== undefined) {
      return existing as Series<T>;
    }

    const created = create();
    this.series.set(key, created);
    return created;
  }

  public get size(): number {
    return this.series.size;
  }

  public nodes(): readonly Series<unknown>[] {
    return [...this.series.values()];
  }
}

const isSeries = (value: unknown): value is Series<unknown> =>
  typeof value === "object" && value !== null && "id" in value && "at" in value;

const stableValue = (value: unknown): string => {
  if (value === null) return "null";
  if (typeof value === "undefined") return "undefined";
  if (typeof value === "number" && Number.isNaN(value)) return "NaN";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (typeof value === "function") return `function:${value.name || "anonymous"}`;
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  return JSON.stringify(value);
};
