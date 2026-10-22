// Clerk session-token verification (same issuer/JWKS as intel-api): the
// console forwards the signed-in user's session token on every call.

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface AuthContext {
  userId: string;
  /** Tenant key: Clerk org id when present, else a per-user tenant. */
  orgKey: string;
  /** Inside an org, only admins may change the workspace (install, approve, merge). */
  isAdmin: boolean;
}

export class AuthError extends Error {}

export interface AuthVerifier {
  verify(token: string): Promise<AuthContext>;
}

export function clerkVerifier(opts: { issuer: string; jwksUrl?: string; getKey?: JWTVerifyGetKey }): AuthVerifier {
  if (!opts.getKey && !opts.jwksUrl) throw new Error("clerkVerifier needs jwksUrl or getKey");
  const getKey = opts.getKey ?? createRemoteJWKSet(new URL(opts.jwksUrl as string));
  return {
    async verify(token) {
      let payload;
      try {
        ({ payload } = await jwtVerify(token, getKey, { issuer: opts.issuer }));
      } catch (err) {
        throw new AuthError(err instanceof Error ? err.message : "invalid token");
      }
      if (!payload.sub) throw new AuthError("token missing sub");
      // Clerk session tokens v2 nest org claims under `o`; v1 used flat org_* claims.
      const o = (payload.o ?? {}) as { id?: string; rol?: string };
      const orgId = typeof payload.org_id === "string" ? payload.org_id : o.id;
      const role = typeof payload.org_role === "string" ? payload.org_role : o.rol ? `org:${o.rol}` : undefined;
      return { userId: payload.sub, orgKey: orgId ?? `user:${payload.sub}`, isAdmin: !orgId || role === "org:admin" };
    }
  };
}
