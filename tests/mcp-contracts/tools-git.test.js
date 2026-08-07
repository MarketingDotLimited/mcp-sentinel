import "../test-env.js";
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

mock.module("../../lib/control-plane.js", {
  namedExports: {
    getProject: mock.fn(),
  },
});

mock.module("../../lib/project-operation-dispatcher.js", {
  namedExports: {
    dispatchProjectOperation: mock.fn(),
  },
});

const { gitOperation } = await import("../../tools/git.js");
const { getProject } = await import("../../lib/control-plane.js");
const { dispatchProjectOperation } = await import("../../lib/project-operation-dispatcher.js");

describe('git tool', () => {
  beforeEach(() => {
    getProject.mock.resetCalls();
    dispatchProjectOperation.mock.resetCalls();
  });

  test('gitOperation throws if projectId missing', async () => {
    await assert.rejects(gitOperation({ action: 'pull' }, {}), /projectId is required/);
  });

  test('gitOperation calls dispatchProjectOperation correctly for push/pull', async () => {
    getProject.mock.mockImplementation(async id => ({ id }));
    dispatchProjectOperation.mock.mockImplementation(async () => ({ success: true }));

    const res = await gitOperation({ projectId: 'proj-1', action: 'pull' }, { user: 'u1' });
    assert.deepEqual(res, { success: true });

    assert.equal(getProject.mock.calls.length, 1);
    assert.deepEqual(getProject.mock.calls[0].arguments, ['proj-1', { user: 'u1' }]);

    assert.equal(dispatchProjectOperation.mock.calls.length, 1);
    assert.deepEqual(dispatchProjectOperation.mock.calls[0].arguments, [
      'proj-1',
      { user: 'u1' },
      'project.git',
      { projectId: 'proj-1', action: 'pull', args: {} },
      { timeoutMs: 120000 },
    ]);
  });

  test('gitOperation calls dispatchProjectOperation correctly for other actions', async () => {
    getProject.mock.mockImplementation(async id => ({ id }));
    dispatchProjectOperation.mock.mockImplementation(async () => ({ success: true }));

    const res = await gitOperation({ projectId: 'proj-1', action: 'status', args: { foo: 'bar' } }, { user: 'u2' });
    assert.deepEqual(res, { success: true });

    assert.equal(getProject.mock.calls.length, 1);
    assert.deepEqual(getProject.mock.calls[0].arguments, ['proj-1', { user: 'u2' }]);

    assert.equal(dispatchProjectOperation.mock.calls.length, 1);
    assert.deepEqual(dispatchProjectOperation.mock.calls[0].arguments, [
      'proj-1',
      { user: 'u2' },
      'project.git',
      { projectId: 'proj-1', action: 'status', args: { foo: 'bar' } },
      { timeoutMs: 35000 },
    ]);
  });
});
