"use client";

import { useState } from "react";

// Mirrors the server SDK's failure reasons (docs: /docs/reference/error-codes).
const REASONS: { code: string; meaning: string; fix: string }[] = [
  { code: "web-bot-auth:signature_headers_incomplete", meaning: "Signature or Signature-Input is missing.", fix: "The agent must send both headers." },
  { code: "web-bot-auth:malformed_signature_headers", meaning: "The signature headers aren't valid structured fields.", fix: "Ask the agent operator to check their signing library." },
  { code: "web-bot-auth:created_and_expires_required", meaning: "A required signature parameter is missing.", fix: "Signatures need created and expires." },
  { code: "web-bot-auth:keyid_required", meaning: "No keyid on the signature.", fix: "keyid must be the JWK thumbprint of the signing key." },
  { code: "web-bot-auth:created_in_future", meaning: "The signature is dated in the future.", fix: "Usually a clock problem on the agent's side (60 s tolerance)." },
  { code: "web-bot-auth:expired", meaning: "The signature has expired.", fix: "Agents should sign each request fresh." },
  { code: "web-bot-auth:validity_window_too_long", meaning: "expires − created is over 24 hours.", fix: "Raise webBotAuth.maxValiditySec if you trust this signer." },
  { code: "web-bot-auth:authority_or_target_uri_not_covered", meaning: "Neither @authority nor @target-uri is signed.", fix: "The signature doesn't bind to your site, so it can't be trusted." },
  { code: "web-bot-auth:signature_agent_not_covered", meaning: "The Signature-Agent header isn't signed.", fix: "Required by Web Bot Auth." },
  { code: "web-bot-auth:signer_not_allowed", meaning: "The signer isn't in webBotAuth.allowedDirectories.", fix: "Add it, or leave allowedDirectories as 'any'." },
  { code: "web-bot-auth:discovery_failed", meaning: "The signer's key directory couldn't be fetched or parsed, or its URL was unsafe.", fix: "Failures are cached for 5 minutes. Check the signer's /.well-known/http-message-signatures-directory." },
  { code: "web-bot-auth:unknown_keyid", meaning: "No key in the directory matches keyid.", fix: "The agent may have rotated keys before publishing the new one." },
  { code: "web-bot-auth:bad_signature", meaning: "The signature doesn't verify.", fix: "Most often a proxy rewriting Host — set webBotAuth.authority to your public host." },
  { code: "web-bot-auth:replayed_nonce", meaning: "This nonce was already used.", fix: "A replayed request — correctly refused." },
  { code: "api-key:unknown_or_revoked", meaning: "The agent key isn't in AGENT_KEYS.", fix: "Check the key, and that AGENT_KEYS was redeployed after creating it." },
  { code: "oauth2:invalid_token", meaning: "Signature, issuer, audience or expiry check failed.", fix: "Compare the token's iss/aud with your oauth2 config." },
  { code: "oauth2:missing_scopes", meaning: "The token lacks a required scope.", fix: "Grant the scope to the agent's client, or relax requiredScopes." },
  { code: "crawler:rdns_mismatch", meaning: "The IP doesn't belong to the crawler it claims to be.", fix: "Almost always a scraper spoofing a crawler user agent." },
  { code: "crawler:client_ip_unknown", meaning: "No trusted client-IP header.", fix: "Set crawlers.clientIp to your platform's client-IP header." },
  { code: "crawler:dns_unavailable_in_runtime", meaning: "Running on an edge runtime without DNS.", fix: "Set runtime: 'nodejs' on the middleware." },
  { code: "crawler:no_rdns_method_for_vendor", meaning: "This crawler's operator doesn't publish reverse-DNS verification.", fix: "Expected for GPTBot, ClaudeBot, PerplexityBot — they can verify with Web Bot Auth." },
  { code: "agent_claim_without_credentials", meaning: "It looks like an agent but presented nothing to verify.", fix: "Give the agent a credential, or block unverified agents." }
];

export function ReasonLookup() {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const rows = needle ? REASONS.filter((r) => `${r.code} ${r.meaning} ${r.fix}`.toLowerCase().includes(needle)) : REASONS;
  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Paste a reason from your logs, e.g. crawler:rdns_mismatch"
        aria-label="Search error reasons"
        style={{ width: "100%", padding: "9px 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-strong)", background: "var(--canvas)", color: "var(--content)", fontSize: 14, marginBottom: 12 }}
      />
      <div style={{ display: "grid", gap: 2, maxHeight: 420, overflowY: "auto" }}>
        {rows.map((r) => (
          <div key={r.code} className="ag-row" style={{ padding: "10px 6px", borderBottom: "1px solid var(--border)" }}>
            <code style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600 }}>{r.code}</code>
            <div style={{ fontSize: 13, color: "var(--content-secondary)", marginTop: 3 }}>{r.meaning}</div>
            <div style={{ fontSize: 13, color: "var(--content-muted)", marginTop: 2 }}>→ {r.fix}</div>
          </div>
        ))}
        {rows.length === 0 && <div style={{ fontSize: 13, color: "var(--content-muted)", padding: 6 }}>No match — see the full list in the docs.</div>}
      </div>
    </div>
  );
}
