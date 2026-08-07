import { handleRequest } from './broker.js';
import path from 'path';

process.env.PATH = path.join(process.cwd(), 'cov_tmp', 'bin') + ':' + process.env.PATH;

async function test() {
  const result = await handleRequest({ requestId: "11111111-1111-4111-8111-111111111111", operation: "project.cancel", parameters: { runId: '11111111-1111-4111-8111-111111111111' } });
  console.log(result);
}
test();
