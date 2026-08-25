#!/usr/bin/env node
/* global AbortController */
// CLI entry point. Wires real Node ports and process signals; all logic
// lives in src/ so it stays testable with injected fakes.

import process from 'node:process';

import { createNodePorts } from '../src/ports.mjs';
import { runCli } from '../src/cli.mjs';

const ports = createNodePorts();
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());

const { output, exitCode } = await runCli(process.argv.slice(2), ports, controller.signal);
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
process.exitCode = exitCode;
