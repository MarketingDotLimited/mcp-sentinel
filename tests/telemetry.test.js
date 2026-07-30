import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  flushTelemetry,
  incrementMetric,
  metricsText,
  observeDuration,
  queueSpan,
  requestId,
  resetTelemetryForTests,
} from '../lib/telemetry.js';

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

  it('exports bounded OTLP spans only when explicitly configured', async () => {
    resetTelemetryForTests();
    const received = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        received.push(JSON.parse(body));
        res.writeHead(200).end();
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${port}`;
    assert.equal(queueSpan({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), name: 'test', kind: 1 }), true);
    const result = await flushTelemetry();
    assert.equal(result.sent, 1);
    assert.equal(received[0].resourceSpans[0].scopeSpans[0].spans[0].name, 'test');
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    await new Promise(resolve => server.close(resolve));
    resetTelemetryForTests();
  });
});
