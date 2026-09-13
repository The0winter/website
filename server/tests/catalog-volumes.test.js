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

test('body and extra titles never create volumes or change later chapter classification', () => {
  const volumes = buildCatalogVolumes(['正文', '第1章 开始', '第2章 继续', '番外一 重逢', '番外二 远行'].map(title => ({title})));
  assert.deepEqual(volumes, []);
  assert.deepEqual(splitCatalogTitle('正文卷 第三章 归来'), {volume:'',chapterTitle:'正文卷 第三章 归来'});
  assert.equal(splitCatalogTitle('番外一 重逢').chapterTitle, '番外一 重逢');
  assert.deepEqual(buildCatalogVolumes([{title:'第一卷 风起'}, {title:'第1章 初见'}]), []);
  assert.deepEqual(buildCatalogVolumes(['第287章 日常','番外 没有主角的一天','第288章 出发','第289章 归来'].map(title=>({title}))), []);
  assert.deepEqual(splitCatalogTitle('番外 第1章 重逢'), {volume:'',chapterTitle:'番外 第1章 重逢'});
});

test('a volume-ending notice is an ordinary chapter, never a new volume', () => {
  const titles = ['第520章 道别', '第一卷 结束以及请假', '拜个晚年，以及更新安排', '第521章 新社区'];
  assert.deepEqual(buildCatalogVolumes(titles.map(title => ({title}))), []);
  for (const title of ['第一卷 结束以及请假', '第二卷 完结感言', '卷三 更新说明', '第一卷 风起']) {
    assert.deepEqual(splitCatalogTitle(title), {volume:'',chapterTitle:title});
  }
  assert.deepEqual(buildCatalogVolumes([{title:'第一卷'}, {title:'第1章 初见'}]), [{id:'0',title:'第一卷',start:0,count:2}]);
  assert.deepEqual(buildCatalogVolumes([{title:'第一卷 风起',volume_title:'第一卷 风起',volume_number:1}, {title:'第1章 初见'}]), [{id:'0',title:'第一卷 风起',start:0,count:2}]);
});

test('ordinary chapter titles, notices and numbering resets never invent volume boundaries', () => {
  const chapters=['第1章 开始','第2章 番外故事','第一章 新的开始','番外的故事','关于第二卷的通知','请假条'].map(title=>({title}));
  assert.deepEqual(buildCatalogVolumes(chapters),[]);
  assert.deepEqual(buildCatalogVolumes([]),[]);
});

test('a single generic section stays flat; a preface before explicit volumes has no invented heading', () => {
  assert.deepEqual(buildCatalogVolumes([{title:'第1章 开始',volume_title:'正文',volume_number:1}]), []);
  assert.deepEqual(buildCatalogVolumes([{title:'序言'},{title:'第一卷 风起 第1章 开始'},{title:'番外 独立故事'},{title:'第2章 继续'},{title:'第二卷 远行 第1章 启程'}]), [
    {id:'0',title:'',start:0,count:1},{id:'1',title:'第一卷 风起',start:1,count:3},{id:'4',title:'第二卷 远行',start:4,count:1},
  ]);
});

test('imported volume metadata groups unprefixed chapter titles, including repeated chapter numbers', () => {
  const chapters = [
    {title:'第一章 风起',volume_title:'第一卷 初遇',volume_number:1},
    {title:'番外一 重逢',volume_title:'第一卷 初遇',volume_number:1},
    {title:'第一章 启程',volume_title:'第二卷 远行',volume_number:2},
    {title:'第二章 归来',volume_title:'第二卷 远行',volume_number:2},
  ];
  assert.deepEqual(buildCatalogVolumes(chapters),[
    {id:'0',title:'第一卷 初遇',start:0,count:2},
    {id:'2',title:'第二卷 远行',start:2,count:2},
  ]);
  assert.deepEqual(buildCatalogVolumes([{title:'第一章',volume_title:'第一卷',volume_number:1}]),[{id:'0',title:'第一卷',start:0,count:1}]);
});
