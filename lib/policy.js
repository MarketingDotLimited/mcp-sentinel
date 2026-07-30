// ============================================================
//  lib/policy.js - optional policy-as-code enforcement
// ============================================================
import fs from 'fs/promises';

const POLICY_FILE = process.env.MCP_POLICY_FILE || '';
let cachedPolicy = { rules: [] };
let cachedMtime = 0;

function matches(rule, tool, identity) {
  const tools = Array.isArray(rule.tools) ? rule.tools : [];
  const roles = Array.isArray(rule.roles) ? rule.roles : ['*'];
  return (tools.includes('*') || tools.includes(tool)) && (roles.includes('*') || roles.includes(identity.role));
}

function matchingRules(policy, tool, identity) {
  return policy.rules.filter(rule => matches(rule, tool, identity));
}

async function loadPolicy() {
  if (!POLICY_FILE) return { rules: [] };
  try {
    const stat = await fs.stat(POLICY_FILE);
    if (stat.mtimeMs === cachedMtime) return cachedPolicy;
    const parsed = JSON.parse(await fs.readFile(POLICY_FILE, 'utf8'));
    if (
      !parsed ||
      !Array.isArray(parsed.rules) ||
      !parsed.rules.every(rule => ['deny', 'require_approval'].includes(rule.effect) && Array.isArray(rule.tools))
    ) {
      throw new Error('Policy must contain rules with an effect and tools array');
    }
    cachedMtime = stat.mtimeMs;
    cachedPolicy = parsed;
    return parsed;
  } catch (error) {
    throw new Error(`Policy configuration is invalid: ${error.message}`);
  }
}

export async function evaluatePolicy({ tool, identity }) {
  const policy = await loadPolicy();
  const matched = matchingRules(policy, tool, identity);
  if (matched.some(rule => rule.effect === 'deny'))
    return { allowed: false, requireApproval: false, reason: 'This action is denied by server policy' };
  return { allowed: true, requireApproval: matched.some(rule => rule.effect === 'require_approval') };
}

// Explain policy evaluation without exposing the policy file contents. This is
// intentionally read-only and is suitable for an administrator-facing policy
// simulator and audit records.
export async function simulatePolicy({ tool, identity }) {
  if (typeof tool !== 'string' || !/^[a-z][a-z0-9_]{1,127}$/.test(tool)) throw new Error('Invalid tool');
  if (!identity || typeof identity !== 'object' || typeof identity.role !== 'string')
    throw new Error('A role-bearing identity is required');
  const policy = await loadPolicy();
  const matched = matchingRules(policy, tool, identity);
  const denied = matched.find(rule => rule.effect === 'deny');
  const approval = matched.some(rule => rule.effect === 'require_approval');
  return {
    tool,
    identity: {
      role: identity.role,
      userId: identity.userId || null,
      oauthClient: identity.oauthClient || null,
      oauthSubject: identity.oauthSubject || null,
    },
    allowed: !denied,
    requireApproval: !denied && approval,
    reason: denied
      ? 'This action is denied by server policy'
      : approval
        ? 'This action requires administrator approval'
        : 'No matching deny or approval rule applies',
    matchedRules: matched.map(rule => ({ effect: rule.effect, tools: rule.tools, roles: rule.roles || ['*'] })),
    evaluatedAt: new Date().toISOString(),
  };
}

export async function getPolicyStatus() {
  if (!POLICY_FILE) return { enabled: false, rules: 0 };
  const policy = await loadPolicy();
  return { enabled: true, rules: policy.rules.length, file: POLICY_FILE };
}
