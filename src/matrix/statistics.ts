import { PineArray } from "../array/pine-array.js";
import * as arrayStats from "../array/statistics.js";
import type { PineMatrix } from "./pine-matrix.js";

/** Calculates the average of all elements in the matrix. */
export const avg = (id: PineMatrix<number>): number =>
  arrayStats.avg(new PineArray<number>(id.flat()));

/** Returns the minimum element in the matrix. */
export const min = (id: PineMatrix<number>): number =>
  arrayStats.min(new PineArray<number>(id.flat()));

/** Returns the maximum element in the matrix. */
export const max = (id: PineMatrix<number>): number =>
  arrayStats.max(new PineArray<number>(id.flat()));

/** Calculates the sum of all elements in the matrix. */
export const sum = (id: PineMatrix<number>): number =>
  arrayStats.sum(new PineArray<number>(id.flat()));

/** Calculates the median of all elements in the matrix. */
export const median = (id: PineMatrix<number>): number =>
  arrayStats.median(new PineArray<number>(id.flat()));

/** Returns the most frequent element in the matrix. */
export const mode = (id: PineMatrix<number>): number =>
  arrayStats.mode(new PineArray<number>(id.flat()));
