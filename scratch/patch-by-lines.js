const fs = require('fs');
let lines = fs.readFileSync('scripts/production-preflight.js', 'utf8').split('\n');

// 73:     url = new URL(value);
// 74:   } catch {
// 75:     throw new Error(`${name} must be an absolute URL`);
// 76:   }
lines[74] = '  } catch (e) {';
lines[75] = '    throw new Error(`${name} must be an absolute URL`);';
lines[76] = '  }';

// 223:         for (const projectId of client.projectIds || [])
// 224:           if (!projectIds.has(projectId))
// 225:             throw new Error(`OAuth client override '${mapping.username}/${clientId}' references an unknown project`);
lines[223] = '        const projIds = client.projectIds || []; for(let i=0; i<projIds.length; i++) {';
lines[224] = '          if (!projectIds.has(projIds[i])) throw new Error(`OAuth client override \\'${mapping.username}/${clientId}\\' references an unknown project`);';
lines[225] = '        }';

fs.writeFileSync('scripts/production-preflight.js', lines.join('\n'));
