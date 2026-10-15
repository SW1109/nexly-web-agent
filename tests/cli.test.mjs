import test from 'node:test';
import assert from 'node:assert/strict';
import { cliFailure, childEnvironment, redact, claudeArguments, codexArguments, geminiArguments, decodeCliResult, runProcess } from '../bridge/cli.mjs';
import { ANSWER_SCHEMA } from '../extension/lib/contracts.js';
import { single, correct } from './data.mjs';

test('does not carry stale provider variables into a new CLI process', () => {
  const base = { PATH: '/usr/bin', OPENAI_API_KEY: 'secret', ANTHROPIC_BASE_URL: 'old-route', GEMINI_API_KEY: 'secret', GEMINI_MODEL: 'old-model', CODEX_HOME: '/configured/path', CLAUDECODE: 'nested', HTTPS_PROXY: 'proxy' };
  const env = childEnvironment(base);
  assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.ANTHROPIC_BASE_URL, undefined); assert.equal(env.GEMINI_API_KEY, undefined); assert.equal(env.GEMINI_MODEL, undefined); assert.equal(env.CLAUDECODE, undefined);
  assert.equal(env.CODEX_HOME, base.CODEX_HOME); assert.equal(env.HTTPS_PROXY, base.HTTPS_PROXY); assert.equal(base.OPENAI_API_KEY, 'secret');
});
test('CLI adapters do not override ccSwitch model and do not enable approval bypasses', () => {
  const args = [codexArguments('/schema', '/output'), claudeArguments(ANSWER_SCHEMA), geminiArguments('/deny-tools.toml')];
  for (const list of args) { assert.ok(!list.includes('--model')); assert.ok(!list.includes('--yolo')); assert.ok(!list.some((item) => /dangerously/.test(item))); }
  assert.ok(args[0].includes('mcp_servers={}')); assert.ok(args[0].includes('--ephemeral'));
  assert.equal(args[1][args[1].indexOf('--tools') + 1], ''); assert.ok(args[1].includes('--strict-mcp-config'));
  assert.ok(args[2].includes('--admin-policy')); assert.equal(args[2].at(-1), 'none');
});
test('normalizes all supported CLI envelopes to the same strict answer', () => {
  assert.deepEqual(decodeCliResult('codex', '', JSON.stringify(correct), single), correct);
  assert.deepEqual(decodeCliResult('claude', JSON.stringify({ structured_output: correct }), null, single), correct);
  assert.deepEqual(decodeCliResult('claude', JSON.stringify({ result: JSON.stringify(correct) }), null, single), correct);
  assert.deepEqual(decodeCliResult('gemini', JSON.stringify({ response: JSON.stringify(correct) }), null, single), correct);
});
test('CLI error payloads are never mistaken for valid answers', () => {
  assert.throws(() => decodeCliResult('claude', JSON.stringify({ is_error: true, result: 'failure' }), null, single));
  assert.throws(() => decodeCliResult('gemini', JSON.stringify({ error: { message: 'failure' } }), null, single));
  assert.throws(() => decodeCliResult('gemini', 'not JSON', null, single));
});
test('redacts bearer, conventional keys and JSON-shaped secret values', () => {
  const raw = 'Authorization: Bearer TOKENVALUE OPENAI_API_KEY=secret123 {"api_key":"private-token"} sk-12345678901234567890';
  const cleaned = redact(raw);
  for (const secret of ['TOKENVALUE', 'secret123', 'private-token', 'sk-12345678901234567890']) assert.ok(!cleaned.includes(secret));
});
test('spawns without a shell and keeps UTF-8 intact across stdout chunks', async () => {
  const program = `const b=Buffer.from('中文🧩');process.stdout.write(b.subarray(0,2));setTimeout(()=>process.stdout.write(b.subarray(2)),15);`;
  assert.equal((await runProcess(process.execPath, ['-e', program])).stdout, '中文🧩');
  const literal = '; echo $HOME';
  assert.equal((await runProcess(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', literal])).stdout, literal);
});
test('cancels or times out a child process and limits stdout', async () => {
  const controller = new AbortController();
  const task = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal });
  setTimeout(() => controller.abort(), 40);
  await assert.rejects(task, /停止/);
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 40 }), /超时/);
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.stdout.write("a".repeat(10000))'], { maxBytes: 100 }), /超过/);
});

test('summarizes provider failures without exposing echoed prompts or local context', () => {
  const secretPrompt = 'QUESTION_DATA: private problem and local context';
  assert.match(cliFailure(1, secretPrompt + '\nERROR: 429 Too Many Requests'), /429/);
  assert.ok(!cliFailure(1, secretPrompt).includes('private'));
  assert.match(cliFailure(1, '401 unauthorized'), /认证/);
  assert.match(cliFailure(1, 'ECONNREFUSED'), /无法连接/);
});
