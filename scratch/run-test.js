process.on('unhandledRejection', (reason, promise) => {
  console.log('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.log('Uncaught Exception:', err);
});
import('../tests/scripts/deploy-release.test.js').catch(e => console.error(e));
