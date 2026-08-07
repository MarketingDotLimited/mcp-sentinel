import path from 'path';
import { fileURLToPath } from 'url';

export function run() {
  console.log("process.argv[1]:", process.argv[1]);
  console.log("resolved:", path.resolve(process.argv[1]));
  console.log("import.meta.url:", import.meta.url);
  console.log("fileURLToPath:", fileURLToPath(import.meta.url.split('?')[0]));
  console.log("Match:", path.resolve(process.argv[1]) === fileURLToPath(import.meta.url.split('?')[0]));
}
