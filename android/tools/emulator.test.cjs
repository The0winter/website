'use strict';
require('D:/Apps/Codex/home/tools/windows-hide.cjs');
require('../../tools/test-env.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {launchSpec}=require('./emulator.cjs');
test('Windows emulator bypasses the console-producing wrapper and uses CREATE_NO_WINDOW-compatible pipes',()=>{
 const spec=launchSpec('win32',{PATH:'existing-tools',JIUTIAN_AVD:'jiutian_api26'},[]);
 assert.match(spec.executable,/qemu-system-x86_64-headless\.exe$/);
 assert.equal(spec.options.windowsHide,true);assert.equal(spec.options.detached,false);
 assert.deepEqual(spec.options.stdio,['ignore','pipe','pipe']);
 assert.ok(spec.args.includes('-no-window'));assert.ok(spec.args.includes('-no-audio'));
 assert.equal(spec.args[spec.args.indexOf('-avd')+1],'jiutian_api26');
 assert.match(spec.options.env.ANDROID_EMULATOR_LAUNCHER_DIR,/emulator$/);
 assert.ok(spec.options.env.PATH.endsWith('existing-tools'));
});
