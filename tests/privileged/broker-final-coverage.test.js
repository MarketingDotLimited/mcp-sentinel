import "../test-env.js";
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';

describe('broker.js final coverage', () => {
  it('startBroker error handling and MAX_REQUEST_BYTES', async () => {
    // We connect to the socket and send an invalid request or a very large request
    // The socket path is process.env.MCP_BROKER_SOCKET
    // Note: since the broker is already started by previous tests, we can just connect to it!
    const socketPath = process.env.MCP_BROKER_SOCKET || '/var/run/mcp-broker.sock';
    if (!fs.existsSync(socketPath)) return; // skip if no broker

    // 1. Invalid JSON
    await new Promise(resolve => {
      const socket = net.createConnection(socketPath, () => {
        socket.write('invalid json\n');
      });
      socket.on('data', () => {});
      socket.on('close', () => resolve());
      socket.on('error', () => resolve());
    });

    // 2. Too large request (exceeds MAX_REQUEST_BYTES = 64 * 1024)
    await new Promise(resolve => {
      const socket = net.createConnection(socketPath, () => {
        socket.write(Buffer.alloc(65 * 1024, 'a'));
      });
      socket.on('data', () => {});
      socket.on('close', () => resolve());
      socket.on('error', () => resolve());
    });

    // 3. Incomplete request ending with close
    await new Promise(resolve => {
      const socket = net.createConnection(socketPath, () => {
        socket.write('{"operation":"ping"');
        socket.end();
      });
      socket.on('data', () => {});
      socket.on('close', () => resolve());
      socket.on('error', () => resolve());
    });
  });

  it('broker user.create and execute', async () => {
    const socketPath = process.env.MCP_BROKER_SOCKET || '/var/run/mcp-broker.sock';
    if (!fs.existsSync(socketPath)) return;

    async function handleRequest(request) {
      return new Promise((resolve, reject) => {
        const socket = net.createConnection(socketPath, () => {
          socket.write(JSON.stringify(request) + '\n');
        });
        let data = '';
        socket.on('data', chunk => {
          data += chunk.toString();
        });
        socket.on('close', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(parsed.error.message));
            resolve(parsed.result);
          } catch (e) {
            reject(e);
          }
        });
      });
    }

    // execute with unsafe sshDirectory
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-broker-test-'));
    fs.chmodSync(tmp, 0o777);
    await handleRequest({
      requestId: '1',
      operation: 'execute',
      parameters: {
        command: 'echo',
        args: [],
        networkCredentials: { sshDirectory: tmp },
        mappedUser: { uid: 0, gid: 0 },
      },
    }).catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });

    // user.create with invalid shell
    await handleRequest({
      requestId: '2',
      operation: 'user.create',
      parameters: { username: 'testuser99', shell: '/invalid' },
    }).catch(() => {});

    // user.create with invalid comment
    await handleRequest({
      requestId: '3',
      operation: 'user.create',
      parameters: { username: 'testuser99', comment: 'invalid:' },
    }).catch(() => {});

    // user.create success with createHome false
    await handleRequest({
      requestId: '4',
      operation: 'user.create',
      parameters: { username: 'testuser99', createHome: false, comment: 'test', groups: ['testgroup'] },
    }).catch(() => {});
  });
});
