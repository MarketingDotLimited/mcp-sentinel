import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateNodeProject } from '../scripts/register-node-project.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-node-project-'));
const project = {
  id: '436b432a-206b-43cd-abfa-6291dbef0c50',
  name: 'Remote project',
  rootPath: root,
  repoPath: root,
  runAsUser: 'project_user',
  permittedTasks: ['phpunit'],
};

after(() => fs.rm(root, { recursive: true, force: true }));

describe('remote node project registration', () => {
  it('normalizes an exact UUID project as local to the managed node', async () => {
    const result = await validateNodeProject(project, { verifyUser: false });
    assert.equal(result.id, project.id);
    assert.equal(result.transportKind, 'local');
    assert.equal(result.sshAllowed, false);
    assert.deepEqual(result.permittedGitActions, ['status', 'diff', 'log', 'branch']);
  });

  it('rejects root execution, unsupported recipes, and path escapes', async () => {
    await assert.rejects(validateNodeProject({ ...project, runAsUser: 'root' }, { verifyUser: false }), /non-root/);
    await assert.rejects(
      validateNodeProject({ ...project, permittedTasks: ['shell'] }, { verifyUser: false }),
      /invalid task/
    );
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-node-outside-'));
    try {
      await assert.rejects(
        validateNodeProject({ ...project, repoPath: outside }, { verifyUser: false }),
        /inside its root/
      );
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
