import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiError } from '@hasbihal/protocol';
import { AppError, parseRequest, registerErrorHandling } from './errors.ts';

let app: FastifyInstance;

beforeEach(async () => {
  app = Fastify({ logger: false });
  registerErrorHandling(app);
  app.get('/app-error', () => {
    throw new AppError(409, 'conflict', 'That username is taken.');
  });
  app.post('/validated', (request) =>
    parseRequest(z.object({ username: z.string().min(3) }), request.body, 'body'),
  );
  app.get('/crash', () => {
    throw new Error('secret database detail');
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('error responses', () => {
  it('sends AppError code, status, and message', async () => {
    const res = await app.inject({ method: 'GET', url: '/app-error' });
    expect(res.statusCode).toBe(409);
    expect(ApiError.parse(res.json())).toEqual({
      error: { code: 'conflict', message: 'That username is taken.' },
    });
  });

  it('turns validation failures into 400 with issue paths', async () => {
    const res = await app.inject({ method: 'POST', url: '/validated', payload: { username: 'a' } });
    expect(res.statusCode).toBe(400);
    const body = ApiError.parse(res.json());
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.issues?.[0]?.path).toEqual(['body', 'username']);
  });

  it('maps Fastify errors such as malformed JSON', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/validated',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).error.code).toBe('validation_failed');
  });

  it('hides unexpected errors behind a generic 500', async () => {
    const res = await app.inject({ method: 'GET', url: '/crash' });
    expect(res.statusCode).toBe(500);
    const body = ApiError.parse(res.json());
    expect(body.error.code).toBe('internal');
    expect(res.body).not.toContain('secret');
  });

  it('answers unknown routes with not_found', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(ApiError.parse(res.json()).error.code).toBe('not_found');
  });
});
