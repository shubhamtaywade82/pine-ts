# API manifest

This directory is the machine-readable catalog of the public Pine v6 surface implemented by `pine-ts`.

The manifest will become the single source for:

1. namespace/function coverage;
2. TypeScript signature generation;
3. compatibility test generation;
4. documentation tables;
5. implementation tracking.

Initial target namespaces include `ta`, `math`, `array`, `matrix`, `map`, `str`, `color`, `input`, `request`, `strategy`, and visual/object APIs.

The catalog is intentionally incomplete at bootstrap. No API is marked implemented solely because its name appears in the manifest.
