import { defineConfig } from "vitest/config";
import fs from "node:fs";
import path from "node:path";

// The source uses NodeNext `.js` import specifiers that actually point at
// `.ts`/`.tsx` files. Vite/Rollup won't resolve those by default, so map
// relative `./foo.js` → `./foo.ts(x)` before the default resolver runs.
export default defineConfig({
  plugins: [
    {
      name: "resolve-js-to-ts",
      enforce: "pre",
      resolveId(source, importer) {
        if (!importer || !source.startsWith(".") || !source.endsWith(".js")) return null;
        const base = path.resolve(path.dirname(importer), source.slice(0, -3));
        for (const ext of [".ts", ".tsx"]) {
          if (fs.existsSync(base + ext)) return base + ext;
        }
        return null;
      },
    },
  ],
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
