// -----------------------------------------------------------------------------
// A fake OpenDTU behind a fake `fetch`: it answers the paths of the web API
// the way the firmware builds them (src/WebApi_*.cpp), records every call,
// checks the Basic auth like WebApi::checkCredentials, and fails loudly on an
// unexpected request. No test touches the network.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { setFetch } from '../../src/http.js';

setFetch(async (url) => {
  throw new Error(`Network call without a fake OpenDTU in a test: ${url}`);
});

export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}

/**
 * 2026-10-14 13:00 in Paris, a sunny early afternoon. The test files set
 * TZ=Europe/Paris (the container runs in the timezone of Gladys).
 */
export const NOW = Date.UTC(2026, 9, 14, 11, 0, 0);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const COMMON = [
  'serial',
  'name',
  'order',
  'data_age',
  'data_age_ms',
  'poll_enabled',
  'reachable',
  'producing',
  'limit_relative',
  'limit_absolute',
  'radio_stats',
];

/** The summary of an inverter, as recent firmwares list it without ?inv=. */
export const summaryOf = (inverter) =>
  Object.fromEntries(Object.entries(inverter).filter(([key]) => COMMON.includes(key)));

/** Put an inverter to sleep: OpenDTU keeps its last values (no "zero runtime data"). */
export function asleep(inverter, ageSeconds = 3600) {
  inverter.reachable = false;
  inverter.producing = false;
  inverter.data_age = ageSeconds;
  inverter.data_age_ms = ageSeconds * 1000;
}

/** Wake an inverter up with a new AC power (W) and day yield (Wh). */
export function awake(inverter, power, yieldDayWh) {
  inverter.reachable = true;
  inverter.producing = power > 0;
  inverter.data_age = 2;
  inverter.data_age_ms = 2000;
  inverter.AC['0'].Power.v = power;
  if (yieldDayWh !== undefined) {
    inverter.INV['0'].YieldDay.v = yieldDayWh;
  }
}

/**
 * Install the fake. options: { firmware: 'recent' | 'inline', password,
 * readonly (false: reads need the password too) }.
 */
export function installOpenDtu(options = {}) {
  const { firmware = 'recent', password = 'secret123', readonly = true } = options;
  const live = fixture('livedata.json');
  const state = {
    live,
    limits: fixture('limit-status.json'),
    devinfo: fixture('devinfo.json'),
    system: fixture('system-status.json'),
    eventlogs: { 114190000001: fixture('eventlog.json') },
    posts: [],
    down: false,
  };
  const calls = [];
  const inverter = (serial) => state.live.inverters.find((i) => i.serial === serial);
  const authorized = (headers = {}) =>
    headers.Authorization === `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`;

  const previous = setFetch(async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const call = {
      method,
      path: u.pathname,
      params: Object.fromEntries(u.searchParams),
      headers: init.headers ?? {},
      body: init.body,
      redirect: init.redirect,
    };
    calls.push(call);
    if (state.down) {
      throw new TypeError('fetch failed', { cause: { code: 'EHOSTUNREACH' } });
    }
    const write = method === 'POST' || u.pathname === '/api/security/authenticate';
    if ((write || !readonly) && !authorized(call.headers)) {
      return new Response('', { status: 401 });
    }
    const serial = call.params.inv;
    switch (`${method} ${u.pathname}`) {
      case 'GET /api/livedata/status': {
        const { total, hints } = state.live;
        if (serial) {
          const inv = inverter(serial);
          return json({ inverters: inv ? [inv] : [], total, hints });
        }
        const inverters =
          firmware === 'inline' ? state.live.inverters : state.live.inverters.map(summaryOf);
        return json({ inverters, total, hints });
      }
      case 'GET /api/limit/status':
        return json(state.limits);
      case 'GET /api/devinfo/status':
        return json(state.devinfo[serial] ?? {});
      case 'GET /api/eventlog/status':
        return json(state.eventlogs[serial] ?? { count: 0, events: [] });
      case 'GET /api/system/status':
        return json(state.system);
      case 'GET /api/security/authenticate':
        return json({ type: 'success', message: 'Authentication successful!', code: 10002 });
      case 'POST /api/limit/config':
      case 'POST /api/power/config': {
        const data = JSON.parse(new URLSearchParams(init.body).get('data'));
        state.posts.push({ path: u.pathname, data, contentType: call.headers['Content-Type'] });
        if (!inverter(data.serial)) {
          return json({ type: 'warning', message: 'Invalid inverter specified!', code: 5004 });
        }
        return json({ type: 'success', message: 'Settings saved!', code: 1001 });
      }
      default:
        throw new Error(`Unexpected OpenDTU request in a test: ${method} ${url}`);
    }
  });
  return {
    state,
    calls,
    inverter,
    count: (path, params = {}) =>
      calls.filter(
        (c) => c.path === path && Object.entries(params).every(([k, v]) => c.params[k] === v),
      ).length,
    restore: () => setFetch(previous),
  };
}
