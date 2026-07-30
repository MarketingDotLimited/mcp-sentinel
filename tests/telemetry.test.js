import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { incrementMetric, metricsText, observeDuration, requestId, resetTelemetryForTests } from '../lib/telemetry.js';

describe('telemetry contract', () => {
  it('returns safe request IDs and Prometheus-compatible bounded metrics', () => {
    resetTelemetryForTests();
    const req = { get: () => 'client-request-1' };
    assert.equal(requestId(req), 'client-request-1');
    incrementMetric('sentinel_test_total', { result: 'pass' });
    observeDuration('sentinel_test_duration_seconds', 0.25, { result: 'pass' });
    const text = metricsText();
    assert.match(text, /sentinel_test_total\{result=pass\} 1/);
    assert.match(text, /sentinel_test_duration_seconds_count\{result=pass\} 1/);
    resetTelemetryForTests();
  });
});
