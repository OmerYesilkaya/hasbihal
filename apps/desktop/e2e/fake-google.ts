// A stand-in for Google's sign-in, for the end-to-end tests (DECISIONS A25). It speaks just enough
// OpenID Connect for the app and the server: the authorization endpoint (which signs in whichever
// account the app's `login_hint` names, without a page), the token endpoint with PKCE, and the
// signing keys. Tests register accounts and get ID tokens for them through `/test/…`.
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

/** The client id the app uses with a stand-in Google (main/index.ts) and the server accepts. */
export const E2E_GOOGLE_CLIENT_ID = 'hasbihal-e2e';

export interface FakeAccount {
  email: string;
  name: string;
  picture?: string;
}

const readBody = (request: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      resolve(body);
    });
  });

export async function startFakeGoogle(): Promise<{ url: string; stop: () => Promise<void> }> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: 'e2e', alg: 'RS256' }] };
  const accounts = new Map<string, FakeAccount & { sub: string }>();
  const codes = new Map<string, { email: string; challenge: string; clientId: string }>();
  let url = '';

  const idToken = (email: string, clientId = E2E_GOOGLE_CLIENT_ID) => {
    const account = accounts.get(email);
    if (!account) throw new Error(`no such account: ${email}`);
    return new SignJWT({
      email: account.email,
      email_verified: true,
      name: account.name,
      ...(account.picture ? { picture: account.picture } : {}),
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'e2e' })
      .setIssuer(url)
      .setAudience(clientId)
      .setSubject(account.sub)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  };

  const server = createServer((request, response) => {
    void (async () => {
      const at = new URL(request.url ?? '/', url);
      const json = (status: number, body: unknown) =>
        response
          .writeHead(status, { 'content-type': 'application/json' })
          .end(JSON.stringify(body));

      if (at.pathname === '/certs') return json(200, jwks);

      // Tests: "this person has a Google account" (the same address again keeps its id).
      if (at.pathname === '/test/accounts' && request.method === 'POST') {
        const account = JSON.parse(await readBody(request)) as FakeAccount;
        const sub =
          accounts.get(account.email)?.sub ?? `1${randomBytes(8).readBigUInt64BE().toString()}`;
        accounts.set(account.email, { ...account, sub });
        return json(200, { sub });
      }
      // Tests acting through the API: what the app would get from the browser.
      if (at.pathname === '/test/id-token') {
        return json(200, { idToken: await idToken(at.searchParams.get('email') ?? '') });
      }

      if (at.pathname === '/authorize') {
        const email = at.searchParams.get('login_hint') ?? '';
        const redirect = new URL(at.searchParams.get('redirect_uri') ?? '');
        redirect.searchParams.set('state', at.searchParams.get('state') ?? '');
        if (!accounts.has(email)) redirect.searchParams.set('error', 'access_denied');
        else {
          const code = randomBytes(16).toString('base64url');
          codes.set(code, {
            email,
            challenge: at.searchParams.get('code_challenge') ?? '',
            clientId: at.searchParams.get('client_id') ?? '',
          });
          redirect.searchParams.set('code', code);
        }
        return response.writeHead(302, { location: redirect.toString() }).end();
      }

      if (at.pathname === '/token' && request.method === 'POST') {
        const form = new URLSearchParams(await readBody(request));
        const grant = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        const verifier = form.get('code_verifier') ?? '';
        const pkce = createHash('sha256').update(verifier).digest('base64url');
        if (grant?.challenge !== pkce || grant.clientId !== form.get('client_id'))
          return json(400, { error: 'invalid_grant' });
        return json(200, { id_token: await idToken(grant.email, grant.clientId) });
      }

      return response.writeHead(404).end();
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  return {
    url,
    stop: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}
