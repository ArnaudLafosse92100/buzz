/** Expired Reddit review card explains why Approve/Cancel are disabled. */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { CrmActionCard } from "./CrmActionCard.tsx";

let root;
let container;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

function mount(expiresAt, reactions = []) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const noop = async () => {};
  act(() =>
    root.render(
      React.createElement(CrmActionCard, {
        action: {
          actionId: "8ca5bd14-00d4-45cc-88ec-4bb1609e7d4a",
          actionType: "reddit_mark_posted",
          expiresAt,
          content: [
            "Draft to copy manually:",
            "```",
            "Hello",
            "```",
            "Mark Reddit draft as posted.",
          ].join("\n"),
        },
        canToggle: true,
        pending: false,
        reactions,
        onSelect: noop,
        onChooseLeadControl: noop,
      }),
    ),
  );
}

const button = (name) =>
  [...container.querySelectorAll("button")].find((b) =>
    b.textContent.includes(name),
  );
const past = () => new Date(Date.now() - 60_000).toISOString();
const future = () => new Date(Date.now() + 3_600_000).toISOString();

test("expired Reddit card disables Approve and Cancel, keeps Copy, and says why", () => {
  mount(past());
  assert.equal(button("Approve").disabled, true);
  assert.equal(button("Cancel").disabled, true);
  assert.equal(button("Copy draft")?.disabled, false);
  const status = container.querySelector('[role="status"]');
  assert.equal(
    status?.textContent,
    "This review expired — nothing was marked as posted.",
  );
  assert.equal(button("Approve").getAttribute("aria-describedby"), status.id);
  assert.equal(button("Cancel").getAttribute("aria-describedby"), status.id);
});

test("live Reddit card has enabled Approve and no expired text", () => {
  mount(future());
  assert.equal(button("Approve").disabled, false);
  assert.equal(button("Cancel").disabled, false);
  assert.doesNotMatch(container.textContent, /expired/);
  assert.equal(container.querySelector('[role="status"]'), null);
});

test("an already decided expired card does not claim nothing was posted", () => {
  mount(past(), [
    { emoji: "✅", count: 1, reactedByCurrentUser: true, users: [] },
  ]);
  assert.doesNotMatch(container.textContent, /expired/);
});
