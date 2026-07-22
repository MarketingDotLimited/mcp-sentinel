const fs = require('fs');
const path = require('path');

const baseDir = path.join(__dirname, 'public', 'js');
const pagesDir = path.join(baseDir, 'pages');

// api.js
let apiCode = fs.readFileSync(path.join(baseDir, 'api.js'), 'utf8');
apiCode = apiCode.replace('window.API =', 'export const API =');
fs.writeFileSync(path.join(baseDir, 'api.js'), apiCode);

// toast.js
let toastCode = fs.readFileSync(path.join(baseDir, 'toast.js'), 'utf8');
toastCode = toastCode.replace('window.Toast =', 'export const Toast =');
fs.writeFileSync(path.join(baseDir, 'toast.js'), toastCode);

// auth.js
let authCode = fs.readFileSync(path.join(baseDir, 'auth.js'), 'utf8');
authCode = `import { API } from "./api.js";\nimport { Toast } from "./toast.js";\n` + authCode.replace('window.Auth =', 'export const Auth =');
fs.writeFileSync(path.join(baseDir, 'auth.js'), authCode);

// router.js
let routerCode = fs.readFileSync(path.join(baseDir, 'router.js'), 'utf8');
routerCode = `import { Auth } from "./auth.js";\n` + routerCode.replace('window.Router =', 'export const Router =');
fs.writeFileSync(path.join(baseDir, 'router.js'), routerCode);

// Pages
const pages = fs.readdirSync(pagesDir).filter(f => f.endsWith('.js'));
for (const page of pages) {
  let pageCode = fs.readFileSync(path.join(pagesDir, page), 'utf8');
  pageCode = `import { API } from "../api.js";\nimport { Toast } from "../toast.js";\nimport { Router } from "../router.js";\n` + pageCode;
  fs.writeFileSync(path.join(pagesDir, page), pageCode);
}

// app.js
let appCode = fs.readFileSync(path.join(baseDir, 'app.js'), 'utf8');
appCode = appCode.replace('window.App =', 'const App =');
let imports = [
  `import { API } from "./api.js";`,
  `import { Auth } from "./auth.js";`,
  `import { Router } from "./router.js";`,
  `import { Toast } from "./toast.js";`
];
for (const page of pages) {
  imports.push(`import "./pages/${page}";`);
}
appCode = imports.join('\n') + '\n\n' + appCode;
fs.writeFileSync(path.join(baseDir, 'app.js'), appCode);

// index.html
let htmlCode = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
htmlCode = htmlCode.replace(/<script src="\/js\/api\.js"><\/script>\s*/, '');
htmlCode = htmlCode.replace(/<script src="\/js\/toast\.js"><\/script>\s*/, '');
htmlCode = htmlCode.replace(/<script src="\/js\/auth\.js"><\/script>\s*/, '');
htmlCode = htmlCode.replace(/<script src="\/js\/router\.js"><\/script>\s*/, '');
for (const page of pages) {
  htmlCode = htmlCode.replace(new RegExp(`<script src="\\/js\\/pages\\/${page}"><\\/script>\\s*`), '');
}
htmlCode = htmlCode.replace('<script src="/js/app.js"></script>', '<script type="module" src="/js/app.js"></script>');
fs.writeFileSync(path.join(__dirname, 'public', 'index.html'), htmlCode);

console.log('Frontend modernization completed');
