import crypto from 'crypto';

const counters = new Map();
const durations = new Map();
const spanQueue = [];
const MAX_SPANS = 1000;
const SPAN_KIND_SERVER = 1;
let flushTimer;

function exporterEndpoint() {
  const value = String(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '')
    .trim()
    .replace(/\/$/, '');
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  return `${url.toString().replace(/\/$/, '')}/v1/traces`;
}

function ensureFlushTimer() {
  if (flushTimer || !exporterEndpoint()) return;
  flushTimer = setInterval(() => {
    flushTelemetry().catch(() => {});
  }, 5000);
  flushTimer.unref?.();
}

function labelKey(labels = {}) {
  return Object.keys(labels)
    .sort()
    .map(key => `${key}=${String(labels[key]).replace(/[^a-zA-Z0-9_.:-]/g, '_')}`)
    .join(',');
}

export function requestId(req) {
  const supplied = String(req.get?.('x-request-id') || '').trim();
  return /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : crypto.randomUUID();
}

export function incrementMetric(name, labels = {}, value = 1) {
  if (!/^[a-z][a-z0-9_]{0,127}$/.test(name)) throw new Error('Invalid metric name');
  const key = `${name}{${labelKey(labels)}}`;
  counters.set(key, (counters.get(key) || 0) + Number(value));
}

export function observeDuration(name, seconds, labels = {}) {
  if (!Number.isFinite(seconds) || seconds < 0) return;
  const key = `${name}{${labelKey(labels)}}`;
  const entry = durations.get(key) || { count: 0, sum: 0 };
  entry.count += 1;
  entry.sum += seconds;
  durations.set(key, entry);
}

export function queueSpan(span) {
  if (!exporterEndpoint() || !span || typeof span !== 'object') return false;
  if (spanQueue.length >= MAX_SPANS) {
    spanQueue.shift();
    incrementMetric('sentinel_telemetry_dropped_spans_total');
  }
  spanQueue.push(span);
  ensureFlushTimer();
  if (spanQueue.length >= 50) flushTelemetry().catch(() => {});
  return true;
}

export async function flushTelemetry() {
  const endpoint = exporterEndpoint();
  if (!endpoint || !spanQueue.length) return { sent: 0 };
  const spans = spanQueue.splice(0, 50);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resourceSpans: [
          {
            resource: { attributes: [{ key: 'service.name', value: { stringValue: 'mcp-sentinel' } }] },
            scopeSpans: [{ scope: { name: 'mcp-sentinel.telemetry' }, spans }],
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OTLP exporter returned HTTP ${response.status}`);
    incrementMetric('sentinel_telemetry_exported_spans_total', {}, spans.length);
    return { sent: spans.length };
  } catch (error) {
    incrementMetric('sentinel_telemetry_export_failures_total');
    spanQueue.unshift(...spans);
    while (spanQueue.length > MAX_SPANS) spanQueue.shift();
    return { sent: 0, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

export function telemetryMiddleware(req, res, next) {
  const id = requestId(req);
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  const started = process.hrtime.bigint();
  res.once('finish', () => {
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    const endedAt = Date.now();
    const startedAt = endedAt - Math.round(seconds * 1000);
    incrementMetric('sentinel_http_requests_total', {
      method: req.method,
      route: req.route?.path || req.path,
      status: res.statusCode,
    });
    observeDuration('sentinel_http_request_duration_seconds', seconds, {
      method: req.method,
      route: req.route?.path || req.path,
    });
    queueSpan({
      traceId: crypto.randomBytes(16).toString('hex'),
      spanId: crypto.randomBytes(8).toString('hex'),
      name: `${req.method} ${req.route?.path || req.path}`,
      kind: SPAN_KIND_SERVER,
      startTimeUnixNano: `${startedAt}000000`,
      endTimeUnixNano: `${endedAt}000000`,
      attributes: [
        { key: 'http.request.method', value: { stringValue: req.method } },
        { key: 'http.response.status_code', value: { intValue: res.statusCode } },
        { key: 'http.route', value: { stringValue: req.route?.path || req.path } },
        { key: 'mcp.request.id', value: { stringValue: id } },
      ],
    });
  });
  next();
}

export function metricsText() {
  const lines = [
    '# HELP sentinel_http_requests_total Total HTTP responses.',
    '# TYPE sentinel_http_requests_total counter',
  ];
  for (const [key, value] of counters) lines.push(`${key} ${value}`);
  const durationNames = new Set([...durations.keys()].map(key => key.slice(0, key.indexOf('{'))));
  for (const name of durationNames) {
    lines.push(`# HELP ${name} Observed duration in seconds.`);
    lines.push(`# TYPE ${name} summary`);
  }
  for (const [key, value] of durations) {
    const metric = key.slice(0, key.indexOf('{'));
    const labels = key.slice(key.indexOf('{') + 1, -1);
    lines.push(`${metric}_count{${labels}} ${value.count}`);
    lines.push(`${metric}_sum{${labels}} ${value.sum}`);
  }
  return `${lines.join('\n')}\n`;
}

export function resetTelemetryForTests() {
  counters.clear();
  durations.clear();
  spanQueue.length = 0;
}
