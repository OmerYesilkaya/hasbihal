import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GatewayCloseCode,
  InviteList,
  MemberList,
  OneTimeLink,
  User,
  type SignedIn,
} from '@hasbihal/protocol';
import { PASSWORD, startHarness, type Harness } from '../../test/harness.ts';

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

describe('admin page (A44)', () => {
  it('lists pending invites and revokes them', async () => {
    const link = OneTimeLink.parse(
      (await h.request('POST', '/invites', as(admin), { role: 'member' })).json(),
    );
    const listed = InviteList.parse((await h.request('GET', '/admin/invites', as(admin))).json());
    const invite = listed.invites.find((i) => i.expiresAt === link.expiresAt);
    if (!invite) throw new Error('invite not listed');
    expect(invite).toMatchObject({ role: 'member', createdBy: admin.user.id });

    expect((await h.request('DELETE', `/admin/invites/${invite.id}`, as(admin))).statusCode).toBe(
      204,
    );
    const info = await h.app.inject({ method: 'GET', url: `/auth/invites/${link.token}` });
    expect(info.statusCode).toBe(404);
  });

  it('only lets admins in', async () => {
    const member = await h.signUp();
    expect((await h.request('GET', '/admin/invites', as(member))).statusCode).toBe(403);
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

  it('removes a member: signed out at once, can’t sign in, still known for old messages', async () => {
    const leaving = await h.signUp();
    const client = await h.connect(as(leaving));
    await client.waitFor('welcome');

    const removed = User.parse(
      (await h.request('POST', `/admin/users/${leaving.user.id}/remove`, as(admin))).json(),
    );
    expect(removed.removedAt).not.toBeNull();
    expect(await client.closed).toBe(GatewayCloseCode.unauthorized);
    const signIn = await h.app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { username: leaving.user.username, password: PASSWORD, deviceName: 'Test' },
    });
    expect(signIn.statusCode).toBe(401);
    const members = MemberList.parse((await h.request('GET', '/members', as(admin))).json());
    expect(members.members.find((m) => m.id === leaving.user.id)?.removedAt).toBe(
      removed.removedAt,
    );

    expect(
      (await h.request('POST', `/admin/users/${admin.user.id}/remove`, as(admin))).statusCode,
    ).toBe(409);
  });
});
