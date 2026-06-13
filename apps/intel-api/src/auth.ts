// Clerk session-token verification: RS256 JWT against Clerk's JWKS with
// issuer check. Tests inject a local JWKS resolver instead of the remote set.

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface AuthContext {
  userId: string;
  /** Tenant key: Clerk org id when present, else per-user tenant. */
  orgKey: string;
}

export interface AuthVerifier {
  verify(token: string): Promise<AuthContext>;
}

export class AuthError extends Error {}

/** Service-to-service caller (Cloud Scheduler → API). No tenant of its own. */
export interface InternalAuthContext {
  email: string;
}

export interface InternalVerifier {
  verify(token: string): Promise<InternalAuthContext>;
}

/**
 * Verifies Google-signed OIDC tokens (Cloud Scheduler service account).
 * Only the configured SA email is accepted, audience must match this API.
 */
export function googleOidcVerifier(opts: {
  allowedEmail: string;
  audience: string;
  /** Test override — bypasses the Google JWKS fetch. */
  getKey?: JWTVerifyGetKey;
}): InternalVerifier {
  const getKey =
    opts.getKey ??
    createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

  return {
    async verify(token: string): Promise<InternalAuthContext> {
      let payload;
      try {
        ({ payload } = await jwtVerify(token, getKey, {
          issuer: ["https://accounts.google.com", "accounts.google.com"],
          audience: opts.audience
        }));
      } catch (err) {
        throw new AuthError(err instanceof Error ? err.message : "invalid token");
      }
      const email = typeof payload.email === "string" ? payload.email : undefined;
      if (!email || payload.email_verified !== true) {
        throw new AuthError("token missing verified email");
      }
      if (email !== opts.allowedEmail) {
        throw new AuthError(`service account ${email} not allowed`);
      }
      return { email };
    }
  };
}

export function clerkVerifier(opts: {
  issuer: string;
  jwksUrl?: string;
  /** Test override — bypasses the remote JWKS fetch. */
  getKey?: JWTVerifyGetKey;
}): AuthVerifier {
  if (!opts.getKey && !opts.jwksUrl) {
    throw new Error("clerkVerifier needs jwksUrl or getKey");
  }
  const getKey = opts.getKey ?? createRemoteJWKSet(new URL(opts.jwksUrl as string));

  return {
    async verify(token: string): Promise<AuthContext> {
      let payload;
      try {
        ({ payload } = await jwtVerify(token, getKey, { issuer: opts.issuer }));
      } catch (err) {
        throw new AuthError(err instanceof Error ? err.message : "invalid token");
      }
      if (!payload.sub) throw new AuthError("token missing sub");
      const orgId = typeof payload.org_id === "string" ? payload.org_id : undefined;
      return { userId: payload.sub, orgKey: orgId ?? `user:${payload.sub}` };
    }
  };
}
