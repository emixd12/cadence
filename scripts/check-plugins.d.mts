export const repositoryRoot: string;
export const skillNames: string[];
export const pluginNames: ("claude-plugin" | "chatgpt-plugin")[];
export function packageFiles(plugin: "claude-plugin" | "chatgpt-plugin"): string[];
export function checkPlugins(root?: string): { version: string };
