#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAgentHandoff,
  inspectRepository,
  loadPolicy,
  renderMarkdown,
} from "./core.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultPolicy = resolve(scriptDirectory, "policy.json");

function usage() {
  console.log(`Usage:
  node scripts/upstream-guardian/cli.mjs analyze [options]
  node scripts/upstream-guardian/cli.mjs prepare [options]
  node scripts/upstream-guardian/cli.mjs notify [options]

Options:
  --repo PATH          Repository checkout (default: current directory)
  --upstream REF       Official upstream ref (default: origin/main)
  --policy PATH        Guardian policy JSON
  --output-dir PATH    Report directory (default: .guardian-runs/latest)
  --worktree PATH      Candidate worktree path (prepare only)
  --branch NAME        Candidate branch name (prepare only)
  --report PATH        Markdown report to publish (notify only)
`);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function writeOutputs(outputDirectory, report) {
  mkdirSync(outputDirectory, { recursive: true });
  const markdown = renderMarkdown(report);
  const handoff = buildAgentHandoff(report);
  writeFileSync(
    resolve(outputDirectory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  writeFileSync(resolve(outputDirectory, "report.md"), markdown);
  writeFileSync(
    resolve(outputDirectory, "handoff.json"),
    `${JSON.stringify(handoff, null, 2)}\n`,
  );
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      `risk=${report.risk}\nstatus=${report.status}\nupstream_sha=${report.upstreamSha}\n`,
      { flag: "a" },
    );
  }
  return { markdown, handoff };
}

function analyze(options) {
  const repo = resolve(options.repo ?? process.cwd());
  const policy = loadPolicy(options.policy ?? defaultPolicy);
  const outputDirectory = resolve(
    options["output-dir"] ?? ".guardian-runs/latest",
  );
  const report = inspectRepository({
    repo,
    upstream: options.upstream ?? "origin/main",
    policy,
  });
  writeOutputs(outputDirectory, report);
  console.log(renderMarkdown(report));
  console.error(`Guardian artifacts: ${outputDirectory}`);
  return { report, outputDirectory, policy, repo };
}

function prepare(options) {
  const result = analyze(options);
  if (result.report.risk !== "green") {
    throw new Error(
      `Refusing candidate creation for ${result.report.risk} risk; next actor is ${result.report.actionOwner}.`,
    );
  }
  const trackedStatus = execFileSync(
    "git",
    ["-C", result.repo, "status", "--porcelain", "--untracked-files=no"],
    { encoding: "utf8" },
  ).trim();
  if (trackedStatus) {
    throw new Error(
      "Refusing candidate creation from a dirty tracked worktree",
    );
  }

  const worktree = resolve(
    options.worktree ??
      `/tmp/buzz-upstream-${result.report.upstreamSha.slice(0, 12)}`,
  );
  const branch =
    options.branch ??
    `guardian/upstream-${result.report.upstreamSha.slice(0, 12)}`;
  const branchCheck = spawnSync(
    "git",
    ["-C", result.repo, "check-ref-format", "--branch", branch],
    { encoding: "utf8" },
  );
  if (branchCheck.status !== 0) {
    throw new Error(`Invalid candidate branch name: ${branch}`);
  }
  if (existsSync(worktree)) {
    throw new Error(`Candidate worktree already exists: ${worktree}`);
  }

  execFileSync(
    "git",
    [
      "-C",
      result.repo,
      "worktree",
      "add",
      "-b",
      branch,
      worktree,
      result.report.headSha,
    ],
    { stdio: "inherit" },
  );
  execFileSync(
    "git",
    [
      "-C",
      worktree,
      "merge",
      "--no-ff",
      "--no-edit",
      result.report.upstreamSha,
    ],
    { stdio: "inherit" },
  );
  const candidateSha = execFileSync(
    "git",
    ["-C", worktree, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
  const candidate = {
    schemaVersion: 1,
    branch,
    worktree,
    baseSha: result.report.headSha,
    upstreamSha: result.report.upstreamSha,
    candidateSha,
    state: "review_pending",
  };
  writeFileSync(
    resolve(result.outputDirectory, "candidate.json"),
    `${JSON.stringify(candidate, null, 2)}\n`,
  );
  console.log(`Candidate ${candidateSha} prepared in ${worktree}`);
}

function notify(options) {
  const reportPath = resolve(
    options.report ?? ".guardian-runs/latest/report.md",
  );
  const relay = process.env.BUZZ_RELAY_URL;
  const privateKey = process.env.BUZZ_PRIVATE_KEY;
  const channel = process.env.BUZZ_GUARDIAN_CHANNEL;
  if (!relay || !privateKey || !channel) {
    throw new Error(
      "BUZZ_RELAY_URL, BUZZ_PRIVATE_KEY, and BUZZ_GUARDIAN_CHANNEL are required",
    );
  }
  const cli = process.env.BUZZ_CLI ?? "buzz";
  const args = ["messages", "send", "--channel", channel, "--content", "-"];
  const leadPubkey = process.env.BUZZ_GUARDIAN_LEAD_PUBKEY;
  if (leadPubkey) {
    args.push("--mention", leadPubkey);
  }
  const content = `@Genie UPSTREAM GUARDIAN\n\n${readFileSync(reportPath, "utf8")}`;
  const result = spawnSync(cli, args, {
    input: content,
    encoding: "utf8",
    env: {
      ...process.env,
      BUZZ_RELAY_URL: relay,
      BUZZ_PRIVATE_KEY: privateKey,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      `Buzz notification failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  console.log(result.stdout.trim());
}

const [command, ...argv] = process.argv.slice(2);
if (!command || command === "--help" || command === "-h") {
  usage();
  process.exit(command ? 0 : 1);
}

try {
  const options = parseArgs(argv);
  if (command === "analyze") {
    analyze(options);
  } else if (command === "prepare") {
    prepare(options);
  } else if (command === "notify") {
    notify(options);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(`upstream-guardian: ${error.message}`);
  process.exit(1);
}
