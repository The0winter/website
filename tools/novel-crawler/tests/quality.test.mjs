import test from 'node:test';
import assert from 'node:assert/strict';
import {chapterQuality, mojibakeEvidence, qualityReport} from '../quality.mjs';
import {prepareImport} from '../../../infra/import-plan.mjs';

const narrative = Array.from({length: 180}, (_, i) => `旅人在第${i}处停留，观察山路与行人。`).join('\n');
const item = (number, content, title = '第173章 审判') => ({chapter_number: number, title, content, link: `https://example.test/${number}`});

test('shifted near duplicates with the same title block collection and whole-file import across batches', () => {
  const chapters = [item(1, narrative), ...Array.from({length:20}, (_, i) => item(i+2, '另一段短正文', `第${i+2}章 旅程`)), item(22, narrative.replace('观察山路', '仔细观察山路'))];
  const before = structuredClone(chapters);
  const report = qualityReport(chapters, chapters);
  assert.equal(report.structuralPass, false);
  assert.ok(report.issues.some(i => i.code === 'duplicate-title-body' && i.chapter === 22 && i.otherChapter === 1));
  assert.throws(() => prepareImport({title:'测试',sourceUrl:'https://example.test/book',chapters}), /重复.*整本导入/);
  assert.deepEqual(chapters, before);
});

test('same titles with different bodies, and short recurring notices remain available', () => {
  const chapters = [item(1,narrative,'抽奖结果'),item(2,'雪原上的队伍寻找失散的人，远方响起钟声。'.repeat(150),'抽奖结果'),item(3,'今天请假一天','请假'),item(4,'今天请假一天','请假')];
  assert.equal(qualityReport(chapters,chapters).structuralPass, true);
  assert.equal(prepareImport({title:'测试',sourceUrl:'https://example.test/book',chapters}).length, 1);
});

test('exact duplicate bodies and repeated source links are blocked even under different titles', () => {
  const a = item(1,narrative), b = item(2,narrative,'不同标题');
  assert.ok(qualityReport([a,b],[a,b]).issues.some(i=>i.code==='duplicate-body'));
  assert.throws(()=>prepareImport({title:'测试',sourceUrl:'https://example.test/book',chapters:[a,b]}), /duplicate-body/);
  b.content = '另一篇正文'; b.link = a.link;
  assert.throws(()=>prepareImport({title:'测试',sourceUrl:'https://example.test/book',chapters:[a,b]}), /duplicate-link/);
});

test('valid Unicode mojibake blocks a clean quality result while keeping original text', () => {
  const content = '銆銆姹熸笣鐧芥湜鐫鐪煎墠锛岃╀粬鏉ユ敹绉燂紝鈥︹︺'.repeat(12);
  assert.equal(content.includes('\uFFFD'), false);
  const chapter = {chapter_number: 1, title: '测试章', link: 'https://example.test/1', content};
  assert.deepEqual(chapterQuality(chapter), []);
  const report = qualityReport([chapter], [chapter]);
  assert.equal(report.structuralPass, false);
  assert.equal(report.issues.find(issue => issue.code === 'mojibake')?.level, 'error');
  assert.equal(chapter.content, content);
});

test('normal text, a few quoted markers, and one unusual repeated character are not classified as mojibake', () => {
  for (const content of ['这是正常的中文正文。'.repeat(100), '教材用“銆、锛、鈥”举例说明错误解码。', '锛'.repeat(100)]) {
    assert.equal(mojibakeEvidence(content), null);
  }
});

test('empty-content and reader-upgrade placeholders fail collection quality without changing source text', () => {
  for (const content of ['暂无内容', '暂 无 内 容。', '请升级到新版本查看本章！']) {
    const chapter = item(1, content), before = structuredClone(chapter);
    const report = qualityReport([chapter], [chapter]);
    assert.equal(report.structuralPass, false);
    assert.ok(report.issues.some(issue => issue.code === 'placeholder' && issue.chapter === 1));
    assert.deepEqual(chapter, before);
  }
});

test('ordinary narrative mentioning placeholder messages stays intact', () => {
  for (const content of ['屏幕上显示“暂无内容”，他关掉了页面。', '请升级到新版本查看本章是网站显示的提示，并非本章正文。', '暂无内容，但明天会补充地图说明。']) {
    const chapter = item(1, content);
    assert.equal(qualityReport([chapter], [chapter]).issues.some(issue => issue.code === 'placeholder'), false);
  }
});
