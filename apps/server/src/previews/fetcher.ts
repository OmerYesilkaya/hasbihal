import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { Readable } from 'node:stream';

/**
 * Addresses a link preview must never reach (ARCHITECTURE §7): our own machine, the private
 * network around it, and anything not publicly routable. Checked after DNS resolution, on the
 * very address the connection then uses, so a name can't resolve differently the second time.
 */
const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
] as const)
  blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['100::', 64], // discard
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const)
  blocked.addSubnet(network, prefix, 'ipv6');

/** IPv4 addresses hidden in IPv6 ones (mapped `::ffff:a.b.c.d`, NAT64 `64:ff9b::a.b.c.d`). */
function embeddedIpv4(address: string): string | null {
  const lower = address.toLowerCase();
  const dotted = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted?.[1]) return dotted[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (!hex?.[1] || !hex[2]) return null;
  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family !== 6) return false;
  const v4 = embeddedIpv4(address);
  if (v4) return !blocked.check(v4, 'ipv4');
  if (/^(::ffff:|64:ff9b::)/i.test(address)) return false; // an embedded form we can't read
  return !blocked.check(address, 'ipv6');
}

/** Why a fetch failed, and whether trying again later could help (a site down for a moment). */
export class FetchError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

export class BlockedAddressError extends FetchError {
  constructor(what: string) {
    super(`refusing to fetch a non-public address: ${what}`, false);
  }
}

export interface Fetched {
  /** Where it ended up, after redirects. */
  url: string;
  contentType: string;
  body: Buffer;
}

export interface FetchOptions {
  /** Content types accepted, by prefix: `text/html`, `image/`. */
  accept: string[];
  maxBytes: number;
  /** Over `maxBytes`: keep the beginning (HTML heads) or fail (images). */
  truncate: boolean;
}

export interface Fetcher {
  fetch(url: string, options: FetchOptions): Promise<Fetched>;
}

const MAX_REDIRECTS = 4;

/**
 * Fetches from the open internet for link previews, and nothing else (ARCHITECTURE §7): http(s)
 * on the standard ports, public addresses only, few redirects, small bodies, short time.
 */
export class SafeFetcher implements Fetcher {
  readonly #allowPrivate: boolean;
  readonly #timeoutMs: number;

  /** @param allowPrivate Tests only: reach a server on this machine. */
  constructor(options: { allowPrivate?: boolean; timeoutMs?: number } = {}) {
    this.#allowPrivate = options.allowPrivate ?? false;
    this.#timeoutMs = options.timeoutMs ?? 8_000;
  }

  async fetch(url: string, options: FetchOptions): Promise<Fetched> {
    const deadline = AbortSignal.timeout(this.#timeoutMs);
    let current = new URL(url);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      this.#check(current);
      const response = await this.#request(current, deadline);
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        current = new URL(location, current);
        continue;
      }
      if (status !== 200) {
        response.resume();
        // Server errors and rate limits pass; a missing or forbidden page stays that way.
        throw new FetchError(`HTTP ${String(status)}`, status >= 500 || status === 429);
      }
      const contentType = (response.headers['content-type'] ?? '').toLowerCase();
      if (!options.accept.some((prefix) => contentType.startsWith(prefix))) {
        response.resume();
        throw new FetchError(`not wanted: ${contentType || 'no content type'}`, false);
      }
      const body = await readBody(decoded(response), options.maxBytes, options.truncate);
      return { url: current.toString(), contentType, body };
    }
    throw new FetchError('too many redirects', false);
  }

  #check(url: URL): void {
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      throw new FetchError(`not http(s): ${url.protocol}`, false);
    if (url.username || url.password) throw new FetchError('credentials in the URL', false);
    if (this.#allowPrivate) return;
    if (url.port) throw new BlockedAddressError(`port ${url.port}`);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && !isPublicAddress(host)) throw new BlockedAddressError(host);
  }

  #request(url: URL, signal: AbortSignal): Promise<http.IncomingMessage> {
    const allowPrivate = this.#allowPrivate;
    // Every name is resolved here and checked before connecting to exactly what was checked.
    const lookup: LookupFunction = (hostname, options, callback) => {
      dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
        if (error) {
          callback(error, '', 0);
          return;
        }
        const usable = allowPrivate
          ? addresses
          : addresses.filter((a) => isPublicAddress(a.address));
        const first = usable[0];
        if (!first || usable.length !== addresses.length) {
          callback(new BlockedAddressError(hostname), '', 0);
          return;
        }
        if (options.all) callback(null, usable);
        else callback(null, first.address, first.family);
      });
    };
    const client = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const request = client.get(
        url,
        {
          lookup,
          signal,
          headers: {
            // A plain, generic client name: nothing about the server or its people.
            'user-agent': 'Mozilla/5.0 (compatible; HasbihalLinkPreview/1.0)',
            accept: 'text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.5',
            'accept-language': 'tr,en;q=0.8',
            'accept-encoding': 'gzip, deflate, br',
          },
        },
        resolve,
      );
      request.on('error', (error) => {
        // A refused address stays refused; a network hiccup or timeout may pass.
        reject(error instanceof FetchError ? error : new FetchError(error.message, true));
      });
    });
  }
}

function decoded(response: http.IncomingMessage): Readable {
  switch (response.headers['content-encoding']) {
    case 'gzip':
      return response.pipe(createGunzip());
    case 'deflate':
      return response.pipe(createInflate());
    case 'br':
      return response.pipe(createBrotliDecompress());
    default:
      return response;
  }
}

/** Reads at most `max` bytes (after decompression, so a small bomb can't grow past it). */
async function readBody(stream: Readable, max: number, truncate: boolean): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    const room = max - size;
    if (chunk.length > room) {
      if (!truncate) {
        stream.destroy();
        throw new FetchError('too large', false);
      }
      chunks.push(chunk.subarray(0, room));
      stream.destroy();
      break;
    }
    chunks.push(chunk);
    size += chunk.length;
  }
  return Buffer.concat(chunks);
}
