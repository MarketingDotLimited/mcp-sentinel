import path from 'path';
import { DatabaseSync } from 'node:sqlite';

process.env.PATH = path.join(process.cwd(), 'cov_tmp', 'bin') + ':' + process.env.PATH;
process.env.MCP_STATE_DB = '/tmp/test.db';

const db = new DatabaseSync('/tmp/test.db');
db.exec('CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, payload TEXT);');
db.exec(
  `INSERT OR REPLACE INTO projects VALUES ('22222222-2222-4222-8222-222222222222', '{"id":"22222222-2222-4222-8222-222222222222","repoPath":"/tmp/myrepo","rootPath":"/tmp/myrepo","runAsUser":"testuser","permittedGitActions":["status","diff","log","branch","checkout","fake"],"allowRecursiveDelete":true,"permittedTasks":["npm"]}');`
);
db.close();

import fsSync from 'fs';
fsSync.mkdirSync('/tmp/myrepo/foo', { recursive: true });

const { handleRequest } = await import('./broker.js');

async function test() {
  try {
    const result = await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'project.test',
      parameters: {
        projectId: '22222222-2222-4222-8222-222222222222',
        runId: '11111111-1111-4111-8111-111111111111',
        runner: 'npm',
        target: 'foo',
      },
    });
    console.log(result);
  } catch (e) {
    console.log('CAUGHT', e);
  }
}
test();
