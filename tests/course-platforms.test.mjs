import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { COURSE_PLATFORMS, COURSE_ORIGINS, COURSE_SETTINGS, coursePlatform, validateCourseSettings } from '../extension/lib/course-platforms.js';

test('course platforms match HTTPS host boundaries, not lookalikes, credentials or broad school domains', () => {
  for (const [url, id] of [['https://mooc1.chaoxing.com/mycourse/studentstudy', 'chaoxing'], ['https://studyvideoh5.zhihuishu.com/stuStudy', 'zhihuishu'], ['https://www.icourse163.org/learn/COURSE-1?tid=2', 'icourse'], ['https://moodle.syxy.ouchn.cn/course/view.php?id=123', 'ouchn']]) assert.equal(coursePlatform(url)?.id, id);
  for (const url of ['https://chaoxing.com.evil.test/', 'https://evilchaoxing.com/', 'https://school.edu.cn/', 'https://other.ouchn.cn/', 'https://fake.moodle.syxy.ouchn.cn/', 'https://moodle.syxy.ouchn.cn.evil.test/', 'https://evil.org.cn/', 'http://mooc1.chaoxing.com/', 'https://user:secret@mooc1.chaoxing.com/', 'https://mooc1.chaoxing.com:8443/', 'javascript:alert(1)', null]) assert.equal(coursePlatform(url), null, String(url));
  assert.equal(COURSE_PLATFORMS.length, 4);
});

test('course settings share exact bounds, preserve false and zero and reject malformed values', () => {
  assert.deepEqual(validateCourseSettings(), COURSE_SETTINGS);
  assert.deepEqual(validateCourseSettings({ autoNext: false, autoPreviewQuiz: false, nextDelayMs: 0 }), { ...COURSE_SETTINGS, autoNext: false, nextDelayMs: 0 });
  for (const value of [null, [], 'bad', { playbackRate: '1' }, { playbackRate: 0.25 }, { playbackRate: 16.25 }, { playbackRate: 1.1 }, { playbackRate: 15.9 }, { playbackRate: Infinity }, { playbackRate: NaN }, { nextDelayMs: -1 }, { nextDelayMs: 500 }, { stallSeconds: 601 }, { stallSeconds: NaN }, { autoNext: 1 }, { autoPreviewQuiz: 'false' }, { bypass: true }, { constructor: true }, { toString: true }]) assert.throws(() => validateCourseSettings(value));
  assert.equal(validateCourseSettings({ playbackRate: 0.5, nextDelayMs: 30000, stallSeconds: 30 }).playbackRate, 0.5);
  assert.equal(validateCourseSettings({ playbackRate: 2, stallSeconds: 600 }).stallSeconds, 600);
  for (let playbackRate = 0.5; playbackRate <= 16; playbackRate += 0.25) assert.equal(validateCourseSettings({ playbackRate }).playbackRate, playbackRate);
  assert.throws(() => validateCourseSettings({ playbackRate: 16.25 }), /播放速度应为 0\.5～16，步长 0\.25/);
  assert.equal(COURSE_SETTINGS.playbackRate, 1);
});

test('manifest pregrants only supported course domains without cookies, debugger or remote code', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url)));
  assert.deepEqual(manifest.host_permissions, COURSE_ORIGINS);
  assert.ok(!manifest.host_permissions.some((origin) => ['<all_urls>', 'https://*/*', 'http://*/*', 'https://*.edu.cn/*'].includes(origin)));
  for (const permission of ['cookies', 'debugger', 'webRequest']) assert.ok(!manifest.permissions.includes(permission));
  assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/);
});
