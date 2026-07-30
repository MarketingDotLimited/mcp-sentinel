// Service-level objectives are intentionally declarative. Operators can export
// these definitions to their self-hosted telemetry system without Sentinel
// inventing an availability claim from an incomplete local time window.
export const SLO_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'api-availability', objective: 0.995, window: '30d', indicator: 'http_non_5xx_ratio' }),
  Object.freeze({ id: 'broker-latency', objective: 0.99, window: '30d', indicator: 'broker_request_under_1s_ratio' }),
  Object.freeze({
    id: 'job-completion',
    objective: 0.99,
    window: '30d',
    indicator: 'jobs_terminal_before_deadline_ratio',
  }),
  Object.freeze({
    id: 'test-completion',
    objective: 0.98,
    window: '30d',
    indicator: 'tests_terminal_before_timeout_ratio',
  }),
  Object.freeze({ id: 'rollback-success', objective: 1, window: '90d', indicator: 'healthy_rollback_ratio' }),
]);

export function getSloDefinitions() {
  return SLO_DEFINITIONS.map(definition => ({ ...definition }));
}
