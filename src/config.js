// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// -----------------------------------------------------------------------------

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = {
  host: '',
  poll_interval: 15,
};

/** `poll_interval` bounds (seconds): OpenDTU refreshes every 5 s at best. */
export const BOUNDS = { poll_interval: { min: 5, max: 300 } };

const number = (value, fallback, { min, max }) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

/**
 * The OpenDTU address as typed: "192.168.1.50", "opendtu.lan:8080",
 * "http://192.168.1.50/". Only a host and an optional port are kept: a path,
 * credentials or a query are refused (undefined) rather than guessed.
 *   { host: '192.168.1.50', secure: false } | undefined
 */
export function parseHost(value) {
  let text = String(value ?? '').trim();
  if (!text) {
    return undefined;
  }
  let secure = false;
  const scheme = /^(https?):\/\//i.exec(text);
  if (scheme) {
    secure = scheme[1].toLowerCase() === 'https';
    text = text.slice(scheme[0].length);
  }
  text = text.replace(/\/+$/, '');
  // An IPv6 literal in brackets, or a host name / IPv4, then an optional port.
  if (!/^(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)(:\d{1,5})?$/i.test(text)) {
    return undefined;
  }
  return { host: text, secure };
}

export function normalizeConfig(raw = {}) {
  const parsed = parseHost(raw.host);
  return {
    host: parsed?.host ?? '',
    secure: parsed?.secure ?? false,
    hostInvalid: Boolean(String(raw.host ?? '').trim()) && !parsed,
    password: typeof raw.password === 'string' ? raw.password : '',
    pollInterval: number(raw.poll_interval, DEFAULTS.poll_interval, BOUNDS.poll_interval),
  };
}
