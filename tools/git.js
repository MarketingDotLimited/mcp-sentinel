import path from 'path';
import { brokerCall } from '../lib/broker-client.js';
import { getProject, getProjectByExactPath } from '../lib/control-plane.js';

export async function gitOperation({ projectId, repoPath, action, args = {} }, identity) {
  if (!projectId && !repoPath) throw new Error('projectId is required');
  if (projectId && repoPath) throw new Error('Use projectId or deprecated repoPath, not both');
  const project = projectId
    ? await getProject(projectId, identity)
    : await getProjectByExactPath(path.resolve(repoPath), identity);
  const result = await brokerCall(
    'project.git',
    { projectId: project.id, action, args },
    { timeoutMs: ['pull', 'push'].includes(action) ? 120_000 : 35_000 }
  );
  return {
    ...result,
    ...(repoPath ? { warning: 'repoPath is deprecated; use projectId' } : {}),
  };
}
