// 只把密文持久化；口令和派生密钥不落盘，也不内置可逆的“固定加密密钥”。
export const VAULT_PASSWORD = Object.freeze({ min: 12, max: 256 });
const ITERATIONS = 600000;
const encoder = new TextEncoder();
export function validateVaultPassword(value) {
  if (typeof value !== 'string' || value.length < VAULT_PASSWORD.min || value.length > VAULT_PASSWORD.max || !value.trim()) throw new Error(`加密口令应为 ${VAULT_PASSWORD.min}～${VAULT_PASSWORD.max} 个字符，不能全为空白；请妥善保管，无法找回`);
  return value;
}
function encode(bytes) { return btoa(String.fromCharCode(...bytes)); }
function decode(text, size) {
  if (typeof text !== 'string' || text.length > 32768 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw new Error('密文格式不正确');
  const bytes = Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  if (size && bytes.length !== size) throw new Error('密文格式不正确');
  return bytes;
}
async function derive(password, salt, usage) {
  const source = await crypto.subtle.importKey('raw', encoder.encode(validateVaultPassword(password)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, source, { name: 'AES-GCM', length: 256 }, false, [usage]);
}
function context(origin) { return encoder.encode(JSON.stringify({ version: 1, origin })); }
export async function encryptApiKey(origin, key, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const secret = await derive(password, salt, 'encrypt');
  const bytes = encoder.encode(key);
  if (bytes.length > 16384) throw new Error('API Key 过长，无法加密保存；请核对凭证');
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: context(origin) }, secret, bytes);
  return { version: 1, origin, cipher: 'AES-GCM', kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
}
export async function decryptApiKey(vault, password) {
  validateVaultPassword(password);
  try {
    if (vault?.version !== 1 || vault.cipher !== 'AES-GCM' || vault.kdf !== 'PBKDF2-SHA256' || vault.iterations !== ITERATIONS || typeof vault.origin !== 'string' || new URL(vault.origin).origin !== vault.origin) throw new Error('密文格式不正确');
    const salt = decode(vault.salt, 16), iv = decode(vault.iv, 12), ciphertext = decode(vault.ciphertext);
    const secret = await derive(password, salt, 'decrypt');
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: context(vault.origin) }, secret, ciphertext);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { throw new Error('解锁失败：口令错误或密文已损坏。可重试，或清除后重新填写 API Key'); }
}
