import { describe, expect, it, vi } from 'vitest';

import { createAuthPreHandler } from '../auth.js';

type MockReply = {
  statusCode?: number;
  payload?: unknown;
  status: (code: number) => MockReply;
  send: (payload: unknown) => void;
};

const createReply = (): MockReply => {
  const reply: MockReply = {
    statusCode: undefined,
    payload: undefined,
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    send(payload: unknown) {
      reply.payload = payload;
    },
  };
  return reply;
};

describe('auth preHandler', () => {
  it('allows /api/health without authentication', () => {
    const hook = createAuthPreHandler('secret');
    const done = vi.fn();
    const reply = createReply();
    hook(
      {
        method: 'GET',
        raw: { url: '/api/health' },
        headers: {},
        id: 'req-1',
      } as never,
      reply as never,
      done,
    );

    expect(done).toHaveBeenCalledOnce();
    expect(reply.statusCode).toBeUndefined();
  });

  it('rejects unauthenticated request when secret is configured', () => {
    const hook = createAuthPreHandler('secret');
    const done = vi.fn();
    const reply = createReply();
    hook(
      {
        method: 'POST',
        raw: { url: '/api/v1/intents/prepare' },
        headers: {},
        id: 'req-2',
      } as never,
      reply as never,
      done,
    );

    expect(done).not.toHaveBeenCalled();
    expect(reply.statusCode).toBe(401);
  });

  it('accepts bearer token and SSE query token', () => {
    const hook = createAuthPreHandler('secret');

    const doneBearer = vi.fn();
    hook(
      {
        method: 'POST',
        raw: { url: '/api/v1/intents/prepare' },
        headers: { authorization: 'Bearer secret' },
        id: 'req-3',
      } as never,
      createReply() as never,
      doneBearer,
    );
    expect(doneBearer).toHaveBeenCalledOnce();

    const doneQuery = vi.fn();
    hook(
      {
        method: 'GET',
        raw: { url: '/api/jobs/abc/events?token=secret' },
        headers: {},
        id: 'req-4',
      } as never,
      createReply() as never,
      doneQuery,
    );
    expect(doneQuery).toHaveBeenCalledOnce();
  });
});
