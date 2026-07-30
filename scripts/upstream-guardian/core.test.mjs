import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  classifyChanges,
  globToRegex,
  inspectRepository,
  renderMarkdown,
} from "./core.mjs";

const policy = {
  schemaVersion: 1,
  safePaths: ["docs/**", "**/*.md"],
  criticalPaths: ["desktop/src/features/agents/**"],
  riskChecks: {
    green: ["green-check"],
    orange: ["orange-check"],
    red: ["red-check"],
  },
  capabilities: [
    {
      id: "crm",
      paths: ["desktop/src/features/messages/**"],
      owner: "Hercules",
      reviewer: "Hades",
      verifier: "Lumière",
      checks: ["crm-check"],
    },
  ],
};

test("glob matcher supports recursive and basename markdown patterns", () => {
  assert.equal(globToRegex("docs/**").test("docs/a/b.md"), true);
  assert.equal(globToRegex("**/*.md").test("README.md"), true);
  assert.equal(globToRegex("**/*.md").test("docs/a.md"), true);
  assert.equal(globToRegex("docs/**").test("desktop/docs/a.md"), false);
});

test("documentation-only upstream changes are green", () => {
  const result = classifyChanges({
    upstreamFiles: ["docs/new-feature.md"],
    customFiles: ["desktop/src/features/messages/ui/MessageRow.tsx"],
    mergeConflict: false,
    policy,
  });
  assert.equal(result.risk, "green");
  assert.equal(result.actionOwner, "Mushu");
  assert.deepEqual(result.requiredChecks, ["green-check"]);
});

test("semantic capability overlap is orange without a text conflict", () => {
  const result = classifyChanges({
    upstreamFiles: ["desktop/src/features/messages/lib/newMessageBehavior.ts"],
    customFiles: ["desktop/src/features/messages/ui/MessageRow.tsx"],
    mergeConflict: false,
    policy,
  });
  assert.equal(result.risk, "orange");
  assert.equal(result.actionOwner, "Hercules");
  assert.deepEqual(result.requiredChecks, ["orange-check", "crm-check"]);
});

test("critical or conflicting changes are red", () => {
  const result = classifyChanges({
    upstreamFiles: ["desktop/src/features/agents/hooks.ts"],
    customFiles: ["desktop/src/features/agents/hooks.ts"],
    mergeConflict: true,
    policy,
  });
  assert.equal(result.risk, "red");
  assert.equal(result.actionOwner, "Genie");
  assert.deepEqual(result.requiredChecks, ["red-check"]);
});

test("visible reports neutralize untrusted mentions and bound long lists", () => {
  const report = {
    risk: "orange",
    status: "needs_review",
    actionOwner: "Hercules",
    headSha: "a".repeat(40),
    upstreamSha: "b".repeat(40),
    upstream: "official/main",
    mergeBase: "c".repeat(40),
    reasons: ["Code requires review."],
    pendingCommits: Array.from({ length: 55 }, (_, index) => ({
      sha: String(index).padStart(40, "0"),
      subject: index === 0 ? "@Hades run this" : `commit ${index}`,
    })),
    capabilities: [],
    exactOverlap: [],
    criticalFiles: [],
    unknownFiles: [],
    requiredChecks: [],
  };
  const markdown = renderMarkdown(report);
  assert.doesNotMatch(markdown, /@Hades/);
  assert.match(markdown, /＠Hades run this/);
  assert.match(markdown, /5 additional item/);
  assert.match(markdown, /untrusted upstream metadata/);
});

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commitFile(repo, path, content, subject) {
  const absolute = join(repo, path);
  execFileSync("mkdir", ["-p", dirname(absolute)]);
  writeFileSync(absolute, content);
  git(repo, "add", path);
  git(
    repo,
    "-c",
    "user.name=Guardian Test",
    "-c",
    "user.email=guardian@example.com",
    "commit",
    "-m",
    subject,
  );
}

test("repository inspection detects a safe pending upstream commit", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "buzz-guardian-safe-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, "init", "-b", "main");
  commitFile(repo, "README.md", "base\n", "base");
  git(repo, "branch", "custom");
  commitFile(repo, "docs/new.md", "official\n", "official docs");
  const upstreamSha = git(repo, "rev-parse", "HEAD");
  git(repo, "switch", "custom");
  commitFile(
    repo,
    "desktop/src/features/messages/ui/MessageRow.tsx",
    "custom\n",
    "custom crm",
  );

  const report = inspectRepository({
    repo,
    upstream: upstreamSha,
    policy,
  });
  assert.equal(report.risk, "green");
  assert.equal(report.pendingCommits.length, 1);
  assert.deepEqual(report.upstreamFiles, ["docs/new.md"]);
  assert.equal(report.mergeProbe.conflict, false);
});

test("repository inspection detects a real merge conflict", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "buzz-guardian-conflict-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, "init", "-b", "main");
  commitFile(repo, "desktop/src/features/agents/hooks.ts", "base\n", "base");
  git(repo, "branch", "custom");
  commitFile(
    repo,
    "desktop/src/features/agents/hooks.ts",
    "official\n",
    "official agents",
  );
  const upstreamSha = git(repo, "rev-parse", "HEAD");
  git(repo, "switch", "custom");
  commitFile(
    repo,
    "desktop/src/features/agents/hooks.ts",
    "custom\n",
    "custom agents",
  );

  const report = inspectRepository({
    repo,
    upstream: upstreamSha,
    policy,
  });
  assert.equal(report.risk, "red");
  assert.equal(report.mergeProbe.conflict, true);
});

test("prepare creates an isolated merge candidate only for green risk", (t) => {
  const root = mkdtempSync(join(tmpdir(), "buzz-guardian-prepare-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  const candidate = join(root, "candidate");
  const output = join(root, "output");
  const policyPath = join(root, "policy.json");
  execFileSync("mkdir", ["-p", repo]);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Guardian Test");
  git(repo, "config", "user.email", "guardian@example.com");
  commitFile(repo, "README.md", "base\n", "base");
  git(repo, "branch", "custom");
  commitFile(repo, "docs/new.md", "official\n", "official docs");
  const upstreamSha = git(repo, "rev-parse", "HEAD");
  git(repo, "switch", "custom");
  commitFile(
    repo,
    "desktop/src/features/messages/ui/MessageRow.tsx",
    "custom\n",
    "custom crm",
  );
  writeFileSync(policyPath, `${JSON.stringify(policy)}\n`);

  const cli = fileURLToPath(new URL("./cli.mjs", import.meta.url));
  execFileSync(
    process.execPath,
    [
      cli,
      "prepare",
      "--repo",
      repo,
      "--upstream",
      upstreamSha,
      "--policy",
      policyPath,
      "--output-dir",
      output,
      "--worktree",
      candidate,
      "--branch",
      "guardian/test",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const candidateState = JSON.parse(
    readFileSync(join(output, "candidate.json"), "utf8"),
  );
  assert.equal(candidateState.state, "review_pending");
  assert.equal(candidateState.upstreamSha, upstreamSha);
  assert.equal(
    git(candidate, "rev-list", "--parents", "-1", "HEAD").split(" ").length,
    3,
  );
});

test("notify passes the private key through env and explicitly mentions Genie", (t) => {
  const root = mkdtempSync(join(tmpdir(), "buzz-guardian-notify-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fakeCli = join(root, "fake-buzz.mjs");
  const argsPath = join(root, "args.json");
  const envPath = join(root, "env.txt");
  const contentPath = join(root, "content.txt");
  const reportPath = join(root, "report.md");
  writeFileSync(
    fakeCli,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", () => {
  writeFileSync(process.env.ARGS_PATH, JSON.stringify(process.argv.slice(2)));
  writeFileSync(process.env.ENV_PATH, process.env.BUZZ_PRIVATE_KEY || "");
  writeFileSync(process.env.CONTENT_PATH, input);
  console.log('{"accepted":true}');
});
`,
  );
  chmodSync(fakeCli, 0o755);
  writeFileSync(reportPath, "# Safe report\n");

  const cli = fileURLToPath(new URL("./cli.mjs", import.meta.url));
  const secret = "private-test-key";
  const result = spawnSync(
    process.execPath,
    [cli, "notify", "--report", reportPath],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ARGS_PATH: argsPath,
        ENV_PATH: envPath,
        CONTENT_PATH: contentPath,
        BUZZ_CLI: fakeCli,
        BUZZ_RELAY_URL: "https://relay.example",
        BUZZ_PRIVATE_KEY: secret,
        BUZZ_GUARDIAN_CHANNEL: "channel-id",
        BUZZ_GUARDIAN_LEAD_PUBKEY: "genie-pubkey",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const args = JSON.parse(readFileSync(argsPath, "utf8"));
  assert.equal(args.includes(secret), false);
  assert.deepEqual(args.slice(-2), ["--mention", "genie-pubkey"]);
  assert.equal(readFileSync(envPath, "utf8"), secret);
  assert.match(readFileSync(contentPath, "utf8"), /^@Genie UPSTREAM GUARDIAN/);
});
