import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AccessList,
  AllowedEmail,
  GatewayCloseCode,
  GoogleSignInResult,
  MemberList,
  User,
  type SignedIn,
} from '@hasbihal/protocol';
import { startHarness, type Harness } from '../../test/harness.ts';

let h: Harness;
let admin: SignedIn;
beforeAll(async () => {
  h = await startHarness();
  admin = await h.signUp('admin');
});
afterAll(async () => {
  await h.close();
});

const as = (who: SignedIn) => who.tokens.accessToken;
const accessList = async () =>
  AccessList.parse((await h.request('GET', '/admin/access', as(admin))).json());

describe('who may join (A25)', () => {
  it('lets an address in, lowercased, and lists it until its owner signs in', async () => {
    const account = h.google.account('Zeynep');
    const res = await h.request('POST', '/admin/allowed-emails', as(admin), {
      email: `  ${account.email.toUpperCase()} `,
    });
    expect(res.statusCode).toBe(201);
    expect(AllowedEmail.parse(res.json())).toMatchObject({
      email: account.email,
      role: 'member',
      addedBy: admin.user.id,
    });
    expect((await accessList()).allowed.map((a) => a.email)).toContain(account.email);

    const signedIn = GoogleSignInResult.parse((await h.signInWithGoogle(account)).json());
    expect(signedIn.status).toBe('signed_in');
    const list = await accessList();
    expect(list.allowed.map((a) => a.email)).not.toContain(account.email);
    if (signedIn.status === 'signed_in')
      expect(list.memberEmails[signedIn.user.id]).toBe(account.email);
  });

  it('takes an address off the list', async () => {
    const account = h.google.account();
    await h.request('POST', '/admin/allowed-emails', as(admin), { email: account.email });
    const res = await h.request(
      'DELETE',
      `/admin/allowed-emails/${encodeURIComponent(account.email)}`,
      as(admin),
    );
    expect(res.statusCode).toBe(204);
    const result = GoogleSignInResult.parse((await h.signInWithGoogle(account)).json());
    expect(result.status).toBe('not_allowed');
  });

  it('refuses a member’s own address', async () => {
    const member = await h.signUp();
    const res = await h.request('POST', '/admin/allowed-emails', as(admin), {
      email: member.account.email,
    });
    expect(res.statusCode).toBe(409);
  });

  it('lists access requests; letting the address in, or dismissing, clears them', async () => {
    const asking = h.google.account('Kemal');
    const dismissed = h.google.account('Bilinmeyen');
    for (const account of [asking, dismissed]) {
      const res = await h.app.inject({
        method: 'POST',
        url: '/auth/access-requests',
        payload: { idToken: await h.google.idToken(account) },
      });
      expect(res.statusCode).toBe(204);
    }
    const requested = (await accessList()).requests;
    expect(requested.find((r) => r.email === asking.email)).toMatchObject({ name: 'Kemal' });

    await h.request('POST', '/admin/allowed-emails', as(admin), { email: asking.email });
    await h.request(
      'DELETE',
      `/admin/access-requests/${encodeURIComponent(dismissed.email)}`,
      as(admin),
    );
    const after = (await accessList()).requests.map((r) => r.email);
    expect(after).not.toContain(asking.email);
    expect(after).not.toContain(dismissed.email);
  });
});

describe('admin page (A44)', () => {
  it('only lets admins in', async () => {
    const member = await h.signUp();
    expect((await h.request('GET', '/admin/access', as(member))).statusCode).toBe(403);
    expect(
      (await h.request('POST', '/admin/allowed-emails', as(member), { email: 'a@gmail.com' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await h.request('PUT', `/admin/users/${admin.user.id}/role`, as(member), { role: 'member' }))
        .statusCode,
    ).toBe(403);
  });

  it('grants and takes admin rights, but always keeps one admin', async () => {
    const member = await h.signUp();
    const promoted = User.parse(
      (
        await h.request('PUT', `/admin/users/${member.user.id}/role`, as(admin), { role: 'admin' })
      ).json(),
    );
    expect(promoted.role).toBe('admin');
    // Two admins now: one may step down…
    expect(
      (await h.request('PUT', `/admin/users/${member.user.id}/role`, as(admin), { role: 'member' }))
        .statusCode,
    ).toBe(200);
    // …but not the last one.
    expect(
      (await h.request('PUT', `/admin/users/${admin.user.id}/role`, as(admin), { role: 'member' }))
        .statusCode,
    ).toBe(409);
  });

  it('removes a member: signed out at once, kept out, still known for old messages', async () => {
    const leaving = await h.signUp();
    const client = await h.connect(as(leaving));
    await client.waitFor('welcome');

    const removed = User.parse(
      (await h.request('POST', `/admin/users/${leaving.user.id}/remove`, as(admin))).json(),
    );
    expect(removed.removedAt).not.toBeNull();
    expect(await client.closed).toBe(GatewayCloseCode.unauthorized);
    // Their Google account no longer gets in: they're just someone not on the list.
    const again = GoogleSignInResult.parse((await h.signInWithGoogle(leaving.account)).json());
    expect(again.status).toBe('not_allowed');
    const members = MemberList.parse((await h.request('GET', '/members', as(admin))).json());
    expect(members.members.find((m) => m.id === leaving.user.id)?.removedAt).toBe(
      removed.removedAt,
    );

    expect(
      (await h.request('POST', `/admin/users/${admin.user.id}/remove`, as(admin))).statusCode,
    ).toBe(409);
  });

  it('lets a removed member’s address in again, as a new account', async () => {
    const leaving = await h.signUp();
    await h.request('POST', `/admin/users/${leaving.user.id}/remove`, as(admin));
    await h.request('POST', '/admin/allowed-emails', as(admin), { email: leaving.account.email });
    const back = GoogleSignInResult.parse((await h.signInWithGoogle(leaving.account)).json());
    if (back.status !== 'signed_in') throw new Error('not signed in');
    expect(back.user.id).not.toBe(leaving.user.id);
  });
});
