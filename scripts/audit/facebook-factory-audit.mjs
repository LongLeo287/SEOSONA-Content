import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const results = [];
const strict = process.argv.includes('--strict');

function record(id, status, evidence) { results.push({ id, status, evidence }); }
async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function json(file) { return JSON.parse(await readFile(file, 'utf8')); }
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((output, key) => {
    output[key] = canonicalize(value[key]);
    return output;
  }, {});
  return value;
}
function canonicalDigest(value) { return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex'); }

async function auditContent() {
  const manifest = await json(join(projectRoot, 'extension', 'manifest.json'));
  const forbiddenFacebookAccess = [...(manifest.permissions || []), ...(manifest.host_permissions || [])]
    .some((value) => /facebook\.com|facebook.*oauth|publish/i.test(String(value)));
  record('CONTENT_NO_FACEBOOK_ACCESS', forbiddenFacebookAccess ? 'fail' : 'pass', 'Manifest contains no Facebook host, OAuth, scheduling, or publishing access.');

  const required = [
    'extension/lib/facebook-factory.js',
    'extension/lib/facebook-batch.js',
    'extension/lib/facebook-state.js',
    'extension/lib/facebook-provider-lease.js',
    'extension/lib/facebook-orchestrator.js',
    'scripts/companion/facebook-companion.mjs',
    'scripts/companion/facebook-runner.mjs',
    'scripts/companion/facebook-library.mjs',
  ];
  const missing = [];
  for (const item of required) if (!await exists(join(projectRoot, ...item.split('/')))) missing.push(item);
  record('CONTENT_RUNTIME_COMPONENTS', missing.length ? 'fail' : 'pass', missing.length ? `Missing: ${missing.join(', ')}` : 'Control plane, state reducer, Companion, Flow adapter, and library writer are present.');

  const source = await readFile(join(projectRoot, 'extension', 'lib', 'facebook-orchestrator.js'), 'utf8');
  const background = await readFile(join(projectRoot, 'extension', 'background.js'), 'utf8');
  const companion = await readFile(join(projectRoot, 'scripts', 'companion', 'facebook-companion.mjs'), 'utf8');
  const resumable = /persist\(current\)/.test(source) && /resume/.test(source) && /clientRef/.test(source)
    && /chrome\.alarms\.onAlarm/.test(background) && /\/v1\/flow\/jobs/.test(companion);
  record('CONTENT_RESUMABLE_STATE', resumable ? 'pass' : 'fail', 'Orchestrator persists transitions, uses short Companion visual jobs, and wakes through Chrome alarms with stable client references.');
}

async function auditOsAndBrand() {
  const osRoot = resolve(process.env.SEOSONA_ROOT || join(homedir(), '.seosona'));
  const contextFile = resolve(process.env.SEOSONA_CONTENT_CONTEXT_FILE || join(osRoot, '3_MEMORY', 'projects', 'seosona-content', 'facebook-group-factory', 'context.v1.json'));
  if (!await exists(contextFile)) {
    record('OS_CONTEXT', 'fail', 'Versioned OS Facebook context was not found through SEOSONA_ROOT or SEOSONA_CONTENT_CONTEXT_FILE.');
    return;
  }
  const context = await json(contextFile);
  const root = dirname(contextFile);
  const policy = await json(resolve(root, context.sources.policy));
  const brand = await json(resolve(root, context.sources.brand));
  const size = policy.policy && policy.policy.batchSize;
  const validSize = size && Number.isInteger(size.default) && Number.isInteger(size.min) && Number.isInteger(size.max) && size.min <= size.default && size.default <= size.max;
  record('OS_BATCH_POLICY', validSize ? 'pass' : 'fail', validSize ? `Batch policy ${size.min}..${size.max}, default ${size.default}.` : 'OS batchSize policy is absent or invalid.');
  record('OS_NO_PUBLISH_POLICY', policy.policy && policy.policy.facebookPublishing === 'not_supported_in_v1' ? 'pass' : 'fail', 'OS policy must explicitly keep Facebook publishing disabled.');

  const kitFile = process.env.SEOSONA_BRAND_KIT_FILE || (process.env.SEOSONA_VIDEO_ROOT
    ? join(resolve(process.env.SEOSONA_VIDEO_ROOT), '7_ASSETS', 'brand', 'SEOSONA', 'brand-kit.v1.json') : '');
  if (!kitFile) {
    record('VIDEO_BRAND_KIT', strict ? 'fail' : 'warn', 'Set SEOSONA_BRAND_KIT_FILE or SEOSONA_VIDEO_ROOT for physical BrandKit verification.');
    return;
  }
  const bytes = await readFile(resolve(kitFile));
  const kit = JSON.parse(bytes.toString('utf8'));
  const reference = brand.brand && brand.brand.visual && brand.brand.visual.brandKit;
  const valid = reference && reference.version === kit.version && reference.sha256 === canonicalDigest(kit)
    && kit.typography && kit.typography.family === 'Be Vietnam Pro' && kit.palette && Array.isArray(kit.components) && Array.isArray(kit.negativeRules);
  record('VIDEO_BRAND_KIT', valid ? 'pass' : 'fail', valid ? `BrandKit ${kit.version} digest and required fields match OS.` : 'Physical BrandKit does not match the OS reference or required contract.');
}

async function auditFlow() {
  const flowRoot = process.env.SEOSONA_FLOW_ROOT;
  if (!flowRoot) {
    record('FLOW_CONTRACT', strict ? 'fail' : 'warn', 'Set SEOSONA_FLOW_ROOT for local Flow contract verification.');
    return;
  }
  const serverFile = join(resolve(flowRoot), 'mcp-local', 'server.mjs');
  const schemaFile = join(resolve(flowRoot), 'mcp-local', 'contracts', 'flow-asset.schema.json');
  if (!await exists(serverFile) || !await exists(schemaFile)) {
    record('FLOW_CONTRACT', 'fail', 'Flow MCP server or asset schema is missing.');
    return;
  }
  const [server, schema] = await Promise.all([readFile(serverFile, 'utf8'), json(schemaFile)]);
  const valid = schema.contractVersion === '1.1.0' && /const CONTRACT_VERSION = '1\.1\.0'/.test(server)
    && /health/.test(server) && /list_capabilities/.test(server) && /get_provider_status/.test(server) && /gen_image/.test(server);
  record('FLOW_CONTRACT', valid ? 'pass' : 'fail', valid ? 'Flow MCP contract 1.1.0 and required handshake/image tools are present.' : 'Flow MCP contract or required tools are incompatible.');
}

await auditContent();
await auditOsAndBrand();
await auditFlow();

const summary = {
  contractVersion: '1.0',
  mode: strict ? 'strict' : 'development',
  generatedAt: new Date().toISOString(),
  status: results.some((item) => item.status === 'fail') ? 'fail' : results.some((item) => item.status === 'warn') ? 'pass_with_warnings' : 'pass',
  counts: results.reduce((out, item) => ({ ...out, [item.status]: (out[item.status] || 0) + 1 }), {}),
  results,
};
console.log(JSON.stringify(summary, null, 2));
if (summary.status === 'fail') process.exitCode = 1;
