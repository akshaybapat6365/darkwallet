import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';

const AUTH_PREFIX = 'Bearer ';

const parseBearerToken = (headerValue: string | undefined): string | null => {
  if (!headerValue) return null;
  if (!headerValue.startsWith(AUTH_PREFIX)) return null;
  const token = headerValue.slice(AUTH_PREFIX.length).trim();
  return token.length > 0 ? token : null;
};

const parseQueryToken = (urlPathAndQuery: string | undefined): string | null => {
  if (!urlPathAndQuery) return null;
  const [, queryString = ''] = urlPathAndQuery.split('?', 2);
  if (!queryString) return null;
  const params = new URLSearchParams(queryString);
  const token = params.get('token');
  return token && token.trim().length > 0 ? token.trim() : null;
};

export const createAuthPreHandler =
  (apiSecret?: string) => (req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction): void => {
    if (req.method === 'OPTIONS') {
      done();
      return;
    }

    const path = (req.raw.url ?? '').split('?', 1)[0];
    if (path === '/api/health') {
      done();
      return;
    }

    if (!apiSecret) {
      done();
      return;
    }

    const bearerToken = parseBearerToken(req.headers.authorization);
    const queryToken = parseQueryToken(req.raw.url);
    const token = bearerToken ?? queryToken;
    if (token !== apiSecret) {
      reply.status(401).send({ statusCode: 401, message: 'Unauthorized', requestId: req.id });
      return;
    }

    done();
  };
