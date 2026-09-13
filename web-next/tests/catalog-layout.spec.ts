import {test, expect} from '@playwright/test';
import {catalogLayout} from '../lib/catalog-layout';

test('volume folding maps columns to original chapter positions without filling across boundaries', () => {
  const volumes=[{id:'a',title:'第一卷',start:0,count:5},{id:'b',title:'第二卷',start:5,count:7},{id:'c',title:'番外',start:12,count:2}];
  const layout=catalogLayout(volumes,new Set(['b']),3);
  expect(layout.total).toBe(6);
  expect(layout.at(0).chapterStart).toBeNull();
  expect(layout.at(2).chapterStart).toBe(5);
  expect(layout.at(4).chapterStart).toBe(11);
  expect(layout.chapter(11)).toBe(4);
  expect(layout.chapter(2)).toBe(0);
  expect(catalogLayout(volumes,new Set(),1).total).toBe(3);
  expect(catalogLayout(volumes,new Set(['a','b','c']),3).total).toBe(9);
});

test('flat catalogs and unlabelled prefaces have no header row or column gaps', () => {
  const flat=catalogLayout([{id:'flat',title:'',start:0,count:7}],new Set(),3);
  expect(flat.total).toBe(3);
  expect([0,1,2].map(i=>flat.at(i).chapterStart)).toEqual([0,3,6]);
  expect(flat.chapter(6)).toBe(2);
  const mixed=catalogLayout([{id:'p',title:'',start:0,count:2},{id:'v',title:'第一卷',start:2,count:4}],new Set(['v']),3);
  expect(mixed.total).toBe(4);expect(mixed.at(0).chapterStart).toBe(0);
  expect(mixed.at(1).chapterStart).toBeNull();expect(mixed.at(2).chapterStart).toBe(2);
});
