import net from 'net';
import { randomUUID } from 'crypto';

const SOCKET_PATH = process.env.MCP_BROKER_SOCKET || '/run/mcp-sentinel/broker.sock';
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export function brokerCall(operation, parameters = {}, { timeoutMs = 30_000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: SOCKET_PATH });
    const requestId = randomUUID();
    let response = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Privilege broker request timed out')), timeoutMs);
    signal?.addEventListener(
      'abort',
      () => finish(Object.assign(new Error('Privilege broker request cancelled'), { name: 'AbortError' })),
      {
        once: true,
      }
    );
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify({ requestId, operation, parameters })}\n`));
    socket.on('data', chunk => {
      response += chunk;
      if (Buffer.byteLength(response) > MAX_RESPONSE_BYTES) finish(new Error('Privilege broker response is too large'));
    });
    socket.on('error', error => finish(new Error(`Privilege broker unavailable: ${error.message}`)));
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
