import '../test-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolResultSchema } from '../../lib/tool-result-schemas.js';

test('tool-result-schemas', async t => {
  await t.test('returns schema for valid tool name', () => {
    const schema = toolResultSchema('get_system_info');
    assert(schema);
    assert.equal(typeof schema.parse, 'function');
  });

  await t.test('schema correctly parses valid input', () => {
    const schema = toolResultSchema('kill_process');
    const input = { success: true, message: 'Killed' };
    const result = schema.parse(input);
    assert.deepEqual(result, input);
  });

  await t.test('schema throws on invalid input', () => {
    const schema = toolResultSchema('kill_process');
    assert.throws(() => schema.parse({ success: 'not a boolean', message: 'Killed' }));
    assert.throws(() => schema.parse({ success: true })); // missing message
  });

  await t.test('returns schema for all defined tools', () => {
    const tools = [
      'get_system_info',
      'get_processes',
      'kill_process',
      'read_file',
      'write_file',
      'delete_file',
      'list_directory',
      'move_file',
      'copy_file',
      'get_file_info',
      'search_files',
      'manage_service',
      'get_service_status',
      'list_services',
      'get_journal_logs',
      'manage_firewall',
      'list_users',
      'get_user_info',
      'create_user',
      'delete_user',
      'set_user_password',
      'modify_user',
      'manage_ssh_keys',
      'run_sandboxed_code',
      'apply_config',
      'list_config_backups',
      'restore_config',
      'git_operation',
      'execute_query',
      'list_guided_workflows',
      'get_security_posture',
      'request_change_approval',
      'list_projects',
      'get_my_ssh_access',
      'set_my_ssh_access',
      'list_ssh_access_policies',
      'admin_set_ssh_access',
      'plan_project_deployment',
      'deploy_project',
      'subscribe_to_alert',
      'unsubscribe_from_alert',
      'list_active_alerts',
    ];

    for (const tool of tools) {
      assert(toolResultSchema(tool), `Missing schema for ${tool}`);
    }
  });

  await t.test('throws for unknown tool name', () => {
    // Note: the source file uses /* c8 ignore next */ for the throw line,
    // but we should still test it to follow the user instructions.
    assert.throws(() => toolResultSchema('unknown_tool'), {
      message: "Tool 'unknown_tool' has no declared output schema",
    });
  });
});
