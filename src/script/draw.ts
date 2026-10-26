/**
 * Declarative drawings for SMC results in the concise authoring layer.
 *
 * Unlike `visual.line.new` & co., which emit create/update events into a
 * global sink, these helpers record what each bar shows, keyed by bar index
 * like `plot()` values. A realtime tick re-executing the open bar replaces
 * that bar's record, so a recalculated bar never duplicates a drawing.
 */

import type { FairValueGapResult } from "../smc/fair-value-gaps.js";
import type { LiquidityResult } from "../smc/liquidity.js";
import type { OrderBlockResult } from "../smc/order-blocks.js";
import type { StructureResult } from "../smc/structure.js";
import {
  collectShapes,
  createShapeDraw,
  type CollectedShapes,
  type RecordedShape,
  type ShapeDraw,
} from "./shapes.js";

export type DrawDirection = "bullish" | "bearish";

/** A structure break: a level from the broken swing's pivot bar to the breaking bar. */
export interface ScriptLine {
  readonly fromBar: number;
  readonly toBar: number;
  readonly price: number;
  readonly text: string;
  readonly direction: DrawDirection;
}

/** An order-block zone, from its candle to the last bar it was valid on. */
export interface ScriptBox {
  readonly fromBar: number;
  readonly toBar: number;
  readonly top: number;
  readonly bottom: number;
  readonly direction: DrawDirection;
  readonly text?: string | undefined;
}

export interface ScriptDrawings extends CollectedShapes {
  /** BOS/CHoCH lines from `draw.structure`. */
  readonly lines: readonly ScriptLine[];
  /** Order-block and FVG zones from `draw.orderBlocks` / `draw.fvg`. */
  readonly boxes: readonly ScriptBox[];
}

/** One valid bar of a zone; consecutive samples of the same zone collapse into one box. */
interface ZoneSample {
  readonly kind: "zone";
  readonly bar: number;
  readonly zone: Omit<ScriptBox, "toBar">;
}

export type RecordedDrawing = ({ readonly kind: "line" } & ScriptLine) | ZoneSample | RecordedShape;

export interface StructureDrawOptions {
  readonly showBOS?: boolean;
  readonly showCHoCH?: boolean;
}

export interface ScriptDraw extends ShapeDraw {
  /** BOS/CHoCH lines with their label text, drawn on the bar the break happens. */
  structure(structure: StructureResult, options?: StructureDrawOptions): void;
  /** Order-block boxes, extended while the zone stays valid. */
  orderBlocks(blocks: OrderBlockResult, options?: { text?: string }): void;
  /** Fair Value Gap boxes, extended while the gap remains unmitigated and valid. */
  fvg(gaps: FairValueGapResult, options?: { text?: string }): void;
  /** Liquidity sweep levels, drawn from the swept swing to the break bar. */
  liquidity(liquidity: LiquidityResult, structure: StructureResult): void;
}

const isNa = (value: number): boolean => Number.isNaN(value);

export const createDraw = (
  record: (drawing: RecordedDrawing) => void,
  barIndex: () => number,
): ScriptDraw => {
  const breakLine = (
    structure: StructureResult,
    direction: DrawDirection,
    text: ScriptLine["text"],
  ): void => {
    const price = direction === "bullish" ? structure.swingHigh.value : structure.swingLow.value;
    const fromBar =
      direction === "bullish" ? structure.swingHighBar.value : structure.swingLowBar.value;
    if (isNa(price) || isNa(fromBar)) return;
    record({ kind: "line", fromBar, toBar: barIndex(), price, text, direction });
  };

  const zone = (
    side: {
      valid: { value: boolean };
      top: { value: number };
      bottom: { value: number };
      bar: { value: number };
    },
    direction: DrawDirection,
    text?: string,
  ): void => {
    if (side.valid.value !== true) return;
    const { top, bottom, bar: fromBar } = side;
    if (isNa(top.value) || isNa(bottom.value) || isNa(fromBar.value) || fromBar.value < 0) return;
    record({
      kind: "zone",
      bar: barIndex(),
      zone: {
        fromBar: fromBar.value,
        top: top.value,
        bottom: bottom.value,
        direction,
        ...(text !== undefined ? { text } : {}),
      },
    });
  };

  return {
    ...createShapeDraw(record, barIndex),
    structure: (structure, { showBOS = true, showCHoCH = true } = {}) => {
      if (showBOS && structure.bullishBOS.value === true) breakLine(structure, "bullish", "BOS");
      if (showBOS && structure.bearishBOS.value === true) breakLine(structure, "bearish", "BOS");
      if (showCHoCH && structure.bullishCHoCH.value === true) {
        breakLine(structure, "bullish", "CHoCH");
      }
      if (showCHoCH && structure.bearishCHoCH.value === true) {
        breakLine(structure, "bearish", "CHoCH");
      }
    },
    orderBlocks: (blocks, { text } = {}) => {
      zone(blocks.bullish, "bullish", text);
      zone(blocks.bearish, "bearish", text);
    },
    fvg: (gaps, { text } = {}) => {
      zone(gaps.bullish, "bullish", text);
      zone(gaps.bearish, "bearish", text);
    },
    liquidity: (liq, struct) => {
      if (liq.sweptHigh.value === true) {
        const fromBar = struct.swingHighBar.value;
        const price = struct.swingHigh.value;
        if (!isNa(price) && !isNa(fromBar)) {
          record({
            kind: "line",
            fromBar,
            toBar: barIndex(),
            price,
            text: "SWEEP",
            direction: "bearish",
          });
        }
      }
      if (liq.sweptLow.value === true) {
        const fromBar = struct.swingLowBar.value;
        const price = struct.swingLow.value;
        if (!isNa(price) && !isNa(fromBar)) {
          record({
            kind: "line",
            fromBar,
            toBar: barIndex(),
            price,
            text: "SWEEP",
            direction: "bullish",
          });
        }
      }
    },
  };
};

/** Collapses per-bar records (in bar order) into lines and boxes. */
export const collectDrawings = (records: readonly RecordedDrawing[]): ScriptDrawings => {
  const lines: ScriptLine[] = [];
  const boxes = new Map<string, ScriptBox>();
  const shapeRecords: RecordedShape[] = [];
  for (const drawing of records) {
    if (drawing.kind !== "line" && drawing.kind !== "zone") {
      shapeRecords.push(drawing);
      continue;
    }
    if (drawing.kind === "line") {
      const { fromBar, toBar, price, text, direction } = drawing;
      lines.push({ fromBar, toBar, price, text, direction });
      continue;
    }
    const { zone, bar } = drawing;
    const key = `${zone.direction}:${zone.fromBar}:${zone.top}:${zone.bottom}:${zone.text ?? ""}`;
    boxes.set(key, { ...zone, toBar: bar });
  }
  return { lines, boxes: [...boxes.values()], ...collectShapes(shapeRecords) };
};
