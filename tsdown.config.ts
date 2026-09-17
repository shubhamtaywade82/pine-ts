import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
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
