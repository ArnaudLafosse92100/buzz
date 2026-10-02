import assert from "node:assert/strict";
import test from "node:test";
import {
  collectCrmOutreachResults,
  withoutCrmOutreachReceipt,
} from "./crmOutreachResult.ts";
import { crmOutreachStatus } from "../ui/crmOutreachStatus.ts";
import { formatTimelineMessages } from "./formatTimelineMessages.ts";

const aid = "8ca5bd14-00d4-45cc-88ec-4bb1609e7d4a";
const target = {
  id: "a".repeat(64),
  pubkey: "1".repeat(64),
  kind: 9,
  tags: [["h", "sales"]],
  created_at: 100,
  content: `Review\ncrm-action:v1:${aid}:outreach_approve:2099-01-01T00:00:00Z`,
};
const payload = "crm-action-edit:v1:nonce-2:SGVsbG8gd29ybGQ";
const reaction = {
  ...target,
  id: "c".repeat(64),
  kind: 7,
  created_at: 101,
  pubkey: "2".repeat(64),
  content: "crm-edit:nonce-2",
  tags: [
    ["h", "sales"],
    ["e", target.id],
    ["crm-edit", payload],
  ],
};
function receipt(state = "rejected", overrides = {}) {
  return {
    ...target,
    id: "b".repeat(64),
    created_at: 102,
    content: `CRM confirmation\n\n<!-- crm-outreach-result:v1:${aid}:${target.id}:${state}:${state === "edited" ? 2 : 0}:${state === "edited" ? reaction.id : "-"} -->`,
    ...overrides,
  };
}
const own = (emoji) => ({
  emoji,
  count: 1,
  users: [],
  reactedByCurrentUser: true,
});

test("actual formatter attaches CRM receipt to exact card and hides metadata", () => {
  const rows = formatTimelineMessages([target, receipt()], null, null, null);
  assert.equal(rows[0].crmOutreachResult.state, "rejected");
  assert.equal(rows[1].body, "CRM confirmation");
  assert.equal(withoutCrmOutreachReceipt("hello  "), "hello  ");
});

test("rejects wrong signer, channel, action, target, kind, pending and stale receipts", () => {
  for (const bad of [
    receipt("rejected", { pubkey: "3".repeat(64) }),
    receipt("rejected", { tags: [["h", "elsewhere"]] }),
    receipt("rejected", { pending: true }),
    receipt("rejected", { kind: 7 }),
    receipt("rejected", { created_at: 99 }),
    {
      ...receipt(),
      content: receipt().content.replace(aid, aid.replace("8ca5", "9ca5")),
    },
    {
      ...receipt(),
      content: receipt().content.replace(target.id, "f".repeat(64)),
    },
  ])
    assert.equal(collectCrmOutreachResults([target, bad], new Set()).size, 0);
  assert.equal(
    collectCrmOutreachResults([target, receipt()], new Set([target.id])).size,
    0,
  );
  assert.equal(
    collectCrmOutreachResults([target, receipt()], new Set([receipt().id]))
      .size,
    0,
  );
});

test("edit confirmation identifies exact revision and never reopens rejected card", () => {
  const edit = receipt("edited");
  const result = collectCrmOutreachResults(
    [target, reaction, edit],
    new Set(),
  ).get(target.id);
  assert.equal(result.editPayload, payload);
  assert.equal(
    crmOutreachStatus([own(payload)], result, false, null).state,
    "edited",
  );
  assert.equal(
    crmOutreachStatus(
      [own(payload), own(payload.replace("nonce-2", "nonce-3"))],
      result,
      false,
      null,
    ).state,
    "awaiting-edit",
  );
  assert.equal(collectCrmOutreachResults([target, edit], new Set()).size, 0);
  assert.equal(
    collectCrmOutreachResults(
      [
        target,
        reaction,
        receipt(),
        { ...edit, id: "d".repeat(64), created_at: 103 },
      ],
      new Set(),
    ).get(target.id).state,
    "rejected",
  );
});

test("submission is not completion; old edit status disappears on rejection", () => {
  const submitted = crmOutreachStatus(
    [own(payload), own("❌")],
    undefined,
    false,
    null,
  );
  assert.equal(submitted.title, "Rejection submitted");
  assert.equal(submitted.locked, true);
  assert.doesNotMatch(submitted.detail, /No message was sent/);
  const result = collectCrmOutreachResults([target, receipt()], new Set()).get(
    target.id,
  );
  assert.equal(
    crmOutreachStatus([own(payload), own("❌")], result, false, null).title,
    "Draft rejected",
  );
  assert.equal(
    crmOutreachStatus([own("✅")], undefined, false, null).title,
    "Approval submitted",
  );
  assert.equal(crmOutreachStatus([], undefined, true, null).locked, true);
  assert.equal(
    crmOutreachStatus([], undefined, false, "❌").title,
    "Submitting rejection…",
  );
});
