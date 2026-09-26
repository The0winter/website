import {test,expect} from '@playwright/test';
import {displayReviewContent} from '../lib/review-content';

test('imported review excerpts omit edge ellipses without changing the original text',()=>{
  const excerpt={content:'【测试】…… 这本书节奏很好，人物也鲜活。 ...',isTestData:true,sourceExcerpt:{platform:'BookLink'}};
  expect(displayReviewContent(excerpt)).toBe('这本书节奏很好，人物也鲜活。');
  expect(excerpt.content).toBe('【测试】…… 这本书节奏很好，人物也鲜活。 ...');
  expect(displayReviewContent({content:'【测试】…前半段⋯中段…结尾…',isTestData:true,sourceExcerpt:{}})).toBe('前半段⋯中段…结尾');
});

test('reader comments retain their own punctuation',()=>{
  expect(displayReviewContent({content:'……还没看完……'})).toBe('……还没看完……');
});
