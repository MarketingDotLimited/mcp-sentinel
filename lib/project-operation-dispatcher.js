import { brokerCall } from './broker-client.js';
import { resolveProjectTransport } from './control-plane.js';
import { sshGatewayCall } from './ssh-gateway-client.js';

export function createProjectOperationDispatcher({
  resolveTransport = resolveProjectTransport,
  localCall = brokerCall,
  remoteCall = sshGatewayCall,
} = {}) {
  return async function dispatch(projectId, identity, operation, parameters = {}, options = {}) {
    const transport = await resolveTransport(projectId, identity);
    const boundParameters = { ...parameters, projectId: transport.project.id };
    if (transport.kind === 'local') return localCall(operation, boundParameters, options);
    if (transport.kind === 'ssh-gateway') return remoteCall(transport.connection, operation, boundParameters, options);
    throw new Error('Unsupported project operation transport');
  };
}

export const dispatchProjectOperation = createProjectOperationDispatcher();
