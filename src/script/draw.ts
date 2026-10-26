/**
 * Declarative drawings for SMC results in the concise authoring layer.
 *
 * Unlike `visual.line.new` & co., which emit create/update events into a
 * global sink, these helpers record what each bar shows, keyed by bar index
 * like `plot()` values. A realtime tick re-executing the open bar replaces
 * that bar's record, so a recalculated bar never duplicates a drawing.
 */

import type { OrderBlockResult, OrderBlockZone } from "../smc/order-blocks.js";
import type { StructureResult } from "../smc/structure.js";

export type DrawDirection = "bullish" | "bearish";

/** A structure break: a level from the broken swing's pivot bar to the breaking bar. */
export interface ScriptLine {
  readonly fromBar: number;
  readonly toBar: number;
  readonly price: number;
  readonly text: "BOS" | "CHoCH";
  readonly direction: DrawDirection;
}

/** An order-block zone, from its candle to the last bar it was valid on. */
export interface ScriptBox {
  readonly fromBar: number;
  readonly toBar: number;
  readonly top: number;
  readonly bottom: number;
  readonly direction: DrawDirection;
}

export interface ScriptDrawings {
  readonly lines: readonly ScriptLine[];
  readonly boxes: readonly ScriptBox[];
}

/** One valid bar of a zone; consecutive samples of the same zone collapse into one box. */
interface ZoneSample {
  readonly kind: "zone";
  readonly bar: number;
  readonly zone: Omit<ScriptBox, "toBar">;
}

export type RecordedDrawing = ({ readonly kind: "line" } & ScriptLine) | ZoneSample;

export interface StructureDrawOptions {
  readonly showBOS?: boolean;
  readonly showCHoCH?: boolean;
}

export interface ScriptDraw {
  /** BOS/CHoCH lines with their label text, drawn on the bar the break happens. */
  structure(structure: StructureResult, options?: StructureDrawOptions): void;
  /** Order-block boxes, extended while the zone stays valid. */
  orderBlocks(blocks: OrderBlockResult): void;
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

  const zone = (side: OrderBlockZone, direction: DrawDirection): void => {
    if (side.valid.value !== true) return;
    const { top, bottom, bar: fromBar } = side;
    record({
      kind: "zone",
      bar: barIndex(),
      zone: { fromBar: fromBar.value, top: top.value, bottom: bottom.value, direction },
    });
  };

  return {
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
    orderBlocks: (blocks) => {
      zone(blocks.bullish, "bullish");
      zone(blocks.bearish, "bearish");
    },
  };
};

/** Collapses per-bar records (in bar order) into lines and boxes. */
export const collectDrawings = (records: readonly RecordedDrawing[]): ScriptDrawings => {
  const lines: ScriptLine[] = [];
  const boxes = new Map<string, ScriptBox>();
  for (const drawing of records) {
    if (drawing.kind === "line") {
      const { fromBar, toBar, price, text, direction } = drawing;
      lines.push({ fromBar, toBar, price, text, direction });
      continue;
    }
    const { zone, bar } = drawing;
    const key = `${zone.direction}:${zone.fromBar}:${zone.top}:${zone.bottom}`;
    boxes.set(key, { ...zone, toBar: bar });
  }
  return { lines, boxes: [...boxes.values()] };
};
