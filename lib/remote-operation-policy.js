export const REMOTE_BROKER_OPERATIONS = new Set([
  'broker.health',
  'project.file.read',
  'project.file.write',
  'project.file.delete',
  'project.file.list',
  'project.file.info',
  'project.file.move',
  'project.file.copy',
  'project.file.search',
  'project.test',
  'project.cancel',
  'project.git',
]);

export function assertRemoteBrokerOperation(operation) {
  if (typeof operation !== 'string' || !REMOTE_BROKER_OPERATIONS.has(operation))
    throw new Error('Operation is not permitted through the SSH node gateway');
  return operation;
}
