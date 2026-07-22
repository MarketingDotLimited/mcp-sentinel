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
  const matched = policy.rules.filter(rule => matches(rule, tool, identity));
  if (matched.some(rule => rule.effect === 'deny'))
    return { allowed: false, requireApproval: false, reason: 'This action is denied by server policy' };
  return { allowed: true, requireApproval: matched.some(rule => rule.effect === 'require_approval') };
}

export async function getPolicyStatus() {
  if (!POLICY_FILE) return { enabled: false, rules: 0 };
  const policy = await loadPolicy();
  return { enabled: true, rules: policy.rules.length, file: POLICY_FILE };
}
