import { secureExec } from '../lib/exec.js';

export async function gitOperation({ repoPath, action, args }, identity) {
  const allowedRepos = (process.env.GIT_ALLOWED_REPOS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (!allowedRepos.includes(repoPath)) {
    throw new Error(`Repository path '${repoPath}' is not in the allowed list (GIT_ALLOWED_REPOS)`);
  }

  const validActions = ['status', 'diff', 'log', 'branch', 'checkout', 'add', 'commit', 'pull', 'push'];
  if (!validActions.includes(action)) {
    throw new Error(`Invalid git action: ${action}. Allowed: ${validActions.join(', ')}`);
  }

  const cmdArgs = ['-C', repoPath, action];

  if (action === 'status') {
    cmdArgs.push('--short');
  } else if (action === 'log') {
    cmdArgs.push('-n', args?.n ? String(args.n) : '10', '--oneline');
  } else if (action === 'commit') {
    if (!args?.message) throw new Error('Commit requires a message argument');
    cmdArgs.push('-m', args.message, '--no-verify');
  } else if (action === 'add') {
    if (!args?.files) throw new Error('Add requires files argument');
    cmdArgs.push(...(Array.isArray(args.files) ? args.files : [args.files]));
  } else if (action === 'checkout') {
    if (!args?.branch && !args?.file) throw new Error('Checkout requires branch or file argument');
    if (args.b) cmdArgs.push('-b');
    cmdArgs.push(args.branch || args.file);
  } else if (action === 'push') {
    if (args?.force) {
      if (process.env.GIT_ALLOW_FORCE_PUSH !== 'true') {
        throw new Error('Force push is disabled by administrator (GIT_ALLOW_FORCE_PUSH)');
      }
      cmdArgs.push('--force');
    }
  } else if (action === 'pull') {
    // Deployments must not create an implicit merge commit on a production host.
    cmdArgs.push('--ff-only');
  }

  // Inject askpass for credentials
  const execOpts = { timeout: 30000 };
  if (process.env.GIT_CREDENTIAL_HELPER) {
    execOpts.env = {
      ...process.env,
      GIT_ASKPASS: process.env.GIT_ASKPASS_SCRIPT || 'echo',
    };
  }

  const { stdout, stderr } = await secureExec(['git', ...cmdArgs], identity, execOpts).catch(err => {
    throw new Error(`Git error: ${err.stderr || err.message}`);
  });

  return { action, repoPath, output: stdout.trim() || stderr.trim() || 'Success' };
}
