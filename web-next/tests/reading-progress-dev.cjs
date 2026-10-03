// Local-only background fixture frontend. No production credentials or writes.
require('D:/Apps/Codex/home/tools/windows-hide.cjs');
require('../../tools/test-env.cjs');
process.execArgv=[]; // Next merges duplicate --require arrays into one invalid Windows path.
process.env.INTERNAL_API_URL='http://127.0.0.1:5081/api';
process.env.NEXT_DIST_DIR='.next-progress-test';
process.argv=[process.execPath,require.resolve('next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port','3000'];
require('next/dist/bin/next');
