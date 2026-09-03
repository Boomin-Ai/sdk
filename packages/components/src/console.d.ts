import type { ConsoleMountOptions, MountedConsole, RuntimeOptions } from "./index.js";

export declare function mountConsole(el: HTMLElement, options: ConsoleMountOptions & RuntimeOptions): Promise<MountedConsole>;
export default mountConsole;
export type { ConsoleMountOptions, MountedConsole, ConsoleSection, ConsoleTheme } from "./index.js";
