import { lookup } from 'node:dns/promises';
import https from 'node:https';
import ipaddr from 'ipaddr.js';
import { ApiError } from './store';

export function publicAddress(address: string) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export async function publicTarget(input: string) {
  let url: URL;
  try { url = new URL(input); } catch { throw new ApiError(400, 'Use a valid public HTTPS media URL.'); }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password || url.hash || input.length > 4096) throw new ApiError(400, 'Use a public HTTPS URL without credentials, fragments or custom ports.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(hostname)) throw new ApiError(400, 'Private network URLs are not supported.');
  let records: { address: string; family: number }[];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    records = ipaddr.isValid(hostname) ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv4' ? 4 : 6 }]
      : await Promise.race([lookup(hostname, { all: true }), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('DNS timeout')), 10000); timer.unref(); })]);
  } catch { throw new ApiError(502, 'The media host could not be resolved. Try another source or retry later.'); }
  finally { clearTimeout(timer); }
  if (!records.length || records.some(record => !publicAddress(record.address))) throw new ApiError(400, 'Media URLs must resolve only to public IP addresses.');
  return { url, records };
}

// Pin the validated DNS result to the connection, including after every redirect.
// Incoming Authorization headers and cookies are never forwarded to media hosts.
export async function publicResponse(input: string, headers: Record<string, string> = {}, redirects = 0): Promise<import('node:http').IncomingMessage> {
  const { url, records } = await publicTarget(input);
  if (redirects > 4) throw new ApiError(400, 'Too many media redirects.');
  const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'QuranVid/1.0', 'Accept-Encoding': 'identity', ...headers },
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, records);
        else callback(null, records[0].address, records[0].family);
      }, signal: AbortSignal.timeout(180000) }, resolve);
    request.setTimeout(20000, () => request.destroy(new Error('Media host stopped responding.')));
    request.on('error', () => reject(new ApiError(502, 'Could not download the remote media.')));
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
    const location = response.headers.location; response.destroy();
    if (!location) throw new ApiError(502, 'The media redirect has no destination.');
    // Provider credentials must not follow cross-origin redirects.
    const target = new URL(location, url);
    return publicResponse(target.href, target.origin === url.origin ? headers : {}, redirects + 1);
  }
  if (response.statusCode !== 200) { const status = response.statusCode; response.destroy(); throw new ApiError(502, `The media provider returned HTTP ${status}.`); }
  return response;
}
export async function publicJson(input: string, headers: Record<string, string> = {}) {
  const response = await publicResponse(input, headers); const chunks: Buffer[] = []; let size = 0;
  try {
    for await (const chunk of response) { size += chunk.length; if (size > 4 * 1024 ** 2) throw new ApiError(502, 'The provider response is too large.'); chunks.push(Buffer.from(chunk)); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) { response.destroy(); if (error instanceof ApiError) throw error; throw new ApiError(502, 'The media provider returned unreadable data.'); }
}
