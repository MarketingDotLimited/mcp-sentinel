process.env.BROKER_MANAGED_SERVICES = 'example-app,nginx';
import('./broker.js').then(async ({ startBroker, handleRequest }) => {
  startBroker();
  handleRequest({ requestId: '11111111-1111-4111-8111-111111111111', operation: 'service.action', parameters: { service: 'nginx', action: 'stop' } })
    .catch(e => console.log("THREW:", e.message));
});
