import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type Manifest = {
  namespace: string;
  version: number;
  functions: string[];
  implemented: string[];
};

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "api-manifest/ta.v6.json");
const outputPath = resolve(root, "src/ta/generated.ts");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;

const names = [...new Set(manifest.functions)].sort();
const implemented = new Set(manifest.implemented);
const lines = [
  "/** GENERATED FILE. Run `pnpm ta:inventory` after changing api-manifest/ta.v6.json. */",
  `export type TaFunctionName = ${names.map(name => JSON.stringify(name)).join(" | ")};`,
  `export type ImplementedTaFunctionName = ${[...implemented].sort().map(name => JSON.stringify(name)).join(" | ")};`,
  `export const taV6FunctionNames = ${JSON.stringify(names, null, 2)} as const;`,
  "",
];
await writeFile(outputPath, lines.join("\n"), "utf8");
console.log(`Generated ${names.length} ta.v6 inventory symbols.`);
