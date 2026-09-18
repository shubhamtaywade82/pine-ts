import { defineConfig } from "tsdown";
import type { UserConfig } from "tsdown";

const config: UserConfig = defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  // The package is ESM ("type": "module"), so emit .js/.d.ts to match the
  // exports map in package.json instead of the .mjs/.d.mts defaults.
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  dts: {
    sourcemap: true,
  },
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: "es2024",
  publint: "ci-only",
  attw: "ci-only",
  failOnWarn: "ci-only",
});

export default config;
