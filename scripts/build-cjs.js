import { copyFileSync, mkdirSync, rmSync } from "fs";

// This script expects `tsc -p tsconfig.cjs.json` to have run,
// producing `dist-cjs/index.js` in CommonJS format.
mkdirSync("dist", { recursive: true });
copyFileSync("dist-cjs/index.js", "dist/index.cjs");

// Keep the workspace clean; `dist-cjs` is build-only and not published.
rmSync("dist-cjs", { recursive: true, force: true });
