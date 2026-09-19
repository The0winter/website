// Preload before test dependencies so their temporary paths stay in the project.
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = fs.realpathSync(path.resolve(__dirname, '..'));
const testTempDir = path.join(projectRoot, '.runtime', 'test-tmp');
fs.mkdirSync(testTempDir, {recursive: true});
const relative = path.relative(projectRoot, fs.realpathSync(testTempDir));
if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
  throw new Error('Test temporary directory must resolve inside this project');
}

// These changes affect only this process and its children, not Windows settings.
for (const name of ['TEMP', 'TMP', 'TMPDIR']) process.env[name] = testTempDir;
process.env.PWTEST_CACHE_DIR = path.join(testTempDir, 'playwright-transform-cache');

// The lease also protects tests invoked directly, outside the npm wrapper.
require('./storage-maintenance.cjs').activity(['temp', 'build', 'clean-room', 'artifacts', 'crawler-cache']);

module.exports = {testTempDir};
