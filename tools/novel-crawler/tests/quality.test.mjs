import test from 'node:test';
import assert from 'node:assert/strict';
import {chapterQuality, mojibakeEvidence, qualityReport} from '../quality.mjs';

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
