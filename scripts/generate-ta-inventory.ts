import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";

interface ManifestFunction {
  readonly name: string;
  readonly status: "verified" | "draft" | "planned" | "unsupported";
  readonly impl?: { readonly module: string; readonly export: string };
}

interface Manifest {
  readonly namespace: string;
  readonly pineVersion: number;
  readonly functions: readonly ManifestFunction[];
}

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "api-manifest/ta.yaml");
const outputPath = resolve(root, "src/ta/generated.ts");
const manifest = YAML.parse(await readFile(manifestPath, "utf8")) as Manifest;
const functions = [...new Map(manifest.functions.map((entry) => [entry.name, entry])).values()].sort(
  (left, right) => left.name.localeCompare(right.name),
);
const implemented = functions.filter((entry) => entry.impl !== undefined).map((entry) => entry.name);
const verified = functions.filter((entry) => entry.status === "verified").map((entry) => entry.name);

if (process.argv.includes("--coverage")) {
  const coverage = functions.length === 0 ? 100 : (verified.length / functions.length) * 100;
  console.log(`ta manifest verified coverage: ${coverage.toFixed(1)}% (${verified.length}/${functions.length})`);
  process.exit(0);
}

const lines = [
  "/** GENERATED FILE. Run `pnpm manifest:generate` after changing api-manifest/ta.yaml. */",
  `export type TaFunctionName = ${functions.map((entry) => JSON.stringify(entry.name)).join(" | ")};`,
  `export type ImplementedTaFunctionName = ${implemented.map((entry) => JSON.stringify(entry)).join(" | ")};`,
  `export type VerifiedTaFunctionName = ${verified.map((entry) => JSON.stringify(entry)).join(" | ")};`,
  `export const taV6FunctionNames = ${JSON.stringify(functions.map((entry) => entry.name), null, 2)} as const;`,
  "",
];

await writeFile(outputPath, lines.join("\n"), "utf8");
console.log(`Generated ${functions.length} ta.v6 inventory symbols.`);
