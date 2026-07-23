import { getProject } from '../lib/control-plane.js';
import { dispatchProjectOperation } from '../lib/project-operation-dispatcher.js';

async function projectLocation(projectId, suppliedPath, identity) {
  if (!projectId) throw new Error('projectId is required');
  const project = await getProject(projectId, identity);
  if (typeof suppliedPath !== 'string' || suppliedPath.startsWith('/'))
    throw new Error('File paths must be relative to the registered project root');
  return { project, relativePath: suppliedPath || '.' };
}

export async function readFile({ projectId, filePath, encoding = 'utf8', maxBytes = 1048576 }, identity) {
  if (encoding !== 'utf8') throw new Error('Only utf8 project file reads are supported');
  const location = await projectLocation(projectId, filePath, identity);
  return dispatchProjectOperation(location.project.id, identity, 'project.file.read', {
    projectId: location.project.id,
    path: location.relativePath,
    maxBytes,
  });
}

export async function writeFile({ projectId, filePath, content, mode = 'overwrite', encoding = 'utf8' }, identity) {
  if (encoding !== 'utf8') throw new Error('Only utf8 project file writes are supported');
  const location = await projectLocation(projectId, filePath, identity);
  return dispatchProjectOperation(location.project.id, identity, 'project.file.write', {
    projectId: location.project.id,
    path: location.relativePath,
    content,
    mode,
  });
}

export async function deleteFile({ projectId, filePath, recursive = false }, identity) {
  const location = await projectLocation(projectId, filePath, identity);
  return dispatchProjectOperation(location.project.id, identity, 'project.file.delete', {
    projectId: location.project.id,
    path: location.relativePath,
    recursive,
  });
}

export async function listDirectory({ projectId, dirPath, showHidden = false }, identity) {
  const location = await projectLocation(projectId, dirPath, identity);
  return dispatchProjectOperation(location.project.id, identity, 'project.file.list', {
    projectId: location.project.id,
    path: location.relativePath,
    showHidden,
  });
}

async function twoLocations(projectId, sourcePath, destPath, identity) {
  const source = await projectLocation(projectId, sourcePath, identity);
  const destination = await projectLocation(projectId, destPath, identity);
  if (source.project.id !== destination.project.id) throw new Error('Cross-project file operations are not permitted');
  return { source, destination };
}

export async function moveFile({ projectId, sourcePath, destPath }, identity) {
  const locations = await twoLocations(projectId, sourcePath, destPath, identity);
  return dispatchProjectOperation(locations.source.project.id, identity, 'project.file.move', {
    projectId: locations.source.project.id,
    source: locations.source.relativePath,
    destination: locations.destination.relativePath,
  });
}

export async function copyFile({ projectId, sourcePath, destPath }, identity) {
  const locations = await twoLocations(projectId, sourcePath, destPath, identity);
  return dispatchProjectOperation(locations.source.project.id, identity, 'project.file.copy', {
    projectId: locations.source.project.id,
    source: locations.source.relativePath,
    destination: locations.destination.relativePath,
  });
}

export async function getFileInfo({ projectId, filePath }, identity) {
  const location = await projectLocation(projectId, filePath, identity);
  return dispatchProjectOperation(location.project.id, identity, 'project.file.info', {
    projectId: location.project.id,
    path: location.relativePath,
  });
}

export async function searchFiles({ projectId, searchPath, pattern, maxResults = 50, fileType }, identity) {
  const location = await projectLocation(projectId, searchPath, identity);
  return dispatchProjectOperation(location.project.id, identity, 'project.file.search', {
    projectId: location.project.id,
    path: location.relativePath,
    pattern,
    maxResults,
    ...(fileType ? { fileType } : {}),
  });
}
