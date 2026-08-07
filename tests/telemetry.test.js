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
  telemetryMiddleware,
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

  it('requestId handles missing, invalid, and lack of get function', () => {
    // Missing get
    assert.match(requestId({}), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // Invalid characters
    assert.match(
      requestId({ get: () => 'invalid!@#' }),
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    // Too long
    assert.match(
      requestId({ get: () => 'a'.repeat(129) }),
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    // Missing value
    assert.match(requestId({ get: () => '' }), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('incrementMetric throws on invalid name', () => {
    assert.throws(() => incrementMetric('1invalid'), /Invalid metric name/);
  });

  it('observeDuration ignores invalid or negative seconds', () => {
    resetTelemetryForTests();
    observeDuration('test_dur', -1);
    observeDuration('test_dur', NaN);
    observeDuration('test_dur', Infinity);
    assert.doesNotMatch(metricsText(), /test_dur/);
  });

  it('ensureFlushTimer flushes telemetry on interval', async () => {
    resetTelemetryForTests();
    const originalSetInterval = global.setInterval;
    try {
      global.setInterval = cb => {
        // execute callback immediately
        setTimeout(cb, 10);
        return 123;
      };

      // Valid endpoint
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:9999';
      global.fetch = async () => {
        throw new Error('mock fetch failed');
      };

      // Call queueSpan to trigger ensureFlushTimer
      queueSpan({ name: 'timer-test' });

      // Wait for the promise in catch to resolve
      await new Promise(resolve => setTimeout(resolve, 50));

      assert.match(metricsText(), /sentinel_telemetry_export_failures_total\{\} 1/);
    } finally {
      global.setInterval = originalSetInterval;
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      resetTelemetryForTests();
    }
  });

  it('exporterEndpoint handles invalid URLs gracefully', () => {
    resetTelemetryForTests();
    // Test the new URL() catch block
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'not a valid url';
    assert.equal(queueSpan({ name: 'test' }), false);

    // Test the protocol filter
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'ftp://127.0.0.1';
    assert.equal(queueSpan({ name: 'test' }), false);

    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  it('exports bounded OTLP spans only when explicitly configured', async () => {
    resetTelemetryForTests();
    const originalFetch = global.fetch;
    try {
      let receivedBody = null;
      global.fetch = async (url, options) => {
        receivedBody = JSON.parse(options.body);
        return { ok: true, status: 200, text: async () => '' };
      };

      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:9999`;
      assert.equal(queueSpan({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), name: 'test', kind: 1 }), true);
      const result = await flushTelemetry();

      assert.equal(result.sent, 1);
      assert.equal(receivedBody.resourceSpans[0].scopeSpans[0].spans[0].name, 'test');
    } finally {
      global.fetch = originalFetch;
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      resetTelemetryForTests();
    }
  });

  it('handles export failures and drops spans when exceeding MAX_SPANS (1000)', async () => {
    resetTelemetryForTests();
    const originalFetch = global.fetch;
    try {
      // Mock fetch to always throw, simulating network failure
      global.fetch = async () => {
        throw new Error('Fetch failed');
      };

      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:9999';

      // We will manually queue 1050 spans.
      // Every 50 spans, queueSpan will call flushTelemetry, which will call our mocked fetch.
      // The mocked fetch rejects, which causes flushTelemetry to catch the error,
      // unshift the 50 spans back, and splice the queue down to 1000.
      const flushes = [];
      for (let i = 0; i < 1050; i++) {
        queueSpan({ name: `drop-test-${i}` });
      }

      // We need to wait a tick for all the flushTelemetry promises to settle
      await new Promise(resolve => setTimeout(resolve, 50));

      const text = metricsText();

      // Because we queued 1050 spans, there were 21 synchronous calls to flushTelemetry.
      // Each of them threw 'Fetch failed', incrementing failures to 21.
      assert.match(text, /sentinel_telemetry_export_failures_total\{\} 21/);

      // The queue size should be maxed out at 1000 now.
      // If we queue one more, it will immediately drop one because MAX_SPANS is 1000.
      queueSpan({ name: 'one-more' });
      assert.match(metricsText(), /sentinel_telemetry_dropped_spans_total\{\} 1/);

      // Test the non-ok HTTP response path as well
      global.fetch = async () => ({ ok: false, status: 503 });
      const result = await flushTelemetry();
      assert.equal(result.sent, 0);
      assert.match(result.error, /HTTP 503/);
    } finally {
      global.fetch = originalFetch;
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      resetTelemetryForTests();
    }
  });

  it('telemetryMiddleware tracks requests and durations', () => {
    resetTelemetryForTests();
    const req = { method: 'GET', route: { path: '/test' }, get: () => 'my-req' };
    const res = {
      statusCode: 200,
      setHeader: () => {},
      once: (event, cb) => {
        if (event === 'finish') {
          setTimeout(cb, 10);
        }
      },
    };

    // Call the middleware
    telemetryMiddleware(req, res, () => {});

    // wait for finish event
    return new Promise(resolve => {
      setTimeout(() => {
        const text = metricsText();
        assert.match(text, /sentinel_http_requests_total\{method=GET,route=_test,status=200\} 1/);
        assert.match(text, /sentinel_http_request_duration_seconds_count\{method=GET,route=_test\} 1/);
        resolve();
      }, 50);
    });
  });

  it('telemetryMiddleware tracks requests and durations using req.path fallback', () => {
    resetTelemetryForTests();
    const req = { method: 'POST', path: '/fallback', get: () => 'my-req-2' };
    const res = {
      statusCode: 404,
      setHeader: () => {},
      once: (event, cb) => {
        if (event === 'finish') {
          setTimeout(cb, 10);
        }
      },
    };

    // Call the middleware
    telemetryMiddleware(req, res, () => {});

    // wait for finish event
    return new Promise(resolve => {
      setTimeout(() => {
        const text = metricsText();
        assert.match(text, /sentinel_http_requests_total\{method=POST,route=_fallback,status=404\} 1/);
        resolve();
      }, 50);
    });
  });

  it('flushTelemetry returns early if queue is empty', async () => {
    resetTelemetryForTests();
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:9999`;
    const result = await flushTelemetry();
    assert.equal(result.sent, 0);
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    resetTelemetryForTests();
  });
});
