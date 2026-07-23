import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createProjectOperationDispatcher } from '../lib/project-operation-dispatcher.js';

const project = { id: '436b432a-206b-43cd-abfa-6291dbef0c50' };
const identity = { userId: 'developer' };

describe('multi-host project operation dispatcher', () => {
  it('preserves the existing local broker path', async () => {
    const calls = [];
    const dispatch = createProjectOperationDispatcher({
      resolveTransport: async () => ({ kind: 'local', project }),
      localCall: async (...args) => calls.push(args),
      remoteCall: async () => assert.fail('remote client must not be called'),
    });
    await dispatch(project.id, identity, 'project.file.read', { projectId: 'untrusted', path: 'README.md' });
    assert.equal(calls[0][0], 'project.file.read');
    assert.equal(calls[0][1].projectId, project.id);
  });

  it('routes an enabled remote project only through its registered connection', async () => {
    const connection = { id: 'connection-1' };
    const calls = [];
    const dispatch = createProjectOperationDispatcher({
      resolveTransport: async () => ({ kind: 'ssh-gateway', project, connection }),
      localCall: async () => assert.fail('local broker must not be called'),
      remoteCall: async (...args) => calls.push(args),
    });
    await dispatch(project.id, identity, 'project.git', { projectId: 'other', action: 'status' }, { timeoutMs: 20 });
    assert.equal(calls[0][0], connection);
    assert.equal(calls[0][1], 'project.git');
    assert.equal(calls[0][2].projectId, project.id);
    assert.equal(calls[0][3].timeoutMs, 20);
  });

  it('rejects unknown transport kinds', async () => {
    const dispatch = createProjectOperationDispatcher({
      resolveTransport: async () => ({ kind: 'shell', project }),
    });
    await assert.rejects(dispatch(project.id, identity, 'project.file.read', {}), /Unsupported/);
  });
});
