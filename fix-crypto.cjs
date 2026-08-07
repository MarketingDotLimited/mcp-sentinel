const fs = require('fs');
let content = fs.readFileSync('tests/scripts/restore-state.test.js', 'utf8');
content = content.replace(/                createDecipheriv: \(\) => \(\{[\s\S]*?\}\);/g, `                createDecipheriv: () => ({
                    setAuthTag: () => {},
                    update: () => Buffer.from('fake'),
                    final: () => Buffer.from('')
                }),
                createHash: () => ({
                    update: () => ({ digest: () => 'fake' })
                })
            }
        });`);
fs.writeFileSync('tests/scripts/restore-state.test.js', content);
