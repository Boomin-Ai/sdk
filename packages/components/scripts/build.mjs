// Fills dist/ with the SAME artifacts boomin.ai serves at runtime:
//   dist/components.js  ← /components/v1.js          (the runtime)
//   dist/console.js     ← /components/v1/console.js  (the console bundle)
// Source of truth is the web repo's build. Point BOOMIN_WEB_DIST at a local
// `web/dist` to copy from disk (release prep), otherwise fetch from
// BOOMIN_COMPONENTS_BASE (default https://boomin.ai).
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
await mkdir(dist, { recursive: true });

const ARTIFACTS = [
  { out: "components.js", path: "/components/v1.js" },
  { out: "console.js", path: "/components/v1/console.js" },
];

const local = process.env.BOOMIN_WEB_DIST;
const base = (process.env.BOOMIN_COMPONENTS_BASE || "https://boomin.ai").replace(/\/+$/, "");

for (const { out, path } of ARTIFACTS) {
  const target = join(dist, out);
  if (local) {
    const src = join(local, path);
    if (!existsSync(src)) throw new Error(`Missing ${src} — run \`npm run build\` in the web repo first.`);
    await copyFile(src, target);
    console.log(`Copied ${src} → ${target}`);
    continue;
  }
  const res = await fetch(base + path);
  if (!res.ok) throw new Error(`Failed to fetch ${base + path}: ${res.status}`);
  const body = await res.text();
  if (!body.includes("Boomin")) throw new Error(`${base + path} does not look like a Boomin bundle.`);
  await writeFile(target, body);
  console.log(`Fetched ${base + path} → ${target} (${Math.round(body.length / 1024)} kB)`);
}
