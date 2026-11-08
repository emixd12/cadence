#!/usr/bin/env node
// Ticket 287 launcher. Loads the TypeScript spike through Vite's module runner so the
// repo's @/ aliases and workspace packages resolve without a new dependency.
// Usage: node scripts/run-chatgpt-plan-spike.mjs --mock | --live [options]
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const config = { configFile: false, root, logLevel: "error", resolve: { alias: { "@": root.replace(/\/$/u, "") } } };
const [{ module: spike }, { module: mock }] = await Promise.all([
  runnerImport(`${root}scripts/chatgpt-plan-spike.ts`, config),
  runnerImport(`${root}scripts/chatgpt-plan-spike-mock.ts`, config),
]);
process.exitCode = await spike.main(process.argv.slice(2), { startMock: () => mock.startMockOpenAI() });
