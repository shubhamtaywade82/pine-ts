import { ScopeStack } from "./scope.js";
import type { Series } from "./series.js";

const stableArgument = (arg: unknown): string => (isSeries(arg) ? `#${arg.id}` : stableValue(arg));

export const nodeKey = (name: string, ...args: readonly unknown[]): string =>
  `${name}(${args.map(stableArgument).join(",")})`;

export class NodeRegistry {
  private readonly series = new Map<string, Series<unknown>>();

  public constructor(private readonly scopes: ScopeStack = new ScopeStack()) {}

  /**
   * Resolves the node for `key` in the active call-site scope, creating it on
   * first use. Every resolution counts as the call executing on the current
   * bar: Pine commits a call's state only on bars where the call runs.
   */
  public getOrCreate<T>(key: string, create: () => Series<T>): Series<T> {
    const scopedKey = this.scopes.qualify(key);
    const existing = this.series.get(scopedKey) as Series<T> | undefined;
    const node = existing ?? create();
    if (existing === undefined) this.series.set(scopedKey, node);
    node._markExecuted();
    return node;
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
