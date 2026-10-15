import { LIMITS } from '../extension/lib/contracts.js';

export function encodeFrame(value, max = LIMITS.outputFrame) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length > max) throw new Error('本地消息超过长度限制');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}
export class FrameDecoder {
  constructor(onMessage, onError, max = LIMITS.inputFrame) { this.buffer = Buffer.alloc(0); this.onMessage = onMessage; this.onError = onError; this.max = max; this.failed = false; }
  push(chunk) {
    if (this.failed) return;
    try {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      while (this.buffer.length >= 4) {
        const size = this.buffer.readUInt32LE(0);
        if (!size || size > this.max) throw new Error('Native Messaging 输入长度无效');
        if (this.buffer.length < size + 4) return;
        const message = JSON.parse(this.buffer.subarray(4, size + 4).toString('utf8'));
        this.buffer = this.buffer.subarray(size + 4);
        this.onMessage(message);
      }
    } catch (error) { this.failed = true; this.buffer = Buffer.alloc(0); this.onError(error); }
  }
  finish() { if (this.buffer.length && !this.failed) { this.failed = true; this.onError(new Error('Native Messaging 消息被截断')); } }
}
