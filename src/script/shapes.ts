/**
 * General-purpose drawings for concise scripts — the declarative counterpart
 * of Pine's `line.new`, `box.new`, `label.new`, `table.new`, `bgcolor` and
 * `barcolor`. Coordinates are bar indices (a future bar index is allowed, as
 * with `bar_index + 20` in Pine) and prices.
 *
 * A shape drawn without an `id` stays on the chart, like a Pine drawing that
 * is never deleted. A shape with an `id` replaces any earlier shape with that
 * id — Pine's `var line l = na; line.delete(l); l := line.new(...)` idiom —
 * and `remove(id)` deletes it. Like every concise drawing, shapes are recorded
 * per bar, so recalculating the open bar never duplicates them.
 */

export type ShapeLineStyle = "solid" | "dashed" | "dotted";
export type LabelPosition = "above" | "below" | "left" | "right" | "center";
export type LabelSize = "tiny" | "small" | "normal" | "large" | "huge" | "auto";

interface Identified {
  /** Latest-wins key; omit for a drawing that is never replaced. */
  readonly id?: string;
}

export interface LineShape {
  readonly kind: "line";
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly color?: string;
  readonly width?: number;
  readonly style?: ShapeLineStyle;
}

export interface BoxShape {
  readonly kind: "box";
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly fill?: string;
  readonly border?: string;
}

export interface LabelShape {
  readonly kind: "label";
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly color?: string;
  /** Where the text sits relative to (x, y). Default "center". */
  readonly position?: LabelPosition;
  /** Filled callout behind the text (Pine's label_up/label_down styles). */
  readonly background?: string;
  /** Label size option (e.g. size.tiny). Default "normal". */
  readonly size?: LabelSize;
}

export type ScriptShape = LineShape | BoxShape | LabelShape;

export interface TableCell {
  readonly text: string;
  readonly bg?: string;
  readonly color?: string;
}

export type TablePosition = "top_right" | "top_left" | "bottom_right" | "bottom_left";

export interface ScriptTable {
  readonly position: TablePosition;
  readonly rows: readonly (readonly TableCell[])[];
}

export interface BarColor {
  readonly bar: number;
  readonly color: string;
}

type ShapeInput<S extends ScriptShape> = Omit<S, "kind"> & Identified;

/** The general drawing calls a concise script gets on `draw`. */
export interface ShapeDraw {
  line(line: ShapeInput<LineShape>): void;
  box(box: ShapeInput<BoxShape>): void;
  label(label: ShapeInput<LabelShape>): void;
  /** Deletes the shape drawn with this id, if any. */
  remove(id: string): void;
  /** The single dashboard table; the latest call wins. */
  table(table: ScriptTable): void;
  /** Background colour of the current bar (Pine `bgcolor`). */
  bgcolor(color: string): void;
  /** Candle colour of the current bar (Pine `barcolor`). */
  barcolor(color: string): void;
}

export type RecordedShape =
  | { readonly kind: "shape"; readonly id: string | undefined; readonly shape: ScriptShape }
  | { readonly kind: "remove"; readonly id: string }
  | { readonly kind: "table"; readonly table: ScriptTable }
  | { readonly kind: "bgcolor" | "barcolor"; readonly bar: number; readonly color: string };

export const createShapeDraw = (
  record: (drawing: RecordedShape) => void,
  barIndex: () => number,
): ShapeDraw => {
  const shape = <S extends ScriptShape>(kind: S["kind"], { id, ...rest }: ShapeInput<S>): void =>
    record({ kind: "shape", id, shape: { kind, ...rest } as S });
  return {
    line: (line) => shape<LineShape>("line", line),
    box: (box) => shape<BoxShape>("box", box),
    label: (label) => shape<LabelShape>("label", label),
    remove: (id) => record({ kind: "remove", id }),
    table: (table) => record({ kind: "table", table }),
    bgcolor: (color) => record({ kind: "bgcolor", bar: barIndex(), color }),
    barcolor: (color) => record({ kind: "barcolor", bar: barIndex(), color }),
  };
};

export interface CollectedShapes {
  readonly shapes: readonly ScriptShape[];
  readonly table: ScriptTable | undefined;
  readonly bgcolors: readonly BarColor[];
  readonly barcolors: readonly BarColor[];
}

/** Applies shape records in bar order: one-off shapes accumulate, ids keep their latest shape. */
export const collectShapes = (records: readonly RecordedShape[]): CollectedShapes => {
  const anonymous: ScriptShape[] = [];
  const identified = new Map<string, ScriptShape>();
  const bgcolors: BarColor[] = [];
  const barcolors: BarColor[] = [];
  let table: ScriptTable | undefined;
  for (const record of records) {
    switch (record.kind) {
      case "shape":
        if (record.id === undefined) anonymous.push(record.shape);
        else identified.set(record.id, record.shape);
        break;
      case "remove":
        identified.delete(record.id);
        break;
      case "table":
        table = record.table;
        break;
      case "bgcolor":
        bgcolors.push({ bar: record.bar, color: record.color });
        break;
      case "barcolor":
        barcolors.push({ bar: record.bar, color: record.color });
        break;
    }
  }
  return { shapes: [...anonymous, ...identified.values()], table, bgcolors, barcolors };
};
