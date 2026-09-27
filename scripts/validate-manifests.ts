import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import YAML from "yaml";

interface ManifestFunction {
  readonly name: string;
  readonly status: "verified" | "draft" | "planned" | "unsupported";
  readonly impl?: { readonly module: string; readonly export: string };
  readonly vectors?: readonly string[];
}

interface Manifest {
  readonly namespace: string;
  readonly pineVersion: number;
  readonly functions: readonly ManifestFunction[];
}

/** Every manifest that must validate before the catalog ships. */
const MANIFESTS = ["ta.yaml", "math.yaml", "str.yaml"] as const;

const root = resolve(import.meta.dirname, "..");
const schemaPath = resolve(root, "api-manifest/schema.json");
const schema = JSON.parse(await readFile(schemaPath, "utf8")) as object;
const validator = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

for (const file of MANIFESTS) {
  const manifest = YAML.parse(
    await readFile(resolve(root, "api-manifest", file), "utf8"),
  ) as Manifest;

  if (!validator(manifest)) {
    console.error(`${file}:`);
    console.error(JSON.stringify(validator.errors, null, 2));
    process.exit(1);
  }

  const names = new Set<string>();
  for (const entry of manifest.functions) {
    if (names.has(entry.name)) throw new Error(`Duplicate manifest entry: ${entry.name}`);
    names.add(entry.name);

    if (entry.status === "verified" && entry.impl === undefined) {
      throw new Error(
        `Verified function has no implementation contract: ${manifest.namespace}.${entry.name}`,
      );
    }
    if (entry.status === "verified" && (entry.vectors?.length ?? 0) === 0) {
      throw new Error(
        `Verified function has no compatibility vectors: ${manifest.namespace}.${entry.name}`,
      );
    }
    if (entry.status === "draft" && entry.impl === undefined) {
      throw new Error(
        `Draft function has no implementation contract: ${manifest.namespace}.${entry.name}`,
      );
    }
    if (entry.status === "draft" && (entry.vectors?.length ?? 0) === 0) {
      throw new Error(
        `Draft function has no compatibility vectors: ${manifest.namespace}.${entry.name}`,
      );
    }

    if (entry.impl !== undefined) {
      const implementationPath = resolve(root, entry.impl.module);
      const implementation = await readFile(implementationPath, "utf8");
      const exported = new RegExp(
        `export\\s+(?:const|function|class)\\s+${entry.impl.export}\\b`,
      ).test(implementation);
      if (!exported) {
        throw new Error(
          `Manifest implementation mismatch: ${manifest.namespace}.${entry.name} expects ${entry.impl.export} from ${entry.impl.module}`,
        );
      }
    }

    for (const vector of entry.vectors ?? []) {
      try {
        await readFile(resolve(root, vector), "utf8");
      } catch {
        throw new Error(
          `Missing compatibility vector for ${manifest.namespace}.${entry.name}: ${vector}`,
        );
      }
    }
  }

  console.log(
    `Manifest valid: ${manifest.namespace}.v${manifest.pineVersion} (${manifest.functions.length} functions).`,
  );
}
