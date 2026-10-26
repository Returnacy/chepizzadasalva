// @ts-nocheck
import fp from 'fastify-plugin';
import { createRemoteJWKSet, jwtVerify, decodeJwt } from 'jose';
export default fp(async (fastify) => {
    // Phase 2.6 single-issuer cutover: only accept tokens issued by user-service.
    // Previously dual-issuer with a lazy KEYCLOAK_JWKS that hangs ~30s when
    // auth-service is offline. Single-issuer mode does no outbound HTTP for
    // tokens with non-matching iss — fast-reject instead.
    const selfIssuer = process.env.SELF_ISSUER?.trim();
    const selfIssuerJwksUrl = process.env.SELF_ISSUER_JWKS_URL?.trim();
    if (!selfIssuer || !selfIssuerJwksUrl) {
        fastify.log.error('Missing SELF_ISSUER or SELF_ISSUER_JWKS_URL env vars — single-issuer auth requires both');
        throw new Error('Self-issued JWT configuration missing');
    }
    const SELF_JWKS = createRemoteJWKSet(new URL(selfIssuerJwksUrl));
    fastify.log.info({ selfIssuer, selfIssuerJwksUrl }, '[business-service] Single-issuer mode: only accepting self-issued tokens');
    const audienceEnv = process.env.KEYCLOAK_AUDIENCE || process.env.KEYCLOAK_ALLOWED_AUDIENCES || '';
    const allowedAudiences = audienceEnv.split(',').map((s) => s.trim()).filter(Boolean);
    const CLOCK_TOLERANCE_SECONDS = Number(process.env.KEYCLOAK_CLOCK_TOLERANCE_SECONDS || 60);
    fastify.decorateRequest('auth', null);
    fastify.addHook('preHandler', async (request, reply) => {
        // Only routes that declare `config: { public: true }` skip auth (today: GET /health).
        // Unmatched URLs carry the 404 route's config, so they stay behind auth.
        if (request.routeOptions?.config?.public === true)
            return;
        try {
            const authHeader = request.headers['authorization'];
            if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
                return reply.status(401).send({ error: 'Missing or invalid Authorization header' });
            }
            const token = authHeader.substring(7).trim();
            if (!token)
                return reply.status(401).send({ error: 'Missing token' });
            // Fast reject: only verify if iss matches our self-issuer. Anything else
            // (legacy Keycloak tokens, garbage) gets an immediate 401 — no JWKS fetch.
            let tokenIss;
            try {
                tokenIss = decodeJwt(token).iss;
            }
            catch { }
            if (!tokenIss || tokenIss !== selfIssuer) {
                return reply.status(401).send({ error: 'INVALID_OR_LEGACY_TOKEN' });
            }
            const verifyOptions = {
                issuer: selfIssuer,
                clockTolerance: CLOCK_TOLERANCE_SECONDS,
            };
            const { payload } = await jwtVerify(token, SELF_JWKS, verifyOptions);
            if (allowedAudiences.length > 0) {
                const audClaim = payload.aud;
                const azpClaim = payload.azp;
                const audList = Array.isArray(audClaim) ? audClaim : typeof audClaim === 'string' ? [audClaim] : [];
                const azpList = typeof azpClaim === 'string' ? [azpClaim] : Array.isArray(azpClaim) ? azpClaim : [];
                const combined = [...audList, ...azpList];
                const match = combined.some((value) => allowedAudiences.includes(value));
                if (!match) {
                    return reply.status(401).send({ error: 'Invalid audience' });
                }
            }
            request.auth = payload;
            return;
        }
        catch (err) {
            fastify.log.debug({ err }, '[business-service] JWT verification failed');
            return reply.status(401).send({ error: 'Invalid or expired token' });
        }
    });
});
