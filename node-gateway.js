#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { brokerCall } from './lib/broker-client.js';
import { assertRemoteBrokerOperation } from './lib/remote-operation-policy.js';

const MAX_REQUEST_BYTES = 64 * 1024;

export async function handleGatewayInput(input, options = {}) {
  if (options.originalCommand) throw new Error('Remote commands are not accepted');
  if (options.hasTty) throw new Error('TTY sessions are not accepted');
  if (Buffer.byteLength(input) > MAX_REQUEST_BYTES) throw new Error('Node gateway request is too large');
  const lines = input.split('\n').filter(line => line.trim());
  if (lines.length !== 1) throw new Error('Node gateway accepts exactly one request');
  let request;
  try {
    request = JSON.parse(lines[0]);
  } catch {
    throw new Error('Node gateway request must be JSON');
  }
  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request) ||
    Object.keys(request).some(key => !['requestId', 'operation', 'parameters'].includes(key)) ||
    !['requestId', 'operation', 'parameters'].every(key => key in request)
  )
    throw new Error('Node gateway request contains an unknown or missing field');
  if (typeof request.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(request.requestId))
    throw new Error('Invalid node gateway request ID');
  assertRemoteBrokerOperation(request.operation);
  const call = options.brokerCall || brokerCall;
  const result = await call(request.operation, request.parameters, { timeoutMs: options.timeoutMs || 910_000 });
  return { requestId: request.requestId, ok: true, result };
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > MAX_REQUEST_BYTES) throw new Error('Node gateway request is too large');
  }
  let requestId = null;
  try {
    requestId = JSON.parse(input.trim()).requestId || null;
  } catch {}
  try {
    const response = await handleGatewayInput(input, {
      originalCommand: process.env.SSH_ORIGINAL_COMMAND || '',
      hasTty: Boolean(process.stdin.isTTY || process.stdout.isTTY),
    });
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ requestId, ok: false, error: error.message })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
