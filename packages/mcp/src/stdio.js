#!/usr/bin/env node
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { createMcpContext, handleMcpPayload } from "./protocol.js";

export async function startStdioServer(options = {}) {
  const context = createMcpContext({
    local: true,
    cwd: options.cwd || process.cwd(),
    env: process.env,
    skillPacks: options.skillPacks || process.env.BOOMIN_MCP_SKILL_PACKS,
    platformToken: options.platformToken || process.env.BOOMIN_PLATFORM_TOKEN,
  });

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const payload = JSON.parse(trimmed);
      const response = await handleMcpPayload(payload, context);
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: error instanceof Error ? error.message : String(error) },
      })}\n`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  startStdioServer().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exit(1);
  });
}
