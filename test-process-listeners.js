import './server.js';
const uncaughtListeners = process.listeners('uncaughtException');
const ourUncaught = uncaughtListeners.find(f => f.toString().includes('UNCAUGHT_EXCEPTION'));
console.log('Found uncaught:', !!ourUncaught);
const unhandledListeners = process.listeners('unhandledRejection');
const ourUnhandled = unhandledListeners.find(f => f.toString().includes('UNHANDLED_REJECTION'));
console.log('Found unhandled:', !!ourUnhandled);
