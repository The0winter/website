import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCatalogVolumes, splitCatalogTitle} from '../../shared/catalog-volumes.mjs';

test('explicit volume prefixes preserve labels, chapter order and chapter identities', () => {
  const chapters = [
    '第一卷 原篇(作者：甲) 第1章 开始', '第一卷 原篇(作者：甲) 第2章 继续',
    '第二卷 续篇（作者：乙） 第1章 新的开始', '第二卷 续篇（作者：乙） 第2章 继续',
    '第三卷 番外篇 第1章 重逢',
  ].map((title, index) => ({id: String(index), title}));
  assert.deepEqual(buildCatalogVolumes(chapters), [
    {id:'0',title:'第一卷 原篇(作者：甲)',start:0,count:2},
    {id:'2',title:'第二卷 续篇（作者：乙）',start:2,count:2},
    {id:'4',title:'第三卷 番外篇',start:4,count:1},
  ]);
  assert.equal(splitCatalogTitle(chapters[2].title).chapterTitle, '第1章 新的开始');
});

test('body and extras work with prefixes or standalone headings without dropping chapters', () => {
  const volumes = buildCatalogVolumes(['正文', '第1章 开始', '第2章 继续', '番外一 重逢', '番外二 远行'].map(title => ({title})));
  assert.deepEqual(volumes.map(({title,start,count})=>({title,start,count})), [{title:'正文',start:0,count:3},{title:'番外',start:3,count:2}]);
  assert.deepEqual(splitCatalogTitle('正文卷 第三章 归来'), {volume:'正文',chapterTitle:'第三章 归来'});
  assert.equal(splitCatalogTitle('番外一 重逢').chapterTitle, '番外一 重逢');
  assert.equal(buildCatalogVolumes([{title:'第一卷 风起'}, {title:'第1章 初见'}])[0].count, 2);
});

test('ordinary chapter titles, notices and numbering resets never invent volume boundaries', () => {
  const chapters=['第1章 开始','第2章 番外故事','第一章 新的开始','番外的故事','关于第二卷的通知','请假条'].map(title=>({title}));
  assert.deepEqual(buildCatalogVolumes(chapters),[{id:'0',title:'正文',start:0,count:6}]);
  assert.deepEqual(buildCatalogVolumes([]),[]);
});
