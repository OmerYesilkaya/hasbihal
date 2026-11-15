import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BlockedAddressError, FetchError, isPublicAddress, SafeFetcher } from './fetcher.ts';

describe('isPublicAddress', () => {
  it('refuses this machine, private networks, and their disguises', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      '::',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '64:ff9b::a9fe:a9fe',
      'not an address',
    ])
      expect(isPublicAddress(address), address).toBe(false);
  });

  it('allows the public internet', () => {
    for (const address of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])
      expect(isPublicAddress(address), address).toBe(true);
  });
});

const html = '<head><meta property="og:title" content="Merhaba"></head>';

let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer((request, response) => {
    switch (request.url) {
      case '/page':
        response.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
        response.end(gzipSync(html));
        return;
      case '/big':
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end(html + 'x'.repeat(10_000));
        return;
      case '/loop':
        response.writeHead(302, { location: '/loop' });
        response.end();
        return;
      case '/pdf':
        response.writeHead(200, { 'content-type': 'application/pdf' });
        response.end('%PDF');
        return;
      case '/down':
        response.writeHead(503);
        response.end();
        return;
      default:
        response.writeHead(404);
        response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});
afterAll(() => {
  server.close();
});

const page = { accept: ['text/html'], maxBytes: 1000, truncate: true };

describe('SafeFetcher', () => {
  it('refuses to reach this machine, by address or by name', async () => {
    const fetcher = new SafeFetcher();
    await expect(fetcher.fetch(`${base}/page`, page)).rejects.toBeInstanceOf(BlockedAddressError);
    await expect(fetcher.fetch('http://localhost/page', page)).rejects.toBeInstanceOf(
      BlockedAddressError,
    );
    await expect(fetcher.fetch('http://[::ffff:127.0.0.1]/', page)).rejects.toBeInstanceOf(
      BlockedAddressError,
    );
    await expect(fetcher.fetch('file:///etc/passwd', page)).rejects.toBeInstanceOf(FetchError);
  });

  // The rest reaches a local stand-in for a website.
  const local = new SafeFetcher({ allowPrivate: true });

  it('reads compressed pages, and keeps only the beginning of long ones', async () => {
    const fetched = await local.fetch(`${base}/page`, page);
    expect(fetched.body.toString()).toBe(html);
    expect((await local.fetch(`${base}/big`, page)).body).toHaveLength(1000);
  });

  it('says which failures are worth retrying', async () => {
    const failure = (url: string) =>
      local.fetch(url, page).then(
        () => null,
        (error: unknown) => error as FetchError,
      );
    expect((await failure(`${base}/loop`))?.retryable).toBe(false);
    expect((await failure(`${base}/pdf`))?.retryable).toBe(false);
    expect((await failure(`${base}/missing`))?.retryable).toBe(false);
    expect((await failure(`${base}/down`))?.retryable).toBe(true);
  });
});
