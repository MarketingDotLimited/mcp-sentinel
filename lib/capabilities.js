// Capability packs keep the default MCP surface focused and let owners opt in
// to specialist operations without changing existing API keys.
import fs from 'fs/promises';
import path from 'path';

const FILE = process.env.MCP_CAPABILITIES_FILE || path.join(process.cwd(), 'data', 'capabilities.json');

export const CAPABILITY_PACKS = {
  'core-server-care': {
    title: 'Server Care', defaultEnabled: true,
    description: 'Health, logs, approved service/configuration work, approvals, and audit review.',
  },
  'core-developer-work': {
    title: 'Developer Work', defaultEnabled: true,
    description: 'Approved projects, repository inspection, and constrained file work.',
  },
  'advanced-system-admin': {
    title: 'Advanced System Administration', defaultEnabled: false,
    description: 'User accounts, SSH keys, firewall rules, and process signals.',
  },
  'advanced-data': {
    title: 'Advanced Data Access', defaultEnabled: false,
    description: 'Raw SQL access to explicitly configured database aliases.',
  },
  'advanced-execution': {
    title: 'Advanced Execution', defaultEnabled: false,
    description: 'Arbitrary sandbox execution and direct deployment actions.',
  },
};

const LEGACY_TOOLS = new Set([
  'list_automations', 'schedule_health_check', 'list_fleet_servers', 'check_fleet_server',
  'list_backup_targets', 'run_encrypted_backup', 'list_webhooks', 'deliver_webhook',
]);
const DEPRECATED_TOOLS = new Set([...LEGACY_TOOLS, 'deploy_project']);

const TOOL_PACKS = {
  get_system_info: 'core-server-care', get_processes: 'core-server-care',
  get_service_status: 'core-server-care', list_services: 'core-server-care', get_journal_logs: 'core-server-care',
  manage_service: 'core-server-care', apply_config: 'core-server-care', list_config_backups: 'core-server-care', restore_config: 'core-server-care',
  list_guided_workflows: 'core-server-care', get_security_posture: 'core-server-care', request_change_approval: 'core-server-care',
  subscribe_to_alert: 'core-server-care', unsubscribe_from_alert: 'core-server-care', list_active_alerts: 'core-server-care',
  read_file: 'core-developer-work', write_file: 'core-developer-work', delete_file: 'core-developer-work', list_directory: 'core-developer-work',
  move_file: 'core-developer-work', copy_file: 'core-developer-work', get_file_info: 'core-developer-work', search_files: 'core-developer-work',
  git_operation: 'core-developer-work', list_projects: 'core-developer-work', plan_project_deployment: 'core-developer-work',
  kill_process: 'advanced-system-admin', manage_firewall: 'advanced-system-admin', list_users: 'advanced-system-admin',
  get_user_info: 'advanced-system-admin', create_user: 'advanced-system-admin', delete_user: 'advanced-system-admin',
  set_user_password: 'advanced-system-admin', modify_user: 'advanced-system-admin', manage_ssh_keys: 'advanced-system-admin',
  execute_query: 'advanced-data', run_sandboxed_code: 'advanced-execution', deploy_project: 'advanced-execution',
};

let statePromise;
function defaults() { return Object.fromEntries(Object.entries(CAPABILITY_PACKS).map(([id, pack]) => [id, pack.defaultEnabled])); }
async function load() {
  if (!statePromise) statePromise = (async () => {
    try {
      const parsed = JSON.parse(await fs.readFile(FILE, 'utf8')) || {};
      return { ...parsed, enabled: { ...defaults(), ...(parsed.enabled || {}) } };
    }
    catch (error) { if (error.code === 'ENOENT') return { enabled: defaults() }; throw error; }
  })();
  return statePromise;
}

export function isDeprecatedTool(name) { return DEPRECATED_TOOLS.has(name); }
export function isLegacyTool(name) { return LEGACY_TOOLS.has(name); }
async function save(state) {
  await fs.mkdir(path.dirname(FILE), { recursive: true, mode: 0o700 });
  const temp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
  await fs.rename(temp, FILE); await fs.chmod(FILE, 0o600);
}

export async function getCapabilities() {
  const state = await load();
  return Object.entries(CAPABILITY_PACKS).map(([id, pack]) => ({ id, ...pack, enabled: state.enabled[id] === true }));
}
export async function setCapability(id, enabled) {
  if (!(id in CAPABILITY_PACKS)) throw new Error('Unknown capability pack');
  if (typeof enabled !== 'boolean') throw new Error('enabled must be true or false');
  if (CAPABILITY_PACKS[id].defaultEnabled && !enabled) throw new Error('Core capability packs must remain enabled');
  const state = await load(); state.enabled[id] = enabled; await save(state);
  return getCapabilities();
}
export async function toolAvailability(name) {
  if (LEGACY_TOOLS.has(name)) return { available: true, deprecated: true, message: 'This legacy capability is deprecated and will be removed after the next minor release.' };
  const pack = TOOL_PACKS[name];
  if (!pack) return { available: true, deprecated: false, pack: null };
  const state = await load();
  return state.enabled[pack] === true
    ? { available: true, deprecated: DEPRECATED_TOOLS.has(name), pack, ...(DEPRECATED_TOOLS.has(name) ? { message: 'Direct deployment is deprecated; use deployment planning unless an administrator explicitly enables Advanced Execution.' } : {}) }
    : { available: false, deprecated: false, pack, message: `The ${CAPABILITY_PACKS[pack].title} capability pack is disabled. An administrator can enable it in Administration.` };
}
