const crypto = require('crypto');
const apiKey = 'mcp_abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqrstuvwxyz1234';
const adminKey = 'mcp_abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqrstuvwxyz1234';

console.log(apiKey === adminKey);
console.log(crypto.timingSafeEqual(Buffer.from(apiKey.padEnd(100)), Buffer.from(adminKey.padEnd(100))));
