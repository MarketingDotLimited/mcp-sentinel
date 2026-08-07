const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');
code = code.replace(
  /origin: function \(origin, callback\) \{/g,
  "origin: function (origin, callback) { console.error('CORS ORIGIN CHECK:', origin, allowedOrigins);"
);
fs.writeFileSync('server.js', code);
