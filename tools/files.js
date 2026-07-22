import path from 'path';
import { brokerCall } from '../lib/broker-client.js';
import { getProject, listProjects } from '../lib/control-plane.js';

async function projectLocation(projectId, suppliedPath, identity) {
  if (projectId) {
    const project = await getProject(projectId, identity);
    if (typeof suppliedPath !== 'string' || path.isAbsolute(suppliedPath))
      throw new Error('With projectId, file paths must be relative to the registered project root');
    return { project, relativePath: suppliedPath || '.', deprecated: false };
  }
  if (typeof suppliedPath !== 'string' || !path.isAbsolute(suppliedPath))
    throw new Error('projectId is required; an absolute path is accepted only during the compatibility window');
  const requested = path.resolve(suppliedPath);
  const candidates = (await listProjects(identity))
    .map(project => ({ project, root: path.resolve(project.rootPath) }))
    .filter(({ root }) => requested === root || requested.startsWith(`${root}${path.sep}`))
    .sort((left, right) => right.root.length - left.root.length);
  if (!candidates.length)
    throw new Error('Legacy path is not permitted because it does not belong to an assigned project');
  return {
    project: candidates[0].project,
    relativePath: path.relative(candidates[0].root, requested) || '.',
    deprecated: true,
  };
}

function withWarning(result, deprecated) {
  return deprecated
    ? { ...result, warning: 'Absolute file paths are deprecated; use projectId and a relative path' }
    : result;
}

export async function readFile({ projectId, filePath, encoding = 'utf8', maxBytes = 1048576 }, identity) {
  if (encoding !== 'utf8') throw new Error('Only utf8 project file reads are supported');
  const location = await projectLocation(projectId, filePath, identity);
  return withWarning(
    await brokerCall('project.file.read', {
      projectId: location.project.id,
      path: location.relativePath,
      maxBytes,
    }),
    location.deprecated
  );
}

export async function writeFile({ projectId, filePath, content, mode = 'overwrite', encoding = 'utf8' }, identity) {
  if (encoding !== 'utf8') throw new Error('Only utf8 project file writes are supported');
  const location = await projectLocation(projectId, filePath, identity);
  return withWarning(
    await brokerCall('project.file.write', {
      projectId: location.project.id,
      path: location.relativePath,
      content,
      mode,
    }),
    location.deprecated
  );
}

export async function deleteFile({ projectId, filePath, recursive = false }, identity) {
  const location = await projectLocation(projectId, filePath, identity);
  return withWarning(
    await brokerCall('project.file.delete', {
      projectId: location.project.id,
      path: location.relativePath,
      recursive,
    }),
    location.deprecated
  );
}

export async function listDirectory({ projectId, dirPath, showHidden = false }, identity) {
  const location = await projectLocation(projectId, dirPath, identity);
  return withWarning(
    await brokerCall('project.file.list', {
      projectId: location.project.id,
      path: location.relativePath,
      showHidden,
    }),
    location.deprecated
  );
}

async function twoLocations(projectId, sourcePath, destPath, identity) {
  const source = await projectLocation(projectId, sourcePath, identity);
  const destination = await projectLocation(projectId || null, destPath, identity);
  if (source.project.id !== destination.project.id) throw new Error('Cross-project file operations are not permitted');
  return { source, destination, deprecated: source.deprecated || destination.deprecated };
}

export async function moveFile({ projectId, sourcePath, destPath }, identity) {
  const locations = await twoLocations(projectId, sourcePath, destPath, identity);
  return withWarning(
    await brokerCall('project.file.move', {
      projectId: locations.source.project.id,
      source: locations.source.relativePath,
      destination: locations.destination.relativePath,
    }),
    locations.deprecated
  );
}

export async function copyFile({ projectId, sourcePath, destPath }, identity) {
  const locations = await twoLocations(projectId, sourcePath, destPath, identity);
  return withWarning(
    await brokerCall('project.file.copy', {
      projectId: locations.source.project.id,
      source: locations.source.relativePath,
      destination: locations.destination.relativePath,
    }),
    locations.deprecated
  );
}

export async function getFileInfo({ projectId, filePath }, identity) {
  const location = await projectLocation(projectId, filePath, identity);
  return withWarning(
    await brokerCall('project.file.info', { projectId: location.project.id, path: location.relativePath }),
    location.deprecated
  );
}

export async function searchFiles({ projectId, searchPath, pattern, maxResults = 50, fileType }, identity) {
  const location = await projectLocation(projectId, searchPath, identity);
  return withWarning(
    await brokerCall('project.file.search', {
      projectId: location.project.id,
      path: location.relativePath,
      pattern,
      maxResults,
      ...(fileType ? { fileType } : {}),
    }),
    location.deprecated
  );
}
