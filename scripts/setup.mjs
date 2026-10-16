import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, requireModernNode } from './project.mjs';

requireModernNode();
for (const script of ['check.mjs', 'build.mjs', 'install-native.mjs', 'doctor.mjs']) {
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...(script === 'install-native.mjs' ? process.argv.slice(2) : [])], { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
