# MCP Sentinel — MCP Tool Traceability Matrix

This matrix maps every registered MCP tool to its implementation, tests,
and coverage status.

## Tool Coverage Matrix

| #   | Tool Name                  | Implementation      | Test File(s)                                              | Positive | Negative | Auth | Failure | Status        |
| --- | -------------------------- | ------------------- | --------------------------------------------------------- | -------- | -------- | ---- | ------- | ------------- |
| 1   | `get_system_info`          | `tools/system.js`   | `system.test.js`                                          | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 2   | `get_processes`            | `tools/system.js`   | `system.test.js`                                          | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 3   | `kill_process`             | `tools/system.js`   | `system.test.js`                                          | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 4   | `run_project_tests`        | `tools/system.js`   | `system.test.js`, `project-tests.test.js`                 | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 5   | `get_project_test_run`     | `tools/system.js`   | `system.test.js`, `project-tests.test.js`                 | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 6   | `cancel_project_test_run`  | `tools/system.js`   | `system.test.js`, `project-tests.test.js`                 | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 7   | `read_file`                | `tools/files.js`    | `files.test.js`, `file-tools-broker-client.test.js`       | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 8   | `write_file`               | `tools/files.js`    | `files.test.js`, `file-tools-broker-client.test.js`       | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 9   | `delete_file`              | `tools/files.js`    | `files.test.js`                                           | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 10  | `list_directory`           | `tools/files.js`    | `files.test.js`                                           | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 11  | `move_file`                | `tools/files.js`    | `files.test.js`                                           | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 12  | `copy_file`                | `tools/files.js`    | `files.test.js`                                           | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 13  | `get_file_info`            | `tools/files.js`    | `files.test.js`                                           | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 14  | `search_files`             | `tools/files.js`    | `files.test.js`                                           | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 15  | `manage_service`           | `tools/services.js` | `tools-services.test.js`                                  | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 16  | `get_service_status`       | `tools/services.js` | `tools-services.test.js`                                  | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 17  | `list_services`            | `tools/services.js` | `tools-services.test.js`                                  | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 18  | `get_journal_logs`         | `tools/services.js` | `tools-services.test.js`                                  | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 19  | `manage_firewall`          | `tools/services.js` | `tools-services.test.js`                                  | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 20  | `list_users`               | `tools/users.js`    | `users.test.js`                                           | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 21  | `get_user_info`            | `tools/users.js`    | `users.test.js`                                           | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 22  | `create_user`              | `tools/users.js`    | `users.test.js`                                           | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 23  | `delete_user`              | `tools/users.js`    | `users.test.js`                                           | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 24  | `set_user_password`        | `tools/users.js`    | `users.test.js`                                           | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 25  | `modify_user`              | `tools/users.js`    | `users.test.js`                                           | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 26  | `manage_ssh_keys`          | `tools/users.js`    | `users.test.js`                                           | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 27  | `run_sandboxed_code`       | `tools/docker.js`   | `docker.test.js`, `sandbox-runtime.test.js`               | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 28  | `apply_config`             | `tools/rollback.js` | `tools-rollback.test.js`                                  | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 29  | `list_config_backups`      | `tools/rollback.js` | `tools-rollback.test.js`                                  | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 30  | `restore_config`           | `tools/rollback.js` | `tools-rollback.test.js`                                  | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 31  | `git_operation`            | `tools/git.js`      | `tools-git.test.js`                                       | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 32  | `execute_query`            | `tools/db.js`       | `database-execution.test.js`, `database-security.test.js` | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 33  | `list_guided_workflows`    | `server.js`         | `server-coverage.test.js`, `control-plane.test.js`        | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 34  | `get_security_posture`     | `server.js`         | `server-coverage.test.js`, `security-coverage.test.js`    | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 35  | `request_change_approval`  | `server.js`         | `server-coverage.test.js`, `control-plane.test.js`        | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 36  | `list_projects`            | `server.js`         | `server-coverage.test.js`, `control-plane.test.js`        | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 37  | `get_my_ssh_access`        | `server.js`         | `ssh-policy.test.js`, `ssh-control-plane.test.js`         | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 38  | `set_my_ssh_access`        | `server.js`         | `ssh-policy.test.js`, `ssh-control-plane.test.js`         | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 39  | `list_ssh_access_policies` | `server.js`         | `ssh-policy.test.js`                                      | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 40  | `admin_set_ssh_access`     | `server.js`         | `ssh-policy.test.js`, `ssh-control-plane.test.js`         | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 41  | `plan_project_deployment`  | `server.js`         | `server-coverage.test.js`                                 | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 42  | `deploy_project`           | `server.js`         | `server-coverage.test.js`                                 | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 43  | `subscribe_to_alert`       | `server.js`         | `monitor.test.js`                                         | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 44  | `unsubscribe_from_alert`   | `server.js`         | `monitor.test.js`                                         | ✅       | ✅       | ✅   | ✅      | Fully covered |
| 45  | `list_active_alerts`       | `server.js`         | `monitor.test.js`                                         | ✅       | ✅       | ✅   | ✅      | Fully covered |

## Summary

- **Total MCP tools**: 45
- **Tools with dedicated tests**: 45 (100%)
- **Tools with positive tests**: 45 (100%)
- **Tools with negative tests**: 45 (100%)
- **Tools with auth tests**: 45 (100%)
- **Tools with failure tests**: 45 (100%)
- **Untested tools**: 0
