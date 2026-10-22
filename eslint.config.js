import js from "@eslint/js";
import globals from "globals";
export default [
  { ignores: ["node_modules/**", "dist/**", "data/**", "test-results/**"] },
  {
    ...js.configs.recommended,
    files: [
      "server/**/*.js",
      "api/**/*.js",
      "scripts/**/*.js",
      "tests/**/*.js",
      "*.config.js",
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
      "no-eval": "error",
      "no-new-func": "error",
      "no-implied-eval": "error",
    },
  },
  {
    files: ["tests/browser/**/*.js"],
    languageOptions: { globals: globals.browser },
  },
];
