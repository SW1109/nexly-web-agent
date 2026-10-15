import { FrameDecoder, encodeFrame } from './framing.mjs';
import { health, solveWithCli, redact } from './cli.mjs';
import { VERSION, PROVIDERS } from '../extension/lib/contracts.js';

let active = null;
function send(value) { try { process.stdout.write(encodeFrame(value)); } catch { process.exitCode = 1; process.stdin.destroy(); } }
async function handle(message) {
  const id = message?.requestId;
  try {
    if (typeof id !== 'string' || id.length > 100 || message.version !== VERSION) throw new Error('本地桥接消息版本或标识不正确');
    if (message.action === 'health') { send({ requestId: id, type: 'result', data: await health() }); return; }
    if (message.action === 'cancel') {
      if (active && (!message.targetId || message.targetId === active.id)) { const canceled = active; canceled.controller.abort(); await canceled.done; }
      send({ requestId: id, type: 'result', data: { canceled: true } }); return;
    }
    if (message.action !== 'solve' || !PROVIDERS.includes(message.provider)) throw new Error('不允许的本地操作');
    if (active) throw new Error('已有 CLI 任务在运行，请先停止或等待完成');
    const controller = new AbortController(); let finish;
    const done = new Promise((resolve) => { finish = resolve; });
    active = { id, controller, done };
    try {
      const data = await solveWithCli(message.provider, message.question, { signal: controller.signal, onProgress: (progress) => send({ requestId: id, type: 'progress', data: progress }) });
      send({ requestId: id, type: 'result', data });
    } finally { if (active?.id === id) active = null; finish(); }
  } catch (error) { send({ requestId: typeof id === 'string' ? id : null, type: 'error', error: redact(error.message) }); }
}
const decoder = new FrameDecoder((message) => { void handle(message); }, () => { active?.controller.abort(); process.exitCode = 1; process.stdin.destroy(); });
process.stdin.on('data', (chunk) => decoder.push(chunk));
process.stdin.on('end', () => { decoder.finish(); active?.controller.abort(); });
process.on('SIGTERM', () => { active?.controller.abort(); process.stdin.destroy(); process.exitCode = 0; });
process.on('uncaughtException', () => { active?.controller.abort(); process.exit(1); });
