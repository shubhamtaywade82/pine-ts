/**
 * The default indicator registry. Indicators register themselves at module
 * load time; the registry exposes `list` / `get` / `instantiate` / `metadata`
 * for a chart workbench UI to consume.
 *
 * The registry is module-global (a single shared instance per process).
 * Tests can call {@link resetIndicatorRegistry} between tests to start with
 * a clean slate, then re-import the built-in indicators module.
 */

import type { Bar, MarketDataProvider, SymbolInfo } from "../core/types.js";
import { PineRuntime } from "../core/runtime.js";
import { createDraw, collectDrawings, type RecordedDrawing } from "../script/draw.js";
import {
  resolveDefaults,
  type Indicator,
  type IndicatorInstance,
  type IndicatorMetadata,
  type IndicatorRegistry,
  type InputsBag,
  type IndicatorResult,
} from "./types.js";

class IndicatorRegistryImpl implements IndicatorRegistry {
  private readonly indicators = new Map<string, Indicator>();

  public register(indicator: Indicator): void {
    const id = indicator.metadata.id;
    const existing = this.indicators.get(id);
    if (existing !== undefined && existing !== indicator) {
      throw new Error(
        `Indicator id ${JSON.stringify(id)} is already registered by a different module. ` +
          `Use a unique id or unregister the existing one first.`,
      );
    }
    this.indicators.set(id, indicator);
  }

  public list(): readonly IndicatorMetadata[] {
    return [...this.indicators.values()].map((i) => i.metadata);
  }

  public get(id: string): Indicator | undefined {
    return this.indicators.get(id);
  }

  public metadata(id: string): IndicatorMetadata | undefined {
    return this.indicators.get(id)?.metadata;
  }

  public instantiate(id: string, inputs: InputsBag = {}): IndicatorInstance | undefined {
    const indicator = this.indicators.get(id);
    if (indicator === undefined) return undefined;
    const resolved = resolveDefaults(indicator.metadata.inputs, inputs);
    const instance: IndicatorInstance = {
      indicator,
      inputs: resolved,
      drawings: undefined,
      run: async function* (bars: readonly Bar[]): AsyncGenerator<IndicatorResult> {
        const provider = new StubIndicatorProvider(bars);
        const runtime = new PineRuntime({
          provider,
          symbol: "INDICATOR",
          timeframe: "1",
        });
        const out: IndicatorResult[] = [];
        const records: RecordedDrawing[] = [];
        let currentBar = 0;
        const draw = createDraw(
          (d) => records.push(d),
          () => currentBar,
        );
        await runtime.run((ctx) => {
          currentBar = ctx.bar_index.at(0) ?? currentBar;
          const result = indicator.calculate({ ctx, inputs: resolved, draw });
          out.push(result);
          currentBar++;
        }, bars);
        instance.drawings = collectDrawings(records);
        for (const r of out) yield r;
      },
    };
    return instance;
  }
}

/**
 * Stub provider for indicator-only runs (no symbol info, no streaming).
 * Returns the supplied bars as the historical series; symbol info is a
 * bare-minimum `SymbolInfo` sufficient for the runtime to start.
 */
export class StubIndicatorProvider implements MarketDataProvider {
  public constructor(private readonly bars: readonly Bar[]) {}

  public getHistoricalBars = async (): Promise<readonly Bar[]> => Promise.resolve(this.bars);

  public streamBars = (): AsyncIterable<Bar> => ({
    [Symbol.asyncIterator]: async function* () {
      await Promise.resolve();
      yield* [];
    },
  });

  public getSymbolInfo = async (): Promise<SymbolInfo> =>
    Promise.resolve({
      ticker: "INDICATOR",
      tickerId: "INDICATOR:INDICATOR",
      timezone: "UTC",
      type: "crypto",
    });
}

let activeRegistry: IndicatorRegistryImpl = new IndicatorRegistryImpl();

/**
 * Returns the active indicator registry. Indicators registered via
 * {@link registerIndicator} appear here.
 */
export const getIndicatorRegistry = (): IndicatorRegistry => activeRegistry;

/**
 * Registers an indicator with the active registry. Idempotent — registering
 * the same indicator object twice is a no-op; registering a different
 * indicator object under an existing id throws.
 */
export const registerIndicator = (indicator: Indicator): void => {
  activeRegistry.register(indicator);
};

/**
 * Resets the active registry to a fresh empty one. Useful for tests that
 * want a clean slate; production code should not call this.
 */
export const resetIndicatorRegistry = (): void => {
  activeRegistry = new IndicatorRegistryImpl();
};

/**
 * A proxy `IndicatorRegistry` whose methods forward to the active registry.
 * Lets consumers write `registry.list()` / `registry.get(id)` / etc. without
 * the extra `getIndicatorRegistry()` call. Re-exported as the `registry`
 * namespace in `src/index.ts`.
 *
 * Note: the proxy reads `activeRegistry` on every call, so resetting the
 * registry via {@link resetIndicatorRegistry} is reflected immediately.
 */
export const registry: IndicatorRegistry = {
  register: (indicator: Indicator) => activeRegistry.register(indicator),
  list: () => activeRegistry.list(),
  get: (id: string) => activeRegistry.get(id),
  metadata: (id: string) => activeRegistry.metadata(id),
  instantiate: (id: string, inputs?: InputsBag) => activeRegistry.instantiate(id, inputs),
};
