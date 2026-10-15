import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import { access, readFile, stat, mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir, tmpdir, platform } from 'node:os';
import { join, dirname, resolve, isAbsolute, delimiter } from 'node:path';
import { PROVIDERS, ANSWER_SCHEMA, buildPrompt, parseAnswer, validateQuestion } from '../extension/lib/contracts.js';

export const CONFIG_PATH = join(homedir(), '.nexly-web-agent', 'config.json');
const SECRET_ENV = /^(?:ANTHROPIC_(?:API_KEY|AUTH_TOKEN|BASE_URL|MODEL|DEFAULT_.*_MODEL)|OPENAI_(?:API_KEY|BASE_URL)|GEMINI_(?:API_KEY|API_BASE_URL|BASE_URL|MODEL)|GOOGLE_(?:API_KEY|GEMINI_BASE_URL))$/;
export function childEnvironment(base = process.env) {
  // 不继承旧终端里的供应商密钥/地址，下一次新进程由 CLI 自己重读 ccSwitch 写入的配置。
  const env = Object.fromEntries(Object.entries(base).filter(([key]) => !SECRET_ENV.test(key)));
  env.NO_COLOR = '1'; env.TERM = 'dumb';
  delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}
export function redact(value) {
  return String(value).replace(/\x1b\[[0-9;]*m/g, '').replace(/(?:sk|ghp|AIza)[-_A-Za-z0-9]{12,}/g, '[已脱敏]').replace(/(Bearer\s+)\S+/gi, '$1[已脱敏]').replace(/((?:api[_-]?key|auth[_-]?token|password|secret|authorization)["']?\s*[=:]\s*["']?)[^"'\s,;}]+/gi, '$1[已脱敏]').slice(-1600);
}
export function cliFailure(code, stderr, stdout) {
  const output = String(stderr || stdout || '');
  if (/429|Too Many Requests|rate.?limit/i.test(output)) return 'CLI 服务返回 429：请求过于频繁或额度受限，请稍后再试或在 ccSwitch 切换可用源';
  if (/401|unauthorized|invalid.?api.?key|authentication.*fail/i.test(output)) return 'CLI 认证失败，请在终端检查当前账号或 ccSwitch 供应商配置';
  if (/403|forbidden/i.test(output)) return 'CLI 服务拒绝访问，请检查当前源的模型权限';
  if (/must specify.*(?:API_KEY|token)|not logged in|login required/i.test(output)) return 'CLI 尚未完成登录或当前凭据未生效，请先在终端完成配置';
  if (/not running in a trusted directory/i.test(output)) return 'CLI 拒绝在当前工作目录运行，请检查 CLI 信任配置与版本';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|Failed to connect|connection.*error/i.test(output)) return 'CLI 无法连接当前供应商，请检查源地址、代理和网络';
  if (/invalid transport|Error loading config|unknown option|unexpected argument/i.test(output)) return 'CLI 配置或参数与当前版本不兼容，请运行 doctor 并检查 CLI 版本';
  // 不把原始 stderr 回传给扩展：部分 CLI 会把整段题干、系统提示甚至本地上下文写进去。
  return `CLI 退出码 ${code}，未返回可用答案。请在终端检查 CLI 的当前登录、配置与服务状态。`;
}
async function readLocalConfig() {
  try { const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8')); return config && typeof config === 'object' ? config : {}; }
  catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('本地桥接配置无法读取，请检查 ~/.nexly-web-agent/config.json'); }
}
async function commandCandidates(name, config) {
  if (config.cliPaths?.[name]) {
    if (!isAbsolute(config.cliPaths[name])) throw new Error('CLI 自定义路径必须是绝对路径');
    return [config.cliPaths[name]];
  }
  const dirs = [...(process.env.PATH || '').split(delimiter), join(homedir(), '.local/bin'), join(homedir(), '.npm-global/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
  try { const versions = (await readdir(join(homedir(), '.nvm/versions/node'))).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); for (const version of versions) dirs.push(join(homedir(), '.nvm/versions/node', version, 'bin')); } catch {}
  if (name === 'codex' && platform() === 'darwin') dirs.push('/Applications/ChatGPT.app/Contents/Resources', '/Applications/Codex.app/Contents/Resources');
  return [...new Set(dirs.filter(Boolean))].map((dir) => join(dir, name + (platform() === 'win32' ? '.cmd' : '')));
}
export async function resolveCommand(name, config) {
  if (!PROVIDERS.includes(name)) throw new Error('不支持的 CLI');
  config ??= await readLocalConfig();
  for (const candidate of await commandCandidates(name, config)) {
    try { await access(candidate, constants.X_OK); return resolve(candidate); } catch {}
  }
  throw new Error(`找不到 ${name} CLI，请先安装并在终端完成登录`);
}
export async function configMetadata(provider) {
  const files = provider === 'codex' ? [join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml')] : provider === 'claude' ? [join(homedir(), '.claude/settings.json')] : [join(homedir(), '.gemini/settings.json'), join(homedir(), '.gemini/.env')];
  return Promise.all(files.map(async (file) => { try { const info = await stat(file); return { label: file.replace(homedir(), '~'), exists: true, updatedAt: info.mtime.toISOString() }; } catch { return { label: file.replace(homedir(), '~'), exists: false, updatedAt: null }; } }));
}
export function runProcess(command, args, { cwd, stdin = '', signal, timeoutMs = 180000, env = childEnvironment(), maxBytes = 2 * 1024 * 1024 } = {}) {
  return new Promise((resolveResult, reject) => {
    if (signal?.aborted) { reject(new Error('任务已停止')); return; }
    const child = spawn(command, args, { cwd, env: { ...env, PATH: `${dirname(process.execPath)}${delimiter}${env.PATH || ''}` }, stdio: ['pipe', 'pipe', 'pipe'], shell: false, detached: platform() !== 'win32' });
    let stdout = '', stderr = '', bytes = 0, finished = false, terminationReason = null, killTimer;
    const terminate = (reason) => {
      if (finished || terminationReason) return;
      terminationReason = reason;
      const kill = (sig) => { try { if (platform() === 'win32') child.kill(sig); else process.kill(-child.pid, sig); } catch {} };
      kill('SIGTERM'); killTimer = setTimeout(() => kill('SIGKILL'), 1500); killTimer.unref();
    };
    const timer = setTimeout(() => terminate('CLI 请求超时，任务已停止'), timeoutMs);
    const onAbort = () => terminate('任务已停止'); signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => { finished = true; clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', onAbort); };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { bytes += Buffer.byteLength(chunk); if (bytes > maxBytes) terminate('CLI 输出超过处理范围'); else stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { bytes += Buffer.byteLength(chunk); if (bytes > maxBytes) terminate('CLI 输出超过处理范围'); else stderr = (stderr + chunk).slice(-16000); });
    child.stdin.on('error', () => {});
    child.on('error', () => { cleanup(); reject(new Error('无法启动 CLI，请检查命令路径与运行权限')); });
    child.on('close', (code) => { cleanup(); if (terminationReason) reject(new Error(terminationReason)); else if (code !== 0) reject(new Error(cliFailure(code, stderr, stdout))); else resolveResult({ stdout, stderr }); });
    child.stdin.end(stdin);
  });
}
export function claudeArguments(schema) {
  return ['-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', 'user', '--settings', '{"disableAllHooks":true}', '--no-session-persistence', '--permission-mode', 'dontAsk'];
}
export function codexArguments(schemaPath, outputPath) {
  // 覆盖整个表，避免 CLI 的点路径解析把带引号的服务名当成另一个 MCP 服务。
  return ['exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '--disable', 'shell_tool', '--disable', 'plugins', '--disable', 'js_repl', '-c', 'web_search="disabled"', '-c', 'mcp_servers={}', '--output-schema', schemaPath, '--output-last-message', outputPath, '--color', 'never', '-'];
}
export function geminiArguments(policyPath) {
  return ['--prompt', '', '--output-format', 'json', '--approval-mode', 'default', '--admin-policy', policyPath, '--extensions', 'none'];
}
export function decodeCliResult(provider, stdout, savedOutput, question) {
  if (provider === 'codex') return parseAnswer(savedOutput, question);
  let envelope;
  try { envelope = JSON.parse(stdout.trim()); } catch { throw new Error(`${provider} CLI 未返回约定的 JSON 输出，请检查版本`); }
  if (envelope.is_error || envelope.error) throw new Error(cliFailure('error', String(envelope.error?.message || envelope.result || ''), ''));
  const content = provider === 'claude' ? envelope.structured_output ?? envelope.result : envelope.response;
  if (content == null) throw new Error('CLI 输出缺少答案，请检查 CLI 版本或供应商是否支持结构化输出');
  return parseAnswer(content, question);
}
export async function health() {
  const config = await readLocalConfig();
  const providers = await Promise.all(PROVIDERS.map(async (id) => {
    try { const command = await resolveCommand(id, config); const { stdout } = await runProcess(command, ['--version'], { timeoutMs: 6000 }); return { id, installed: true, command, version: redact(stdout.trim()), configs: await configMetadata(id) }; }
    catch (error) { return { id, installed: false, error: error.message, configs: await configMetadata(id) }; }
  }));
  return { hostVersion: '0.1.0', nodeVersion: process.version, providers, authenticationChecked: false, configPolicy: '每次任务启动新 CLI 进程；下一次请求读取 CLI 当前配置。' };
}
export async function solveWithCli(provider, rawQuestion, { signal, onProgress = () => {}, timeoutMs = 180000 } = {}) {
  const question = validateQuestion(rawQuestion);
  const config = await readLocalConfig();
  const command = await resolveCommand(provider, config);
  const cwd = await mkdtemp(join(tmpdir(), 'nexly-solve-'));
  const schemaPath = join(cwd, 'answer-schema.json'), outputPath = join(cwd, 'answer.json'), policyPath = join(cwd, 'deny-tools.toml');
  let heartbeat;
  try {
    await writeFile(schemaPath, JSON.stringify(ANSWER_SCHEMA), { mode: 0o600 });
    await writeFile(policyPath, '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 950\n', { mode: 0o600 });
    const env = childEnvironment();
    if (provider === 'gemini') {
      // 仅信任桥接器刚创建的临时目录；不修改用户 trustedFolders，也不允许工具执行。
      env.GEMINI_CLI_TRUST_WORKSPACE = 'true';
      // 独立临时目录下 Gemini 不一定加载用户 .env；每次重读 ccSwitch 的 live 文件，且只传给本地 CLI。
      try {
        const values = parseEnv(await readFile(join(homedir(), '.gemini/.env'), 'utf8'));
        for (const [key, value] of Object.entries(values)) if (/^(GEMINI_|GOOGLE_)/.test(key)) env[key] = value;
      } catch (error) { if (error.code !== 'ENOENT') throw new Error('无法读取 Gemini CLI 的现有 .env 配置'); }
    }
    const args = provider === 'codex' ? codexArguments(schemaPath, outputPath) : provider === 'claude' ? claudeArguments(ANSWER_SCHEMA) : geminiArguments(policyPath);
    onProgress({ provider, phase: 'running', elapsedSeconds: 0 });
    const startedAt = Date.now(); heartbeat = setInterval(() => onProgress({ provider, phase: 'running', elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000) }), 2000);
    const { stdout } = await runProcess(command, args, { cwd, env, stdin: buildPrompt(question), signal, timeoutMs: Math.min(600000, Math.max(10000, timeoutMs)) });
    const saved = provider === 'codex' ? await readFile(outputPath, 'utf8').catch(() => '') : null;
    const answer = decodeCliResult(provider, stdout, saved, question);
    return { answer, provider, elapsedMs: Date.now() - startedAt, configMetadata: await configMetadata(provider) };
  } finally {
    clearInterval(heartbeat);
    // 只清理本次创建的独立临时目录，不接触用户工作区或 CLI 凭据。
    await rm(cwd, { recursive: true, force: true });
  }
}
