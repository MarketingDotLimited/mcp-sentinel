import path from 'path';
import { fileURLToPath } from 'url';

console.log(process.argv[1]);
console.log(path.resolve(process.argv[1]));
console.log(import.meta.url);
console.log(fileURLToPath(import.meta.url.split('?')[0]));
