import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflow = readFileSync(
  resolve(".github/workflows/upstream-guardian.yml"),
  "utf8",
);

test("workflow supports scheduled and manual observation", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /cron:/);
});

test("workflow is fail-closed to the personal fork", () => {
  assert.match(workflow, /github\.repository == 'ArnaudLafosse92100\/buzz'/);
  assert.match(workflow, /GUARDIAN_OFFICIAL_REPOSITORY: block\/buzz/);
});

test("only green analysis may prepare a candidate PR", () => {
  assert.match(workflow, /if: steps\.guardian\.outputs\.risk == 'green'/);
  assert.match(workflow, /cli\.mjs prepare/);
  assert.match(workflow, /gh pr create/);
});

test("orange and red create review issues without autonomous merge or install", () => {
  assert.match(
    workflow,
    /risk == 'orange' \|\| steps\.guardian\.outputs\.risk == 'red'/,
  );
  assert.match(workflow, /gh issue create/);
  assert.doesNotMatch(workflow, /gh pr merge/);
  assert.doesNotMatch(workflow, /desktop-install-local-macos/);
  assert.doesNotMatch(workflow, /\/Applications\/Buzz\.app/);
});

test("workflow retains immutable analysis artifacts", () => {
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /upstream-guardian-\$\{\{/);
  assert.match(workflow, /retention-days: 30/);
});
