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

/** The manifests that make up the v6 API catalog, in generation order. */
const MANIFESTS: ReadonlyArray<{
  readonly file: string;
  readonly output: string;
  readonly prefix: string;
}> = [
  { file: "ta.yaml", output: "src/ta/generated.ts", prefix: "Ta" },
  { file: "math.yaml", output: "src/math/generated.ts", prefix: "Math" },
  { file: "str.yaml", output: "src/str/generated.ts", prefix: "Str" },
];

const root = resolve(import.meta.dirname, "..");

const pascalCase = (namespace: string): string =>
  namespace.length === 0 ? "" : namespace[0]!.toUpperCase() + namespace.slice(1);

let totalSymbols = 0;
let totalVerified = 0;

for (const manifest of MANIFESTS) {
  const manifestPath = resolve(root, "api-manifest", manifest.file);
  const outputPath = resolve(root, manifest.output);
  const parsed = YAML.parse(await readFile(manifestPath, "utf8")) as Manifest;
  const functions = [
    ...new Map(parsed.functions.map((entry) => [entry.name, entry])).values(),
  ].sort((left, right) => left.name.localeCompare(right.name));
  const implemented = functions
    .filter((entry) => entry.impl !== undefined)
    .map((entry) => entry.name);
  const verified = functions
    .filter((entry) => entry.status === "verified")
    .map((entry) => entry.name);

  totalSymbols += functions.length;
  totalVerified += verified.length;

  if (process.argv.includes("--coverage")) {
    const coverage = functions.length === 0 ? 100 : (verified.length / functions.length) * 100;
    console.log(
      `${parsed.namespace} manifest verified coverage: ${coverage.toFixed(1)}% (${verified.length}/${functions.length})`,
    );
    continue;
  }

  const namespace = pascalCase(parsed.namespace);
  const unionOf = (names: readonly string[]): string =>
    names.length === 0 ? "never" : names.map((name) => JSON.stringify(name)).join(" | ");
  const lines = [
    `/** GENERATED FILE. Run \`pnpm manifest:generate\` after changing api-manifest/${manifest.file}. */`,
    `export type ${manifest.prefix}FunctionName = ${unionOf(functions.map((entry) => entry.name))};`,
    `export type Implemented${manifest.prefix}FunctionName = ${unionOf(implemented)};`,
    `export type Verified${manifest.prefix}FunctionName = ${unionOf(verified)};`,
    `export const ${parsed.namespace}V6FunctionNames = ${JSON.stringify(
      functions.map((entry) => entry.name),
      null,
      2,
    )} as const;`,
    "",
  ];

  await writeFile(outputPath, lines.join("\n"), "utf8");
  console.log(
    `Generated ${functions.length} ${parsed.namespace}.v6 inventory symbols (${namespace}).`,
  );
}

if (process.argv.includes("--coverage")) {
  console.log(
    `Total verified coverage: ${totalVerified}/${totalSymbols} (${((totalVerified / totalSymbols) * 100).toFixed(1)}%)`,
  );
}
