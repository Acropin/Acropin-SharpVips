/** Download a public HTTPS image without following redirects or exposing internal services. */
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

function isPublicIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;

  const [a, b, c] = octets;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function expandIpv6(address: string): number[] | null {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized.includes('.')) return null;
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const omittedCount = 8 - left.length - right.length;
  if ((halves.length === 1 && omittedCount !== 0) || (halves.length === 2 && omittedCount < 1)) return null;
  const groups = [...left, ...Array(omittedCount).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) return null;
  return groups.map((part) => Number.parseInt(part, 16));
}

function isPublicAddress(address: string, family: number): boolean {
  if (family === 4 || isIP(address) === 4) return isPublicIpv4(address);
  if (family !== 6 && isIP(address) !== 6) return false;

  const groups = expandIpv6(address);
  if (!groups) return false;
  const first = groups[0];
  const second = groups[1];

  // Permit IPv6 global unicast only. Exclude documentation, transition and special-use ranges.
  return first >= 0x2000 && first <= 0x3fff &&
    !(first === 0x2001 && (second <= 0x01ff || second === 0x0db8)) &&
    first !== 0x2002;
}

export async function fetchRemoteImage(
  input: string,
  maxBytes = DEFAULT_MAX_BYTES
): Promise<Buffer> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Image URL must be a valid HTTPS URL.');
  }

  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Image URL must use HTTPS and must not contain credentials.');
  }

  const hostname = url.hostname.replace(/^\[|\]$/gu, '');
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address, family }) => !isPublicAddress(address, family))) {
    throw new Error('Image URL must resolve only to public internet addresses.');
  }

  const selectedAddress = addresses.find(({ family }) => family === 4) ?? addresses[0];
  if (!selectedAddress) throw new Error('Image host did not resolve to a public address.');

  return new Promise<Buffer>((resolve, reject) => {
    const request = httpsRequest(url, {
      method: 'GET',
      headers: { Accept: 'image/*,application/octet-stream;q=0.8' },
      // Pin the connection to the validated DNS response to prevent rebinding.
      lookup: (_host, options, callback) => {
        if (options.all) {
          callback(null, [{ address: selectedAddress.address, family: selectedAddress.family }]);
        } else {
          callback(null, selectedAddress.address, selectedAddress.family);
        }
      },
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        response.destroy();
        reject(new Error(status >= 300 && status < 400
          ? 'Image redirects are not accepted; provide the final HTTPS image URL.'
          : `Image host returned HTTP ${status}.`));
        return;
      }

      const contentType = response.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
      if (contentType && !contentType.startsWith('image/') && contentType !== 'application/octet-stream') {
        response.destroy();
        reject(new Error('URL response is not an image.'));
        return;
      }

      const declaredLength = Number(response.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        response.destroy();
        reject(new Error(`Image exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB download limit.`));
        return;
      }

      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      response.on('data', (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += bytes.length;
        if (receivedBytes > maxBytes) {
          request.destroy(new Error(`Image exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB download limit.`));
          return;
        }
        chunks.push(bytes);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });

    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error('Image download timed out.')));
    request.on('error', reject);
    request.end();
  });
}
