export const PACING_FIELDS = Object.freeze({
  answerDelayMs: { label: '答案返回后等待', defaultValue: 1500, min: 0, max: 60000, step: 1 },
  actionIntervalMs: { label: '自动操作间隔', defaultValue: 800, min: 0, max: 10000, step: 1 },
  typingIntervalMs: { label: '每字符输入间隔', defaultValue: 40, min: 0, max: 500, step: 1 }
});
export const DEFAULT_PACING = Object.freeze({ answerDelayMs: 1500, actionIntervalMs: 800, typingIntervalMs: 40, typewriter: true });
export function validatePacing(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('操作节奏必须是配置对象');
  if (Object.keys(raw).some((key) => !Object.hasOwn(DEFAULT_PACING, key))) throw new Error('操作节奏含有未知字段');
  const value = { ...DEFAULT_PACING, ...raw };
  for (const [key, field] of Object.entries(PACING_FIELDS)) {
    if (!Number.isInteger(value[key]) || value[key] < field.min || value[key] > field.max) throw new Error(`${field.label}应为 ${field.min}～${field.max} 毫秒的整数`);
  }
  if (typeof value.typewriter !== 'boolean') throw new Error('逐字输入选项必须为 true 或 false');
  return value;
}
