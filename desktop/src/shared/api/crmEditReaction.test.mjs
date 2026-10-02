import assert from "node:assert/strict";
import test from "node:test";
import { crmEditReactionContent } from "./crmEditReaction.ts";

test("projects a bounded signed edit tag without exposing its short reaction", () => {
  const payload =
    "crm-action-edit:v1:test-nonce:" +
    Buffer.from("Bonjour Arnaud. ".repeat(30)).toString("base64url");
  assert.equal(
    crmEditReactionContent("crm-edit:test-nonce", [
      ["e", "target"],
      ["crm-edit", payload],
    ]),
    payload,
  );
  assert.equal(crmEditReactionContent("✅", []), "✅");
  // Previous full-content events are still understood by the existing parser.
  assert.equal(crmEditReactionContent(payload, []), payload);
});

test("does not project mismatched, ambiguous or oversized edit tags", () => {
  const payload = "crm-action-edit:v1:nonce:SGVsbG8";
  const tag = ["crm-edit", payload];
  assert.equal(crmEditReactionContent("✅", [tag]), "✅");
  assert.equal(
    crmEditReactionContent("crm-edit:nonce", [tag, tag]),
    "crm-edit:nonce",
  );
  assert.equal(
    crmEditReactionContent("crm-edit:nonce", [["crm-edit", payload, "extra"]]),
    "crm-edit:nonce",
  );
  assert.equal(
    crmEditReactionContent("crm-edit:nonce", [
      ["crm-edit", payload + "A".repeat(65_536)],
    ]),
    "crm-edit:nonce",
  );
});
