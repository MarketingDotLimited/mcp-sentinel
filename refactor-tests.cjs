const fs = require('fs');
const path = require('path');

const fileMappings = {
  // Unit tests
  'acme.test.js': 'tests/unit/',
  'admin-state.test.js': 'tests/unit/',
  'audit.test.js': 'tests/unit/',
  'authelia-client.test.js': 'tests/unit/',
  'capabilities.test.js': 'tests/unit/',
  'credentials.test.js': 'tests/unit/',
  'database-execution.test.js': 'tests/unit/',
  'database-security.test.js': 'tests/unit/',
  'deployment-profile.test.js': 'tests/unit/',
  'deployment.test.js': 'tests/unit/',
  'docker.test.js': 'tests/unit/',
  'exec.test.js': 'tests/unit/',
  'files.test.js': 'tests/unit/',
  'job-queue.test.js': 'tests/unit/',
  'key-provider.test.js': 'tests/unit/',
  'keystore.test.js': 'tests/unit/',
  'legacy-removal.test.js': 'tests/unit/',
  'monitor.test.js': 'tests/unit/',
  'oauth-mappings-store.test.js': 'tests/unit/',
  'oauth-token-policy.test.js': 'tests/unit/',
  'policy-simulator.test.js': 'tests/unit/',
  'policy.test.js': 'tests/unit/',
  'production-preflight.test.js': 'tests/unit/',
  'project-operation-dispatcher.test.js': 'tests/unit/',
  'project-tests.test.js': 'tests/unit/',
  'register-node-project.test.js': 'tests/unit/',
  'remote-operation-policy.test.js': 'tests/unit/',
  'sandbox-runtime.test.js': 'tests/unit/',
  'security-auth.test.js': 'tests/unit/',
  'security-branches.test.js': 'tests/unit/',
  'security-branches2.test.js': 'tests/unit/',
  'security-branches3.test.js': 'tests/unit/',
  'security-coverage.test.js': 'tests/unit/',
  'security-legacy.test.js': 'tests/unit/',
  'security-oidc-branches.test.js': 'tests/unit/',
  'security-oidc-edges.test.js': 'tests/unit/',
  'security-oidc-edges2.test.js': 'tests/unit/',
  'security-oidc-edges3.test.js': 'tests/unit/',
  'security-oidc-edges4.test.js': 'tests/unit/',
  'security-oidc.test.js': 'tests/unit/',
  'security-sqlite-error2.test.js': 'tests/unit/',
  'security-sqlite-state.test.js': 'tests/unit/',
  'security.test.js': 'tests/unit/',
  'slo.test.js': 'tests/unit/',
  'smoke.test.js': 'tests/unit/',
  'sqlite-state.test.js': 'tests/unit/',
  'ssh-control-plane.test.js': 'tests/unit/',
  'ssh-gateway-client.test.js': 'tests/unit/',
  'ssh-policy.test.js': 'tests/unit/',
  'state-backup.test.js': 'tests/unit/',
  'state-crypto.test.js': 'tests/unit/',
  'system.test.js': 'tests/unit/',
  'telemetry.test.js': 'tests/unit/',
  'users.test.js': 'tests/unit/',
  'webauthn.test.js': 'tests/unit/',

  // Integration tests
  'broker-integration.test.js': 'tests/integration/',
  'broker-missing.test.js': 'tests/integration/',
  'broker-protected.test.js': 'tests/integration/',
  'authelia-broker-state.test.js': 'tests/integration/',
  'control-plane-sqlite.test.js': 'tests/integration/',
  'broker.test.js': 'tests/integration/',
  'control-plane.test.js': 'tests/integration/',

  // MCP Contracts
  'file-tools-broker-client.test.js': 'tests/mcp-contracts/',
  'tool-result-schemas.test.js': 'tests/mcp-contracts/',
  'tools-git.test.js': 'tests/mcp-contracts/',
  'tools-rollback.test.js': 'tests/mcp-contracts/',
  'tools-services.test.js': 'tests/mcp-contracts/',

  // Server Contracts
  'node-gateway.test.js': 'tests/server-contracts/',
  'server-routes.test.js': 'tests/server-contracts/',
  'server.test.js': 'tests/server-contracts/',
  'routes-core.test.js': 'tests/server-contracts/',
  'server-mcp-tools.test.js': 'tests/server-contracts/',
  'routes-auth.test.js': 'tests/server-contracts/',
  'server-coverage.test.js': 'tests/server-contracts/',

  // Scripts
  'scripts-coverage.test.js': 'tests/scripts/',

  // Privileged
  'broker-final-coverage.test.js': 'tests/privileged/',
  'broker-client.test.js': 'tests/privileged/',
  'admin-broker-dependency.test.js': 'tests/privileged/',
  'control-plane-eacces.test.js': 'tests/privileged/',
  'broker-final.test.js': 'tests/privileged/',
  'live-mcp-e2e.test.js': 'tests/privileged/',

  // Browser
  'ui-e2e.test.js': 'tests/browser/',
};

// Remove the dirty subdirs
for (const d of ['tests/unit', 'tests/integration', 'tests/mcp-contracts', 'tests/server-contracts', 'tests/scripts', 'tests/privileged']) {
  fs.rmSync(d, { recursive: true, force: true });
}

// Ensure test-env exists from checkout
if (!fs.existsSync('tests/test-env.js')) {
  console.log('test-env missing!');
  process.exit(1);
}

Object.entries(fileMappings).forEach(([file, targetDir]) => {
  const src = path.join('tests', file);
  const dest = path.join(targetDir, file);
  fs.mkdirSync(targetDir, { recursive: true });

  if (fs.existsSync(src)) {
    let content = fs.readFileSync(src, 'utf8');

    // Make a safe AST-like replacement using precise regex boundaries for relative paths
    // 1. Static imports / mock.module
    content = content.replace(/(import\s+.*from\s+|import\s+|mock\.module\(\s*)['"]\.\.\/([^'"]+)['"]/g, '$1"../../$2"');
    content = content.replace(/(import\s+.*from\s+|import\s+|mock\.module\(\s*)['"]\.\/([^'"]+)['"]/g, '$1"../$2"');
    
    // 2. Dynamic imports
    content = content.replace(/import\(\s*['"]\.\.\/([^'"]+)['"]\s*\)/g, 'import("../../$1")');
    content = content.replace(/import\(\s*['"]\.\/([^'"]+)['"]\s*\)/g, 'import("../$1")');
    
    // 3. Template literal dynamic imports
    content = content.replace(/import\(\s*`\.\.\/([^`]+)`\s*\)/g, 'import(`../../$1`)');
    content = content.replace(/import\(\s*`\.\/([^`]+)`\s*\)/g, 'import(`../$1`)');

    // 4. Require statements
    content = content.replace(/require\(\s*['"]\.\.\/([^'"]+)['"]\s*\)/g, 'require("../../$1")');
    content = content.replace(/require\(\s*['"]\.\/([^'"]+)['"]\s*\)/g, 'require("../$1")');
    
    // 5. Hardcoded __dirname path.joins pointing one level up
    content = content.replace(/path\.join\(\s*__dirname,\s*['"]\.\.\/([^'"]+)['"]\s*\)/g, 'path.join(__dirname, "../../$1")');

    fs.writeFileSync(dest, content);
    fs.rmSync(src);
  }
});

console.log('Refactor complete.');
