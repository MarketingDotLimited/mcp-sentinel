import crypto from 'crypto';

const counters = new Map();
const durations = new Map();

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

export function telemetryMiddleware(req, res, next) {
  const id = requestId(req);
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  const started = process.hrtime.bigint();
  res.once('finish', () => {
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    incrementMetric('sentinel_http_requests_total', {
      method: req.method,
      route: req.route?.path || req.path,
      status: res.statusCode,
    });
    observeDuration('sentinel_http_request_duration_seconds', seconds, {
      method: req.method,
      route: req.route?.path || req.path,
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
}
