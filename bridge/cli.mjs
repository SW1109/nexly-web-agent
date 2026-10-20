import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import { access, readFile, stat, mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir, tmpdir, platform } from 'node:os';
import { join, dirname, resolve, isAbsolute, delimiter, extname } from 'node:path';
import { PROVIDERS, CLI_TIMEOUT_MS, CLI_PROGRESS_LABELS, ANSWER_SCHEMA, buildPrompt, parseAnswer, validateQuestion } from '../extension/lib/contracts.js';

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
  if (/CERT_|certificate|self.signed|unable to verify|TLS.*(?:fail|error)/i.test(output)) return 'CLI TLS 证书校验失败，请检查 Node 的受信任证书与代理配置；不要关闭证书校验';
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
  const windows = platform() === 'win32';
  const pathKey = windows ? Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') : 'PATH';
  const dirs = [...(process.env[pathKey] || '').split(delimiter).map((dir) => windows ? dir.replace(/^"(.*)"$/, '$1') : dir), join(homedir(), '.local/bin'), join(homedir(), '.npm-global/bin')];
  if (windows) {
    dirs.push(dirname(process.execPath), join(process.env.APPDATA || join(homedir(), 'AppData/Roaming'), 'npm'));
    if (name === 'codex') {
      const appBin = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData/Local'), 'OpenAI/Codex/bin');
      dirs.push(appBin);
      try {
        const versions = await Promise.all((await readdir(appBin, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map(async (entry) => {
          const dir = join(appBin, entry.name);
          return { dir, modified: (await stat(join(dir, 'codex.exe')).catch(() => null))?.mtimeMs || 0 };
        }));
        dirs.push(...versions.filter(({ modified }) => modified).sort((a, b) => b.modified - a.modified || b.dir.localeCompare(a.dir)).map(({ dir }) => dir));
      } catch {}
    }
  } else {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin');
    try { const versions = (await readdir(join(homedir(), '.nvm/versions/node'))).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); for (const version of versions) dirs.push(join(homedir(), '.nvm/versions/node', version, 'bin')); } catch {}
  }
  if (name === 'codex' && platform() === 'darwin') dirs.push('/Applications/ChatGPT.app/Contents/Resources', '/Applications/Codex.app/Contents/Resources');
  return [...new Set(dirs.filter(Boolean))].flatMap((dir) => (windows ? ['.exe', '.com', '.cmd', '.bat'] : ['']).map((suffix) => join(dir, name + suffix)));
}
export async function resolveCommand(name, config) {
  if (!PROVIDERS.includes(name)) throw new Error('不支持的 CLI');
  config ??= await readLocalConfig();
  for (const candidate of await commandCandidates(name, config)) {
    try { await access(candidate, constants.X_OK); if ((await stat(candidate)).isFile()) return resolve(candidate); } catch {}
  }
  throw new Error(`找不到 ${name} CLI，请先安装并在终端完成登录`);
}
function cliHome(provider, env = process.env, home = homedir()) {
  const folder = provider === 'qwen' ? env.QWEN_HOME : provider === 'kimi' ? env.KIMI_SHARE_DIR : null;
  if (folder && !isAbsolute(folder)) throw new Error(`${provider} 配置目录环境变量必须是绝对路径`);
  return folder || join(home, '.' + provider);
}
function cliConfigFiles(provider, env = process.env, home = homedir()) {
  if (provider === 'codex') return [join(env.CODEX_HOME || join(home, '.codex'), 'config.toml')];
  if (provider === 'claude') return [join(home, '.claude/settings.json')];
  const dir = cliHome(provider, env, home);
  return provider === 'kimi' ? [join(dir, 'config.toml'), join(dir, 'config.json')] : [join(dir, 'settings.json'), join(dir, '.env')];
}
export async function configMetadata(provider) {
  return Promise.all(cliConfigFiles(provider).map(async (file) => { try { const info = await stat(file); return { label: file.replace(homedir(), '~'), exists: true, updatedAt: info.mtime.toISOString() }; } catch { return { label: file.replace(homedir(), '~'), exists: false, updatedAt: null }; } }));
}
function qwenSystemPaths(env) {
  const system = env.QWEN_CODE_SYSTEM_SETTINGS_PATH || (platform() === 'darwin' ? '/Library/Application Support/QwenCode/settings.json' : platform() === 'win32' ? 'C:\\ProgramData\\qwen-code\\settings.json' : '/etc/qwen-code/settings.json');
  return [system, env.QWEN_CODE_SYSTEM_DEFAULTS_PATH || join(dirname(system), 'system-defaults.json')];
}
export async function assertCliIsolation(provider, env = process.env, home = homedir()) {
  if (!['qwen', 'kimi'].includes(provider)) return;
  const files = cliConfigFiles(provider, env, home).filter((file) => !file.endsWith('.env'));
  if (provider === 'qwen') files.push(...qwenSystemPaths(env));
  for (const file of files) {
    let source;
    try { source = await readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') continue; throw new Error(`${provider} 配置无法安全读取，任务未启动`); }
    let hasHooks = false;
    if (file.endsWith('.json')) {
      let settings;
      try { settings = JSON.parse(source); } catch { throw new Error(`${provider} 配置不是标准 JSON（可能包含注释），无法安全检查；请使用标准 JSON 配置或 API 模式`); }
      hasHooks = ['hooks', 'systemHooks', 'userHooks', 'projectHooks'].some((key) => Object.hasOwn(settings || {}, key));
      if (provider === 'qwen' && settings?.memory?.mem0) throw new Error('Qwen 配置包含外部记忆服务，无法保证纯问答隔离；请改用独立配置或 API 模式');
    } else {
      // TOML 可使用引号和 Unicode 转义键名；只为保守检测解码，不重写用户配置。
      const decoded = source.replace(/\\u([0-9a-f]{4})|\\U([0-9a-f]{8})/gi, (_, short, long) => { const code = parseInt(short || long, 16); return code <= 0x10ffff ? String.fromCodePoint(code) : ''; });
      hasHooks = /(?:^|\n)\s*(?:["']?hooks["']?\s*=|\[\[?\s*["']?hooks["']?\s*(?:\.|\]))/m.test(decoded);
    }
    if (hasHooks) throw new Error(`${provider} 配置包含 hooks，无法保证纯问答隔离；请使用无 hooks 的 CLI 配置，或改用 API 模式`);
  }
  if (provider === 'kimi') {
    // Kimi --print 会自动批准工具；空 agent 之外还必须拒绝额外插件工具。
    const plugins = await readdir(join(cliHome(provider, env, home), 'plugins')).catch((error) => { if (error.code === 'ENOENT') return []; throw new Error('Kimi 插件目录无法安全检查，任务未启动'); });
    if (plugins.length) throw new Error('Kimi 配置存在插件，无法保证纯问答隔离；请使用无插件的 CLI 配置，或改用 API 模式');
  }
}
async function processCommand(command, args) {
  if (platform() !== 'win32') return { command, args };
  if (/^\.(?:[cm]?js)$/i.test(extname(command))) return { command: process.execPath, args: [command, ...args] };
  if (!/\.(?:cmd|bat)$/i.test(command)) return { command, args };
  // Standard npm shims launch one Node entry with %*. Run that entry directly:
  // cmd.exe would expand percent variables and reinterpret JSON or shell metacharacters.
  const shim = await readFile(command, 'utf8');
  const invocation = /(?:"%_prog%"|"%(?:~dp0|dp0%)[\\/]node\.exe"|\bnode(?:\.exe)?)\s+"((?:%~dp0|%dp0%)[\\/][^"\r\n]+)"\s+%\*\s*$/gim;
  for (const match of shim.matchAll(invocation)) {
    const relative = match[1].replace(/^(?:%~dp0|%dp0%)[\\/]/i, '');
    const entry = resolve(dirname(command), relative);
    if ((await stat(entry).catch(() => null))?.isFile()) return { command: process.execPath, args: [entry, ...args] };
  }
  throw new Error('Windows CLI 批处理不是可识别的标准 npm Node 启动脚本，请配置 CLI 的 .exe 或 JavaScript 入口绝对路径');
}
function windowsProcessTree(child) {
  if (!child.pid) return Promise.resolve();
  return new Promise((done) => {
    const killer = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
    let settled = false;
    const finish = (failed = false) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (failed) { try { child.kill(); } catch {} }
      done();
    };
    const timer = setTimeout(() => { try { killer.kill(); } catch {} finish(true); }, 5000);
    killer.once('error', () => finish(true));
    killer.once('close', (code) => finish(code !== 0));
  });
}
export async function runProcess(command, args, { cwd, stdin = '', signal, timeoutMs = CLI_TIMEOUT_MS, timeoutMessage, onStdout = () => {}, onStderr = () => {}, env = childEnvironment(), maxBytes = 2 * 1024 * 1024 } = {}) {
  if (signal?.aborted) throw new Error('任务已停止');
  const executable = await processCommand(command, args);
  return new Promise((resolveResult, reject) => {
    if (signal?.aborted) { reject(new Error('任务已停止')); return; }
    const childEnv = { ...env };
    const pathKeys = Object.keys(childEnv).filter((key) => platform() === 'win32' ? key.toUpperCase() === 'PATH' : key === 'PATH');
    const existingPath = pathKeys.map((key) => childEnv[key]).filter(Boolean).join(delimiter);
    for (const key of pathKeys) delete childEnv[key];
    childEnv.PATH = `${dirname(process.execPath)}${delimiter}${existingPath}`;
    const child = spawn(executable.command, executable.args, { cwd, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true, detached: platform() !== 'win32' });
    let stdout = '', stderr = '', bytes = 0, finished = false, terminationReason = null, killTimer, terminationPromise;
    const terminate = (reason) => {
      if (finished || terminationReason) return;
      terminationReason = reason;
      if (platform() === 'win32') { terminationPromise = windowsProcessTree(child); return; }
      const kill = (sig) => { try { process.kill(-child.pid, sig); } catch {} };
      kill('SIGTERM'); killTimer = setTimeout(() => kill('SIGKILL'), 1500); killTimer.unref();
    };
    const timer = setTimeout(() => terminate(timeoutMessage?.() || 'CLI 请求超时，任务已停止'), timeoutMs);
    const onAbort = () => terminate('任务已停止'); signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => { finished = true; clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', onAbort); };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { bytes += Buffer.byteLength(chunk); if (bytes > maxBytes) terminate('CLI 输出超过处理范围'); else { stdout += chunk; onStdout(chunk); } });
    child.stderr.on('data', (chunk) => { bytes += Buffer.byteLength(chunk); if (bytes > maxBytes) terminate('CLI 输出超过处理范围'); else { stderr = (stderr + chunk).slice(-16000); onStderr(chunk); } });
    child.stdin.on('error', () => {});
    child.on('error', () => { cleanup(); reject(new Error('无法启动 CLI，请检查命令路径与运行权限')); });
    child.on('close', async (code) => { await terminationPromise; cleanup(); if (terminationReason) reject(new Error(terminationReason)); else if (code !== 0) reject(new Error(cliFailure(code, stderr, stdout))); else resolveResult({ stdout, stderr }); });
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
  return ['--prompt', '仅按标准输入的 JSON 契约回答，不调用任何工具。', '--output-format', 'stream-json', '--approval-mode', 'default', '--allowed-mcp-server-names', '__nexly_no_mcp__', '--admin-policy', policyPath, '--extensions', 'none'];
}
export function qwenArguments() {
  // 非空但不匹配任何真实工具的白名单，避免空列表被 CLI 解释成“启用默认工具”。
  return ['--prompt', '', '--output-format', 'json', '--approval-mode', 'default', '--core-tools', '__nexly_no_tools__', '--allowed-mcp-server-names', '__nexly_no_mcp__', '--extensions', 'none'];
}
export function kimiArguments(agentPath, mcpPath, skillsPath) {
  return ['--print', '--output-format', 'text', '--final-message-only', '--agent-file', agentPath, '--mcp-config-file', mcpPath, '--skills-dir', skillsPath];
}
// Gemini 的事件流只在本地解析：向浏览器发送固定阶段，不转发题干、回答片段或原始 stderr。
export function createGeminiStream(onStatus = () => {}) {
  let pending = '', content = '', result = null, malformed = false, stage = 'starting', model = '', reportedModel = '';
  // token 分片可能高频到达；仅阶段/模型变更即时上报，进度心跳仍保持两秒一次。
  const update = (next) => { if (stage === next && model === reportedModel) return; stage = next; reportedModel = model; onStatus({ stage, ...(model ? { model } : {}) }); };
  const line = (source) => {
    if (!source.trim()) return;
    let event;
    try { event = JSON.parse(source); } catch { malformed = true; return; }
    if (event?.type === 'init') {
      model = typeof event.model === 'string' && /^[a-zA-Z0-9_./:-]{1,100}$/.test(event.model) ? event.model : '';
      update('waiting');
    } else if (event?.type === 'message' && event.role === 'assistant' && typeof event.content === 'string') {
      content = event.delta === true ? content + event.content : event.content;
      update('receiving');
    } else if (event?.type === 'result') { result = event; update('finishing'); }
  };
  return {
    get stage() { return stage; },
    feed(chunk) {
      pending += chunk;
      let index;
      while ((index = pending.indexOf('\n')) >= 0) { line(pending.slice(0, index)); pending = pending.slice(index + 1); }
    },
    diagnose(chunk) { if (/429|Too Many Requests|retrying|retry attempt|backoff/i.test(chunk)) update('retrying'); },
    finish() {
      if (pending.trim()) { line(pending); pending = ''; }
      if (malformed || !result) throw new Error('Gemini CLI 事件流不完整，未收到最终结果，不会使用部分回答');
      if (result.status !== 'success' || result.error) throw new Error(cliFailure('error', String(result.error?.message || result.error || ''), ''));
      if (!content.trim()) throw new Error('Gemini CLI 未返回答案内容，请检查当前源与模型的非交互调用支持');
      return content;
    }
  };
}
export function decodeCliResult(provider, stdout, savedOutput, question) {
  if (provider === 'codex') return parseAnswer(savedOutput, question);
  if (provider === 'kimi') return parseAnswer(stdout, question);
  let envelope;
  try { envelope = JSON.parse(stdout.trim()); } catch {
    if (provider === 'gemini') { const stream = createGeminiStream(); stream.feed(stdout); return parseAnswer(stream.finish(), question); }
    throw new Error(`${provider} CLI 未返回约定的 JSON 输出，请检查版本`);
  }
  if (envelope.is_error || envelope.error) throw new Error(cliFailure('error', String(envelope.error?.message || envelope.result || ''), ''));
  const content = provider === 'claude' ? envelope.structured_output ?? envelope.result : provider === 'qwen' ? envelope.result ?? envelope.response : envelope.response;
  if (content == null) throw new Error('CLI 输出缺少答案，请检查 CLI 版本或供应商是否支持结构化输出');
  return parseAnswer(content, question);
}
export async function health() {
  const config = await readLocalConfig();
  const providers = await Promise.all(PROVIDERS.map(async (id) => {
    try { const command = await resolveCommand(id, config); const { stdout } = await runProcess(command, ['--version'], { timeoutMs: 6000 }); return { id, installed: true, command, version: redact(stdout.trim()), configs: await configMetadata(id) }; }
    catch (error) { return { id, installed: false, error: error.message, configs: await configMetadata(id).catch(() => []) }; }
  }));
  return { hostVersion: '0.1.0', nodeVersion: process.version, providers, authenticationChecked: false, configPolicy: '每次任务启动新 CLI 进程；下一次请求读取 CLI 当前配置。' };
}
export async function solveWithCli(provider, rawQuestion, { signal, onProgress = () => {}, timeoutMs = CLI_TIMEOUT_MS } = {}) {
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
    // 固定本次检测的配置根，避免 CLI 再次读取 .env 后重定向到未经隔离检查的目录。
    if (provider === 'qwen') { env.QWEN_HOME = cliHome(provider, env); [env.QWEN_CODE_SYSTEM_SETTINGS_PATH, env.QWEN_CODE_SYSTEM_DEFAULTS_PATH] = qwenSystemPaths(env); }
    await assertCliIsolation(provider, env);
    if (provider === 'gemini' || provider === 'qwen') {
      // 仅信任桥接器刚创建的临时目录；不修改用户 trustedFolders，也不允许工具执行。
      if (provider === 'gemini') env.GEMINI_CLI_TRUST_WORKSPACE = 'true';
      // 独立临时目录可能不会加载用户 .env；每次重读正式配置，只向子进程传递鉴权/模型字段。
      try {
        const values = parseEnv(await readFile(join(cliHome(provider, env), '.env'), 'utf8'));
        for (const [key, value] of Object.entries(values)) if ((provider === 'gemini' ? /^(GEMINI_|GOOGLE_)/ : /^(?:OPENAI_(?:API_KEY|BASE_URL|MODEL)|QWEN_(?:API_KEY|MODEL)|DASHSCOPE_API_KEY)$/).test(key)) env[key] = value;
      } catch (error) { if (error.code !== 'ENOENT') throw new Error(`无法读取 ${provider} CLI 的现有 .env 配置`); }
    }
    const agentPath = join(cwd, 'agent.yaml'), mcpPath = join(cwd, 'mcp.json');
    if (provider === 'kimi') {
      await writeFile(join(cwd, 'system.md'), '只处理用户给出的练习题数据，按用户指定 JSON Schema 返回答案。不调用工具，不访问文件，不执行命令。', { mode: 0o600 });
      await writeFile(agentPath, 'version: 1\nagent:\n  name: nexly-answer-only\n  system_prompt_path: ./system.md\n  tools: []\n  subagents: {}\n', { mode: 0o600 });
      await writeFile(mcpPath, '{"mcpServers":{}}', { mode: 0o600 });
    }
    const args = provider === 'codex' ? codexArguments(schemaPath, outputPath) : provider === 'claude' ? claudeArguments(ANSWER_SCHEMA) : provider === 'qwen' ? qwenArguments() : provider === 'kimi' ? kimiArguments(agentPath, mcpPath, cwd) : geminiArguments(policyPath);
    const startedAt = Date.now(), deadlineMs = Math.min(600000, Math.max(10000, timeoutMs));
    let status = provider === 'gemini' ? { stage: 'starting' } : {};
    const progress = () => onProgress({ provider, phase: 'running', ...status, elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000) });
    const stream = provider === 'gemini' ? createGeminiStream((next) => { status = next; progress(); }) : null;
    progress(); heartbeat = setInterval(progress, 2000);
    const { stdout } = await runProcess(command, args, { cwd, env, stdin: buildPrompt(question), signal, timeoutMs: deadlineMs,
      ...(stream ? { onStdout: (chunk) => stream.feed(chunk), onStderr: (chunk) => stream.diagnose(chunk),
        timeoutMessage: () => `Gemini CLI 请求超时（${Math.round(deadlineMs / 1000)} 秒）：${CLI_PROGRESS_LABELS[stream.stage]}。任务已停止；请在终端用 -p 和 --output-format stream-json 核对同一源、同一模型的非交互请求，交互模式可用不代表此调用可用。` } : {}) });
    const saved = provider === 'codex' ? await readFile(outputPath, 'utf8').catch(() => '') : null;
    const answer = decodeCliResult(provider, stdout, saved, question);
    return { answer, provider, elapsedMs: Date.now() - startedAt, configMetadata: await configMetadata(provider) };
  } finally {
    clearInterval(heartbeat);
    // 只清理本次创建的独立临时目录，不接触用户工作区或 CLI 凭据。
    await rm(cwd, { recursive: true, force: true });
  }
}
