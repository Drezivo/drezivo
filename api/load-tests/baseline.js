import http from 'k6/http';
import { check, sleep } from 'k6';

// Only explicit staging/preview or loopback hosts are accepted. Never point this at production.
const origin = __ENV.STAGING_API_ORIGIN;
if (!origin || __ENV.CONFIRM_STAGING !== 'true') {
  throw new Error('Set STAGING_API_ORIGIN and CONFIRM_STAGING=true for a synthetic-data environment.');
}
const match = /^(https?):\/\/([a-z0-9.-]+)(?::[0-9]{1,5})?\/?$/i.exec(origin);
const host = match ? match[2].toLowerCase() : '';
if (!match ||
    !(/(^|[.-])(staging|preview)([.-]|$)/.test(host) || host === 'localhost' || host === '127.0.0.1')) {
  throw new Error('STAGING_API_ORIGIN must be an origin with a staging/preview or loopback host.');
}
if (match[1].toLowerCase() !== 'https' && host !== 'localhost' && host !== '127.0.0.1') {
  throw new Error('Non-local staging requests require HTTPS.');
}

const mode = __ENV.SCENARIO || 'health';
const allowed = ['health', 'dashboard', 'availability', 'reservation'];
if (!allowed.includes(mode)) throw new Error('Unknown SCENARIO.');
if (mode !== 'health' && !__ENV.STAGING_BEARER_TOKEN) throw new Error('STAGING_BEARER_TOKEN is required.');
if (mode === 'availability' && !__ENV.AVAILABILITY_QUERY) throw new Error('AVAILABILITY_QUERY is required.');
if (mode === 'reservation' && !__ENV.RESERVATION_BODY) throw new Error('RESERVATION_BODY is required.');

const paths = {
  health: '/health',
  dashboard: '/api/v1/dashboard/overview',
  availability: '/api/v1/reservations/availability-check',
  reservation: '/api/v1/reservations',
};
const path = paths[mode];
const limit = mode === 'availability' ? 500 : 1000;
export const options = {
  vus: Number(__ENV.VUS || 1),
  duration: __ENV.DURATION || '1m',
  // Do not export raw URLs or query values as metric tags.
  systemTags: ['status', 'method', 'name', 'check', 'error_code', 'scenario', 'expected_response'],
  summaryTrendStats: ['count', 'avg', 'med', 'p(95)', 'p(99)'],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    ...(mode === 'availability' || mode === 'reservation' ? { http_req_duration: [`p(95)<${limit}`] } : {}),
  },
};

export default function () {
  const headers = { 'Content-Type': 'application/json' };
  if (mode !== 'health') headers.Authorization = `Bearer ${__ENV.STAGING_BEARER_TOKEN}`;
  if (__ENV.STAGING_BRANCH_ID) headers['X-Drezivo-Branch-Id'] = __ENV.STAGING_BRANCH_ID;
  if (mode === 'reservation') headers['Idempotency-Key'] = crypto.randomUUID();
  const query = mode === 'availability' ? `?${__ENV.AVAILABILITY_QUERY}` : '';
  const response = http.request(mode === 'reservation' ? 'POST' : 'GET', `${origin.replace(/\/$/, '')}${path}${query}`,
    mode === 'reservation' ? __ENV.RESERVATION_BODY : null,
    { headers, tags: { name: path }, redirects: 0 });
  check(response, {
    'returns a successful response': (result) => result.status >= 200 && result.status < 300,
    'returns the expected success envelope': (result) => {
      try {
        const body = result.json();
        return mode === 'health' ? body.status === 'ok' : body.success === true;
      } catch { return false; }
    },
  });
  sleep(Number(__ENV.PAUSE_SECONDS || 3));
}
