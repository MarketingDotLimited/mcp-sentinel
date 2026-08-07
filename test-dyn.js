const { handleRequest, startBroker } = await import('./broker.js?missing=' + Date.now());
startBroker();
handleRequest({ requestId: '11111111-1111-4111-8111-111111111111', operation: 'user.modify', parameters: { username: 'testuser', expireDate: '2025-01-01' } })
  .catch(e => console.log("ERROR:", e.message));
