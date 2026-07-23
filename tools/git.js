import { getProject } from '../lib/control-plane.js';
import { dispatchProjectOperation } from '../lib/project-operation-dispatcher.js';

export async function gitOperation({ projectId, action, args = {} }, identity) {
  if (!projectId) throw new Error('projectId is required');
  const project = await getProject(projectId, identity);
  const result = await dispatchProjectOperation(
    project.id,
    identity,
    'project.git',
    { projectId: project.id, action, args },
    { timeoutMs: ['pull', 'push'].includes(action) ? 120_000 : 35_000 }
  );
  return result;
}
