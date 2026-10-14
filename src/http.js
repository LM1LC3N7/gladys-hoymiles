// -----------------------------------------------------------------------------
// The only place that talks to the network: `fetch` with a timeout, no
// redirect (OpenDTU never redirects its API: a redirect means another
// device), a size cap. The tests replace it with `setFetch()`.
//
// Errors never carry the Authorization header nor the password: only the
// path of the request and the status.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, MAX_BODY_BYTES, USER_AGENT } from './constants.js';

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Replace the fetch implementation (tests only). Returns the previous one. */
export function setFetch(impl) {
  const previous = fetchImpl;
  fetchImpl = impl;
  return previous;
}

/**
 * code: 'timeout' | 'network' | 'auth' (401/403) | 'http' (another status)
 *       | 'protocol' (not the JSON of OpenDTU) | 'refused' (OpenDTU said no)
 *       | 'no_password' | 'invalid' (a value this module will not send)
 */
export class OpenDtuError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'OpenDtuError';
    this.code = code;
    this.status = status;
  }
}

/** One request; resolves { status, text }. */
export async function request(url, { method = 'GET', headers = {}, body, timeout = HTTP_TIMEOUT }) {
  const path = new URL(url).pathname;
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(Math.max(1, timeout)),
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new OpenDtuError(
      timedOut ? 'timeout' : 'network',
      timedOut ? `no answer within ${timeout / 1000} s on ${path}` : `${path}: ${causeOf(err)}`,
    );
  }
  const text = await response.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new OpenDtuError('protocol', `${path} answered more than ${MAX_BODY_BYTES} bytes`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new OpenDtuError('auth', `HTTP ${response.status} on ${path}`, response.status);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new OpenDtuError('http', `HTTP ${response.status} on ${path}`, response.status);
  }
  return { status: response.status, text };
}

/** The low-level reason of a failed fetch ("ECONNREFUSED", "ENOTFOUND"...). */
function causeOf(err) {
  const cause = err?.cause;
  return cause?.code ?? cause?.message ?? err?.message ?? String(err);
}
