import fs from 'fs';
import net from 'net';
import { randomUUID } from 'crypto';

const SOCKET_PATH = (process.env.MCP_BROKER_SOCKET || '/run/mcp-sentinel/broker.sock').trim();
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const BROKER_SOCKET_PATHS = [
  ...new Set([SOCKET_PATH, '/run/mcp-sentinel/broker.sock', '/var/run/mcp-sentinel/broker.sock']),
];

function socketPathCandidates() {
  return BROKER_SOCKET_PATHS.map(path => path.trim())
    .filter(path => path)
    .filter((path, index, list) => path && list.indexOf(path) === index);
}

function isUnavailableSocketError(error) {
  return ['ENOENT', 'ECONNREFUSED'].includes(error?.code) || ['EPIPE', 'ECONNRESET'].includes(error?.code);
}

function requestViaSocket(socketPath, operation, parameters, { timeoutMs, signal } = {}) {
  return new Promise((resolve, reject) => {
    let socket;
    const requestId = randomUUID();
    let response = '';
    let settled = false;

    const cleanup = () => {
      if (socket && !socket.destroyed) socket.destroy();
    };

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      if (error) {
        const wrapped =
          error.code === 'E_BROKER_UNAVAILABLE' ? error : new Error(`Privilege broker unavailable: ${error.message}`);
        wrapped.code = wrapped.code === 'E_BROKER_UNAVAILABLE' ? wrapped.code : 'E_BROKER_UNAVAILABLE';
        wrapped.cause = error;
        wrapped.socketPath = socketPath;
        reject(wrapped);
      } else {
        resolve(value);
      }
    };

    const timer = setTimeout(() => {
      finish(new Error('Privilege broker request timed out'));
    }, timeoutMs);

    socket = net.createConnection({ path: socketPath });

    signal?.addEventListener(
      'abort',
      () => {
        const cancelled = new Error('Privilege broker request cancelled');
        cancelled.name = 'AbortError';
        cancelled.code = 'E_BROKER_CANCEL';
        finish(cancelled);
      },
      { once: true }
    );

    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ requestId, operation, parameters })}\n`);
    });
    socket.on('data', chunk => {
      response += chunk;
      if (Buffer.byteLength(response) > MAX_RESPONSE_BYTES) finish(new Error('Privilege broker response is too large'));
    });
    socket.on('error', error => finish(error));
    socket.on('end', () => {
      try {
        const parsed = JSON.parse(response);
        if (parsed.requestId !== requestId) throw new Error('Privilege broker response ID mismatch');
        if (!parsed.ok) throw new Error(parsed.error || 'Privilege broker rejected the request');
        finish(null, parsed.result);
      } catch (error) {
        finish(error);
      }
    });
  });
}

export function brokerCall(operation, parameters = {}, { timeoutMs = 30_000, signal } = {}) {
  const candidates = socketPathCandidates();
  let lastError;
  return (async () => {
    for (const socketPath of candidates) {
      try {
        // Prefer an actually existing socket, but always include configured paths
        // for environments with different runtime roots.
        try {
          if (fs.existsSync(socketPath) || socketPath === SOCKET_PATH) {
            return await requestViaSocket(socketPath, operation, parameters, { timeoutMs, signal });
          }
        } catch (error) {
          lastError = error;
          continue;
        }
      } catch {
        // noop
      }
    }

    for (const socketPath of candidates) {
      try {
        return await requestViaSocket(socketPath, operation, parameters, { timeoutMs, signal });
      } catch (error) {
        lastError = error;
        if (!isUnavailableSocketError(error)) throw error;
        if (socketPath === candidates[candidates.length - 1]) break;
      }
    }

    if (!lastError) throw new Error(`Privilege broker unavailable: no socket available`);
    throw lastError;
  })();
}
