const fs = require('fs');
const path = require('path');

const baseDir = path.join(__dirname, 'public', 'js');
const pagesDir = path.join(baseDir, 'pages');

// Fix api.js
let apiCode = fs.readFileSync(path.join(baseDir, 'api.js'), 'utf8');
apiCode = apiCode.replace('export const API = API;', 'export { API };');
fs.writeFileSync(path.join(baseDir, 'api.js'), apiCode);

// Fix toast.js
let toastCode = fs.readFileSync(path.join(baseDir, 'toast.js'), 'utf8');
toastCode = toastCode.replace('export const Toast = Toast;', 'export { Toast };');
fs.writeFileSync(path.join(baseDir, 'toast.js'), toastCode);

// Fix auth.js
let authCode = fs.readFileSync(path.join(baseDir, 'auth.js'), 'utf8');
authCode = authCode.replace('export const Auth = Auth;', 'export { Auth };');
fs.writeFileSync(path.join(baseDir, 'auth.js'), authCode);

// Fix router.js
let routerCode = fs.readFileSync(path.join(baseDir, 'router.js'), 'utf8');
routerCode = routerCode.replace('export const Router = Router;', 'export { Router };');
fs.writeFileSync(path.join(baseDir, 'router.js'), routerCode);

// Fix pages
const pages = fs.readdirSync(pagesDir).filter(f => f.endsWith('.js'));
for (const page of pages) {
  let pageCode = fs.readFileSync(path.join(pagesDir, page), 'utf8');
  // Find window.XXXPage = XXXPage;
  pageCode = pageCode.replace(/window\.(\w+Page)\s*=\s*\1;/g, 'export { $1 };');
  fs.writeFileSync(path.join(pagesDir, page), pageCode);
}

// Fix app.js
let appCode = fs.readFileSync(path.join(baseDir, 'app.js'), 'utf8');
// Convert import "./pages/xxx.js" to import { XxxPage } from "./pages/xxx.js"
for (const page of pages) {
  let pageContent = fs.readFileSync(path.join(pagesDir, page), 'utf8');
  let match = pageContent.match(/export \{ (\w+Page) \};/);
  if (match) {
    let pageExport = match[1];
    appCode = appCode.replace(`import "./pages/${page}";`, `import { ${pageExport} } from "./pages/${page}";`);
  }
}
// Remove 'window.' from Router.register calls
appCode = appCode.replace(/Router\.register\('([^']+)',\s*window\.(\w+Page)\);/g, "Router.register('$1', $2);");
appCode = appCode.replace(/Router\.register\('([^']+)',\s*window\.(\w+)\);/g, "Router.register('$1', $2);");

fs.writeFileSync(path.join(baseDir, 'app.js'), appCode);

console.log('Frontend fix applied');
