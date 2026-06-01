import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  {
    files: [
      "src/**/*.ts",
      "tests/**/*.ts",
      "scripts/**/*.ts",
      "vitest.config.ts",
      "vitest.real.config.ts"
    ],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    ignores: ["dist/**", "coverage/**"]
  }
);
