export const OPACITY = Object.freeze({ min: 0, max: 100, defaultValue: 90 });
export const DEFAULT_APPEARANCE = Object.freeze({ opacity: OPACITY.defaultValue });
export const DEFAULT_POSITION = Object.freeze({ x: 1, y: 1 });

export function validateAppearance(value = DEFAULT_APPEARANCE) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => key !== 'opacity') || !Number.isInteger(value.opacity) || value.opacity < OPACITY.min || value.opacity > OPACITY.max) {
    throw new Error(`显示不透明度应为 ${OPACITY.min}～${OPACITY.max} 的整数`);
  }
  return { opacity: value.opacity };
}

export function validatePosition(value = DEFAULT_POSITION) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['x', 'y'].includes(key)) || !['x', 'y'].every((key) => Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1)) {
    throw new Error('页内组件位置应在当前可视区域内');
  }
  return { x: value.x, y: value.y };
}
