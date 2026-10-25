import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { generateWebhookSecret, isBlockedAddress, postWebhook, signWebhook, webhookUrlProblem } from "./webhooks.ts";

test("signatures follow Standard Webhooks", () => {
  const secret = generateWebhookSecret();
  assert.match(secret, /^whsec_[A-Za-z0-9+/=]{32}$/);
  const h = signWebhook(secret, "msg_1", 1700000000, '{"a":1}');
  const want = createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update('msg_1.1700000000.{"a":1}').digest("base64");
  assert.deepEqual(h, { "webhook-id": "msg_1", "webhook-timestamp": "1700000000", "webhook-signature": `v1,${want}` });
});

test("only public https endpoints", () => {
  assert.equal(webhookUrlProblem("https://hooks.example.com/x"), null);
  for (const bad of ["http://hooks.example.com", "https://localhost/x", "https://127.0.0.1/x", "https://[::1]/x", "https://169.254.169.254/latest", "https://10.1.2.3", "https://u:p@example.com", "nope", "https://metadata.google.internal/"])
    assert.notEqual(webhookUrlProblem(bad), null, bad);
  for (const ip of ["127.0.0.1", "10.0.0.1", "172.20.1.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"])
    assert.ok(isBlockedAddress(ip), ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.ok(!isBlockedAddress(ip), ip);
});

test("delivery refuses names that resolve to private addresses", async () => {
  // localhost.localtest.me-style names are caught at connect time; use the
  // literal form here so the test needs no DNS.
  assert.deepEqual(await postWebhook("https://127.0.0.1:9/x", generateWebhookSecret(), "msg_1", "{}"), { ok: false, status: "invalid url" });
});
