# API manifest

This directory is the machine-readable catalog of the public Pine v6 surface implemented by `pine-ts`.

Current manifests: `ta.yaml` (67 symbols), `math.yaml` (24), `str.yaml` (18). The manifest will become the single source for:

1. namespace/function coverage;
2. TypeScript signature generation;
3. compatibility test generation;
4. documentation tables;
5. implementation tracking.

Target namespaces also include `array`, `matrix`, `map`, `color`, `input`, `request`, `strategy`, and visual/object APIs.

The catalog is intentionally incomplete at bootstrap. No API is marked implemented solely because its name appears in the manifest.
