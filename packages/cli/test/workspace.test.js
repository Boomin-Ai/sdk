import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("provisions workspaces and brands with independent saved sessions", async t => {
  const calls = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (req.url !== "/auth/me") calls.push([req.method, req.url, req.headers.authorization, raw ? JSON.parse(raw) : null]);
    res.end('{"id":"fixture"}');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  for (const role of ["host", "guest"]) {
    const dir = await mkdtemp(path.join(tmpdir(), "boomin-cli-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await writeFile(path.join(dir, "config.json"), JSON.stringify({ authToken: role }));
    const env = { ...process.env, BOOMIN_CONFIG_DIR: dir, BOOMIN_API_BASE: `http://127.0.0.1:${server.address().port}` };
    delete env.BOOMIN_AUTH_TOKEN;
    const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
    const run = (...args) => promisify(execFile)(process.execPath, [cli, ...args, "--json"], { env });
    await run("workspace", "list");
    await run("workspace", "create", "--name", role, "--brand-name", "First");
    await run("brand", "list");
    await run("brand", "create", "--org-id", role, "--name", "Second");
    await assert.rejects(run("brand", "create", "--name", "Missing org"), error => JSON.parse(error.stdout).error.message === "--org-id is required.");
    assert.deepEqual(calls.splice(0), [
      ["GET", "/orgs", `Bearer ${role}`, null],
      ["POST", "/orgs", `Bearer ${role}`, { name: role, brandName: "First" }],
      ["GET", "/brands", `Bearer ${role}`, null],
      ["POST", "/brands", `Bearer ${role}`, { orgId: role, name: "Second" }],
    ]);
  }
});
