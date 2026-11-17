import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Trigger.dev writes bundled workers here on every dev run. They are
    // generated, gitignored, and not ours to lint.
    ".trigger/**",
    // Installed agent skills: vendored reference material and helper scripts,
    // not application code.
    ".agents/**",
  ]),
]);

export default eslintConfig;
