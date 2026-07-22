import { brokerCall } from './broker-client.js';

export const getOAuthUsers = () => brokerCall('oauth.user.list', {});
export const addOAuthUser = input => brokerCall('oauth.user.add', input);
export const updateOAuthUser = (username, updates) => brokerCall('oauth.user.update', { username, updates });
export const deleteOAuthUser = username => brokerCall('oauth.user.delete', { username });
export const getOAuthClients = () => brokerCall('oauth.client.list', {});
export const addOAuthClient = input => brokerCall('oauth.client.add', input);
export const deleteOAuthClient = clientId => brokerCall('oauth.client.delete', { clientId });
export const getAutheliaHealth = () => brokerCall('oauth.health', {});
