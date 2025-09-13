import { readFileSync, writeFileSync, mkdirSync } from "fs";

const esm = readFileSync("dist/index.js", "utf8");
// super-light transform (remove ESM export syntax -> CJS)
const cjs = esm
  .replace(/export\s+{([^}]+)}/g, (_, names) =>
    names
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => `exports.${n} = ${n};`)
      .join("\n")
  )
  .replace(/export\s+const\s+(\w+)\s*=/g, "const $1 =")
  .replace(/export\s+function\s+(\w+)\s*\(/g, "function $1(");

mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.cjs", cjs, "utf8");
