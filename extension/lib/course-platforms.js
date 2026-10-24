// 平台 URL/DOM 适配参考 OCS；仅保留可见页面识别与正常播放器操作，来源见 THIRD_PARTY_NOTICES.md。
export const COURSE_PLATFORMS = Object.freeze([
  { id: 'chaoxing', name: '超星学习通', hosts: ['chaoxing.com'], origins: ['https://*.chaoxing.com/*'],
    home: 'https://mooc1.chaoxing.com/',
    chapters: ['.posCatalog_name', '.chapter_item', '[data-course-chapter]'],
    current: '.posCatalog_select,.posCatalog_active,.active,.current,[aria-current="true"],[aria-selected="true"]',
    questions: '.TiMu,.questionLi,.question-item,[data-course-question],[data-nexly-question]',
    titles: '.courseName,.course-name,.course_name,h1' },
  { id: 'zhihuishu', name: '智慧树 · 知到', hosts: ['zhihuishu.com'], origins: ['https://*.zhihuishu.com/*'],
    home: 'https://studyh5.zhihuishu.com/',
    chapters: ['.clearfix.video', '.resources-item', '.videoList .video', '.videoList li', '.video-list .video-item', '.catalog-list .catalog-item', '[data-course-chapter]'],
    current: '.current_play,.current-video,.active,.current,[aria-current="true"],[aria-selected="true"]',
    questions: '.examPaper_subject,div:has(> .questionContent),.questionWrap,.question-box,[data-course-question],[data-nexly-question]',
    titles: '.source-name,.courseName,.course-name,.course-title,h1' },
  { id: 'icourse', name: '中国大学 MOOC', hosts: ['icourse163.org'], origins: ['https://www.icourse163.org/*'],
    home: 'https://www.icourse163.org/',
    chapters: ['.j-unitslist li', '.unitslist li', '.u-learnLesson', '.j-lesson', '.j-unit', '[data-course-chapter]'],
    current: '.current,.active,.on,[aria-current="true"],[aria-selected="true"]',
    questions: '.m-question,.u-questionItem,.j-question,[data-course-question],[data-nexly-question]',
    titles: '.course-title,.courseName,.j-courseName,h1' },
  // 国家开放大学各分校站点并不相同；仅接入用户指定域名，不授予 ouchn.cn 泛域名权限。
  { id: 'ouchn', name: '国家开放大学 · 实验学院', hosts: ['moodle.syxy.ouchn.cn'], exactHosts: true,
    origins: ['https://moodle.syxy.ouchn.cn/*'], home: 'https://moodle.syxy.ouchn.cn/',
    chapters: ['.courseindex .courseindex-item', '.block_navigation li.type_activity', '.course-content li.activity'],
    current: '.current,.active,[aria-current="true"],[aria-current="page"],[aria-selected="true"]',
    questions: '.que,[data-course-question],[data-nexly-question]',
    titles: '#page-header h1,.page-header-headings h1,#page-header h2,h1' }
]);
export const COURSE_ORIGINS = Object.freeze(COURSE_PLATFORMS.flatMap((item) => item.origins));
export function coursePlatform(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    // 不能用 includes：chaoxing.com.evil.example 不是受信任平台，也不授予 edu.cn 泛域名权限。
    return COURSE_PLATFORMS.find((item) => item.hosts.some((host) => url.hostname === host || !item.exactHosts && url.hostname.endsWith(`.${host}`))) || null;
  } catch { return null; }
}
export const COURSE_SETTINGS = Object.freeze({ autoNext: true, playbackRate: 1, nextDelayMs: 3000, stallSeconds: 120, autoPreviewQuiz: false });
export const COURSE_FIELDS = Object.freeze({
  playbackRate: { min: 0.5, max: 16, step: 0.25, label: '播放速度' },
  nextDelayMs: { min: 0, max: 30000, step: 1000, label: '换章等待时间' },
  stallSeconds: { min: 30, max: 600, step: 1, label: '无进度暂停时间' }
});
export function validateCourseSettings(input = COURSE_SETTINGS) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('课程设置格式无效，请恢复默认后重试');
  if (Object.keys(input).some((key) => !Object.hasOwn(COURSE_SETTINGS, key))) throw new Error('课程设置包含未支持的字段');
  const settings = { ...COURSE_SETTINGS, ...input };
  for (const key of ['autoNext', 'autoPreviewQuiz']) if (typeof settings[key] !== 'boolean') throw new Error('课程开关必须为 true 或 false');
  for (const [key, field] of Object.entries(COURSE_FIELDS)) {
    const number = settings[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < field.min || number > field.max || Math.abs((number - field.min) / field.step - Math.round((number - field.min) / field.step)) > 1e-7) throw new Error(`${field.label}应为 ${field.min}～${field.max}，步长 ${field.step}`);
  }
  return settings;
}
export function courseSession() {
  return { phase: 'idle', running: false, operation: '', tabId: null, platformId: '', snapshot: null, watched: 0, readDocuments: 0, error: '', message: '打开已登录的课程页面，识别后开始学习。', log: [], settings: { ...COURSE_SETTINGS } };
}
