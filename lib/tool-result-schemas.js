import { z } from 'zod';

const object = shape => z.object(shape).passthrough();
const records = z.array(z.record(z.unknown()));
const fileInfo = object({
  projectId: z.string().uuid(),
  path: z.string(),
  type: z.enum(['file', 'directory', 'other']),
  size: z.number().nonnegative(),
});
const configResult = object({
  configId: z.string(),
  backup: z.string().nullable(),
  service: z.string(),
  healthy: z.boolean(),
});

const SCHEMAS = {
  get_system_info: object({
    hostname: z.string(),
    platform: z.string(),
    arch: z.string(),
    kernel: z.string(),
    uptime: z.string(),
    cpus: z.number().int().nonnegative(),
    cpu_model: z.string(),
    load_avg: z.string(),
    total_memory: z.string(),
    free_memory: z.string(),
    memory_usage: z.string(),
    disk_usage: z.string(),
    logged_in_users: z.string(),
    network_interfaces: z.union([z.string(), z.record(z.array(z.string()))]),
  }),
  get_processes: object({ processes: z.string() }),
  kill_process: object({ success: z.boolean(), message: z.string() }),
  read_file: object({
    projectId: z.string().uuid(),
    path: z.string(),
    content: z.string(),
    size: z.number().nonnegative(),
    readBytes: z.number().nonnegative(),
    truncated: z.boolean(),
  }),
  write_file: fileInfo,
  delete_file: object({ projectId: z.string().uuid(), deleted: z.string() }),
  list_directory: object({
    projectId: z.string().uuid(),
    path: z.string(),
    count: z.number().int().nonnegative(),
    entries: records,
  }),
  move_file: object({ projectId: z.string().uuid(), from: z.string(), to: z.string() }),
  copy_file: object({ projectId: z.string().uuid(), from: z.string(), to: z.string() }),
  get_file_info: fileInfo,
  search_files: object({
    projectId: z.string().uuid(),
    results: z.array(z.string()),
    count: z.number().int().nonnegative(),
  }),
  manage_service: object({ service: z.string(), action: z.string(), output: z.string() }),
  get_service_status: object({
    service: z.string(),
    active: z.string(),
    enabled: z.string(),
    status_output: z.string(),
    recent_logs: z.string(),
  }),
  list_services: object({ services: z.string(), count: z.number().int().nonnegative() }),
  get_journal_logs: object({ logs: z.string(), stderr: z.string().optional() }),
  manage_firewall: object({
    action: z.string().optional(),
    output: z.string().optional(),
    rollbackId: z.string().uuid().optional(),
    rollbackAt: z.string().datetime().optional(),
    confirmed: z.boolean().optional(),
  }),
  list_users: object({ users: records, count: z.number().int().nonnegative() }),
  get_user_info: object({ username: z.string(), uid: z.number().int(), gid: z.number().int() }),
  create_user: object({ username: z.string(), uid: z.number().int(), gid: z.number().int() }),
  delete_user: object({ username: z.string(), deleted: z.boolean(), homeRemoved: z.boolean() }),
  set_user_password: object({ username: z.string(), updated: z.boolean() }),
  modify_user: object({ username: z.string(), changes: z.array(z.string()) }),
  manage_ssh_keys: object({ username: z.string(), count: z.number().int().nonnegative() }),
  run_sandboxed_code: object({
    success: z.boolean(),
    exitCode: z.number().int().nullable(),
    durationMs: z.number().nonnegative(),
    network: z.enum(['denied', 'approved-egress']),
    timedOut: z.boolean(),
    truncated: z.boolean(),
    stdout: z.string(),
    stderr: z.string(),
  }),
  apply_config: configResult,
  list_config_backups: object({ configId: z.string(), backups: records }),
  restore_config: configResult,
  git_operation: object({ projectId: z.string().uuid(), action: z.string() }),
  execute_query: object({
    alias: z.string(),
    mode: z.enum(['read', 'write']),
    rowCount: z.number().int().nonnegative(),
    rows: z.array(z.unknown()).optional(),
    fields: z.array(z.string()).optional(),
    bytes: z.number().int().nonnegative().optional(),
    truncated: z.boolean().optional(),
  }),
  list_guided_workflows: object({ workflows: records }),
  get_security_posture: object({
    status: z.enum(['needs-attention', 'review-recommended', 'strong']),
    checks: records,
    generatedAt: z.string().datetime(),
  }),
  request_change_approval: object({ approvalId: z.string().uuid(), status: z.string(), message: z.string() }),
  list_projects: object({ projects: records }),
  plan_project_deployment: object({
    project: z.record(z.unknown()),
    approvalRequired: z.boolean(),
    steps: records,
  }),
  deploy_project: object({
    projectId: z.string().uuid(),
    project: z.string(),
    git: z.record(z.unknown()),
    service: z.record(z.unknown()),
    health: z.record(z.unknown()),
    rollback: z.string(),
  }),
  subscribe_to_alert: object({
    id: z.string(),
    alertType: z.string(),
    threshold: z.number(),
    persistent: z.boolean(),
  }),
  unsubscribe_from_alert: object({ alertId: z.string(), unsubscribed: z.boolean() }),
  list_active_alerts: object({ alerts: records }),
};

export function toolResultSchema(name) {
  const schema = SCHEMAS[name];
  if (!schema) throw new Error(`Tool '${name}' has no declared output schema`);
  return schema;
}
