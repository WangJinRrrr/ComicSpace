import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.d.ts",
      "**/*.map",
      "data/**",
      "coverage/**",
      "release/**",
      ".build/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "no-empty": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "**/apps/server/**",
            "node:*",
            "fs",
            "path",
            "jiti",
            "node:sqlite",
          ],
        },
      ],
    },
  },
  {
    files: ["apps/server/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["**/apps/web/**"] },
      ],
    },
  },
  {
    files: ["apps/desktop/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["**/apps/web/**", "**/apps/server/**"] },
      ],
    },
  },
);
