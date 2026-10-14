// -----------------------------------------------------------------------------
// The OpenDTU web API client (https://www.opendtu.solar/firmware/web_api/),
// as raw JSON. Every OpenDTU path and form field is here; turning the answers
// into readings is model.js's job.
//
// Authentication: HTTP Basic, user "admin", the password of the OpenDTU web
// interface. The reads need it only when "Allow read-only access" is off;
// the commands always need it. It is sent to the configured host only.
//
// Commands are POSTed as a form with one field, `data`, holding JSON (as the
// OpenDTU web interface does); OpenDTU answers HTTP 200 with
// { type: "success" | "warning", message, code } either way.
// -----------------------------------------------------------------------------

import { LIMIT_TYPES, OPENDTU_USER } from '../constants.js';
import { OpenDtuError, request } from '../http.js';

const NON_PERSISTENT = new Set(Object.values(LIMIT_TYPES));

export class OpenDtuClient {
  constructor({ host, secure = false, password = '' }) {
    this.base = `${secure ? 'https' : 'http'}://${host}`;
    this.password = password;
  }

  headers() {
    if (!this.password) {
      return {};
    }
    const token = Buffer.from(`${OPENDTU_USER}:${this.password}`, 'utf8').toString('base64');
    return { Authorization: `Basic ${token}` };
  }

  async getJson(path, params) {
    const query = params ? `?${new URLSearchParams(params)}` : '';
    const { text } = await request(`${this.base}${path}${query}`, { headers: this.headers() });
    try {
      return JSON.parse(text);
    } catch {
      throw new OpenDtuError('protocol', `${path} did not answer JSON: is this an OpenDTU?`);
    }
  }

  async postData(path, data) {
    if (!this.password) {
      throw new OpenDtuError('no_password', 'the OpenDTU admin password is needed');
    }
    const { text } = await request(`${this.base}${path}`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: JSON.stringify(data) }).toString(),
    });
    let answer;
    try {
      answer = JSON.parse(text);
    } catch {
      throw new OpenDtuError('protocol', `${path} did not answer JSON`);
    }
    if (answer?.type !== 'success') {
      throw new OpenDtuError(
        'refused',
        `OpenDTU refused: ${String(answer?.message ?? 'no message').slice(0, 200)}`,
      );
    }
    return answer;
  }

  // --- Reads ---------------------------------------------------------------------

  /**
   * Every inverter, with { total, hints }. Recent firmwares list only the
   * summary of each inverter; older ones (2023) inline the AC/DC/INV channels.
   */
  livedata() {
    return this.getJson('/api/livedata/status');
  }

  /** One inverter with its AC/DC/INV channels (recent firmwares). */
  inverterDetails(serial) {
    return this.getJson('/api/livedata/status', { inv: serial });
  }

  /** { <serial>: { limit_relative, max_power, limit_set_status } }. */
  limitStatus() {
    return this.getJson('/api/limit/status');
  }

  /** The event log of one inverter, in English. */
  eventLog(serial) {
    return this.getJson('/api/eventlog/status', { inv: serial, locale: 'en' });
  }

  /** { hw_model_name, max_power, fw_build_version, valid_data, ... }. */
  devInfo(serial) {
    return this.getJson('/api/devinfo/status', { inv: serial });
  }

  /** { hostname, git_hash, pioenv, uptime, ... }. */
  systemStatus() {
    return this.getJson('/api/system/status');
  }

  /** Resolves when the password is accepted (throws 'auth' otherwise). */
  async authenticate() {
    if (!this.password) {
      throw new OpenDtuError('no_password', 'no password configured');
    }
    return this.getJson('/api/security/authenticate');
  }

  // --- Commands --------------------------------------------------------------------

  /** A NON-persistent limit, in W (absolute) or % (relative). Never a persistent one. */
  async setLimit(serial, value, type = LIMIT_TYPES.ABSOLUTE) {
    const limit = Number(value);
    if (!NON_PERSISTENT.has(type)) {
      throw new OpenDtuError(
        'invalid',
        `limit type ${type} is not sent (persistent limits wear the flash)`,
      );
    }
    if (!Number.isFinite(limit) || limit < 0) {
      throw new OpenDtuError('invalid', `invalid limit ${value}`);
    }
    return this.postData('/api/limit/config', {
      serial: String(serial),
      limit_type: type,
      limit_value: limit,
    });
  }

  /** Turn the inverter on (true) or off (false). */
  setPower(serial, on) {
    return this.postData('/api/power/config', { serial: String(serial), power: Boolean(on) });
  }
}
