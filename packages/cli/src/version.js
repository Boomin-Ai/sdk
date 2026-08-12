// The CLI's own version, read once from its package.json — used for the
// X-Boomin-Client marker so server-side adoption metrics can tell the CLI
// apart from raw @boomin/sdk usage.
import { createRequire } from "node:module";

export const CLI_VERSION = createRequire(import.meta.url)("../package.json").version;
export const CLI_CLIENT_HEADER = `@boomin/cli/${CLI_VERSION}`;
