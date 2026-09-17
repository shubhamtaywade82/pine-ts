import eslint from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import { defineConfig } from "eslint/config";
import importX from "eslint-plugin-import-x";
import promise from "eslint-plugin-promise";
import regexp from "eslint-plugin-regexp";
import security from "eslint-plugin-security";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import prettier from "eslint-config-prettier/flat";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**", "**/*.generated.ts"],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      sonarjs.configs.recommended,
      regexp.configs.recommended,
      promise.configs["flat/recommended"],
    ],
    languageOptions: {
      globals: globals.nodeBuiltin,
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.config.mjs"],
          defaultProject: "tsconfig.json",
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "import-x": importX,
      security,
      unicorn,
    },
    rules: {
      "func-style": ["error", "expression", { allowArrowFunctions: true }],
      "prefer-arrow-callback": "error",
      "import-x/first": "error",
      "import-x/no-duplicates": "error",
      "import-x/newline-after-import": "error",
      "security/detect-object-injection": "off",
      "unicorn/prefer-array-find": "error",
      "unicorn/prefer-includes": "error",
      "unicorn/prefer-number-properties": "error",
      "unicorn/prefer-object-from-entries": "error",
      "unicorn/prefer-optional-catch-binding": "error",
      "unicorn/prefer-regexp-test": "error",
      "unicorn/prefer-string-starts-ends-with": "error",
    },
  },
  {
    files: ["tests/**/*.{ts,tsx}"],
    plugins: {
      vitest,
    },
    rules: {
      "vitest/no-disabled-tests": "error",
      "vitest/no-focused-tests": "error",
      "vitest/no-identical-title": "error",
    },
  },
  prettier,
);
