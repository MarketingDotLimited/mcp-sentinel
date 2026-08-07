import "../test-env.js";
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';

let callCount = 0;

mock.module("../../lib/control-plane.js", {
  namedExports: {
    getProject: async projectId => {
      callCount++;
      if (callCount === 1) return { id: 'project-1' };
      if (callCount === 2) return { id: 'project-2' };
      return { id: projectId };
    },
  },
});

mock.module("../../lib/project-operation-dispatcher.js", {
  namedExports: {
    dispatchProjectOperation: async (projectId, identity, operation, payload) => ({
      operation,
      ...payload,
    }),
  },
});

const files = await import("../../tools/files.js");

describe('files tools branch coverage', () => {
  it('covers remaining branches', async () => {
    // line 9: empty suppliedPath
    const list = await files.listDirectory({ projectId: 'project-3', dirPath: '' }, {});
    assert.equal(list.path, '.');

    // line 23: writeFile invalid encoding
    await assert.rejects(
      files.writeFile({ projectId: 'project-3', filePath: 'a', content: 'b', encoding: 'base64' }, {}),
      /Only utf8/
    );

    // line 91: searchFiles with fileType
    const search = await files.searchFiles(
      { projectId: 'project-3', searchPath: '.', pattern: '*.js', fileType: 'file' },
      {}
    );
    assert.equal(search.fileType, 'file');

    // line 54: source and destination project mismatch
    callCount = 0;
    await assert.rejects(
      files.moveFile({ projectId: 'mixed', sourcePath: 'a', destPath: 'b' }, {}),
      /Cross-project file operations are not permitted/
    );
  });
});
