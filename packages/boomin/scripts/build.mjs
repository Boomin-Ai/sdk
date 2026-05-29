import { mkdir, copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "src/global.js");
const dist = resolve(root, "dist/boomin-connect.js");

await mkdir(dirname(dist), { recursive: true });
await copyFile(src, dist);
console.log(`Built ${dist}`);
