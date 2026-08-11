#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';

const graphPath = resolve(process.argv[2] ?? 'graphify-out/graph.json');
const outDir = dirname(graphPath);
const repoRoot = resolve(outDir, '..');
const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(outDir, 'manifest.json'), 'utf8'));
const statIndex = JSON.parse(readFileSync(resolve(outDir, 'cache/stat-index.json'), 'utf8'));
const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
const links = Array.isArray(graph.links) ? graph.links : graph.edges;

if (!graph.directed) throw new Error('Expected graph.directed to be true.');
if (!Array.isArray(links)) throw new Error('Expected a links or edges array.');
if (!nodes.length) throw new Error('Expected at least one graph node.');
if (existsSync(resolve(outDir, 'memory'))) throw new Error('Graph memory directory is prohibited.');

const prohibited = [
  'graphify-out/', '.graphify/', '.agents/', '.claude/', '.codex/', '.goose/',
  '.intersect/', '.omo/', '.sisyphus/', '.hermit/', 'node_modules/', '.pnpm-store/',
  'target/', '.dart_tool/', '.gradle/', 'Pods/', 'DerivedData/', '.venv/', 'venv/',
  'env/', 'dist/', 'build/', '.next/', '.cache/', 'coverage/', '.pytest_cache/',
  '__pycache__/', 'desktop/dist/', 'desktop/playwright-report/', 'desktop/test-results/',
  'web/dist/', 'admin-web/dist/', 'mobile/build/', 'tmp/', 'temp/', 'logs/', 'docs/',
  'desktop/public/', 'web/public/', 'admin-web/public/', 'mobile/assets/',
];
const requiredRoots = [
  'crates/', 'desktop/src/', 'desktop/src-tauri/', 'web/src/', 'admin-web/src/',
  'mobile/lib/', 'migrations/', 'scripts/', 'examples/', 'benchmarks/',
];
const codeExtensions = new Set([
  '.py', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.ejs',
  '.go', '.rs', '.java', '.groovy', '.gradle', '.cpp', '.cc', '.cxx', '.c', '.h',
  '.hpp', '.rb', '.swift', '.kt', '.kts', '.cs', '.scala', '.php', '.lua', '.luau',
  '.ps1', '.psm1', '.psd1', '.ex', '.exs', '.m', '.mm', '.jl', '.vue', '.svelte',
  '.astro', '.dart', '.sql', '.sh', '.bash', '.json', '.tf', '.tfvars', '.hcl',
]);
const excludedNames = new Set([
  'Cargo.lock', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'deno.lock',
  'uv.lock',
]);
const normalizePath = (value) => value.split(sep).join('/').replace(/^\.\//, '');
const isAbsolutePath = (path) => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
const isNestedExcludedPath = (path) =>
  /^(?:desktop|web|admin-web|mobile|crates|benchmarks)\/(?:.*\/)?(?:fixtures|output)(?:\/|$)/.test(path) ||
  /^scripts\/(?:.*\/)?(?:data|output)(?:\/|$)/.test(path) ||
  path.includes('/assets/') || path.includes('/Pods/') || path.includes('/.gradle/');
const isProhibitedPath = (path) =>
  path.startsWith('../') || prohibited.some((prefix) => path.startsWith(prefix)) ||
  isNestedExcludedPath(path) || excludedNames.has(path.split('/').at(-1));
const isEligibleCodePath = (path) =>
  !isProhibitedPath(path) && codeExtensions.has(extname(path).toLowerCase());
const hashForStatIndex = (path) => createHash('sha256')
  .update(readFileSync(resolve(repoRoot, path)))
  .update(Buffer.from([0]))
  .update(path.toLowerCase())
  .digest('hex');

const sourcePaths = new Set(nodes.map((node) => node.source_file)
  .filter((value) => typeof value === 'string' && value));
const edgeSourcePaths = new Set(links.map((link) => link.source_file)
  .filter((value) => typeof value === 'string' && value));
const metadataPaths = new Set([...sourcePaths, ...edgeSourcePaths]);
const absolute = [...metadataPaths].filter(isAbsolutePath);
const forbidden = [...metadataPaths].filter(isProhibitedPath);
const oldRootReferences = JSON.stringify(graph).match(/\/Users\/arnaud\/Documents\/Buzz-CRM/g) ?? [];
const missingRoots = requiredRoots.filter((root) =>
  ![...sourcePaths].some((path) => path.startsWith(root)));
const nodeIds = new Set(nodes.map((node) => node.id));
const duplicateNodeIds = nodes.length - nodeIds.size;
const dangling = links.filter((link) => !nodeIds.has(link.source) || !nodeIds.has(link.target));
const missingNodeIds = nodes.filter((node) => typeof node.id !== 'string' || !node.id);
const sourceLessNodes = nodes.filter((node) => !node.source_file);
const unsafeSourceLessIds = sourceLessNodes.filter((node) => {
  const id = typeof node.id === 'string' ? normalizePath(node.id) : '';
  return isAbsolutePath(id) || isProhibitedPath(id);
});
const nonAstNodes = nodes.filter((node) => node._origin !== 'ast');

const listedFiles = execFileSync(
  'git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: repoRoot, encoding: 'utf8' },
).split('\0').filter(Boolean).map(normalizePath)
  .filter((path) => existsSync(resolve(repoRoot, path)));
const eligibleCodeFiles = listedFiles.filter(isEligibleCodePath);
const newEligibleFiles = eligibleCodeFiles.filter((path) => !Object.hasOwn(statIndex, path));
const changedEligibleFiles = eligibleCodeFiles.filter((path) => {
  const expectedHash = statIndex[path]?.hashes?.[path];
  return expectedHash ? hashForStatIndex(path) !== expectedHash : false;
});
const deletedEligibleFiles = Object.keys(manifest).filter((path) =>
  isEligibleCodePath(path) && !existsSync(resolve(repoRoot, path)));

if (absolute.length) throw new Error(`Absolute source paths: ${absolute.slice(0, 5).join(', ')}`);
if (forbidden.length) throw new Error(`Prohibited source paths: ${forbidden.slice(0, 5).join(', ')}`);
if (oldRootReferences.length) throw new Error(`Old Buzz-CRM root references: ${oldRootReferences.length}`);
if (missingRoots.length) throw new Error(`Expected source roots missing: ${missingRoots.join(', ')}`);
if (dangling.length) throw new Error(`Dangling edge endpoints: ${dangling.length}`);
if (missingNodeIds.length) throw new Error(`Nodes with missing ids: ${missingNodeIds.length}`);
if (duplicateNodeIds) throw new Error(`Duplicate node ids: ${duplicateNodeIds}`);
if (nonAstNodes.length) throw new Error(`Non-AST nodes: ${nonAstNodes.length}`);
if (unsafeSourceLessIds.length) throw new Error(`Unsafe source-less node ids: ${unsafeSourceLessIds.length}`);
if (newEligibleFiles.length || changedEligibleFiles.length || deletedEligibleFiles.length) {
  const details = [
    ...newEligibleFiles.slice(0, 5).map((path) => `${path} (new)`),
    ...changedEligibleFiles.slice(0, 5).map((path) => `${path} (hash changed)`),
    ...deletedEligibleFiles.slice(0, 5).map((path) => `${path} (deleted)`),
  ];
  throw new Error(
    `Graph is stale: ${newEligibleFiles.length} new, ${changedEligibleFiles.length} hash-changed, ` +
    `${deletedEligibleFiles.length} deleted eligible files. ${details.join(', ')}`,
  );
}

console.log(JSON.stringify({
  graph: relative(repoRoot, graphPath), directed: graph.directed, nodes: nodes.length,
  edges: links.length, sourceFiles: sourcePaths.size, edgeSourceFiles: edgeSourcePaths.size,
  sourceLessNodes: sourceLessNodes.length, danglingEndpoints: dangling.length,
  prohibitedPaths: forbidden.length, oldRootReferences: oldRootReferences.length,
  nonAstNodes: nonAstNodes.length, manifestEntries: Object.keys(manifest).length,
  eligibleCodeFiles: eligibleCodeFiles.length, newEligibleFiles: newEligibleFiles.length,
  changedEligibleFiles: changedEligibleFiles.length, deletedEligibleFiles: deletedEligibleFiles.length,
  coveredRoots: requiredRoots.length,
}, null, 2));
