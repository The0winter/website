type ReviewContent = {content:string;isTestData?:boolean;sourceExcerpt?:unknown};

export function displayReviewContent(review:ReviewContent) {
  const content=review.isTestData?review.content.replace(/^【测试】/,''):review.content;
  if(!review.sourceExcerpt)return content;
  return content.replace(/^(?:\s*(?:…+|\.{3,}|．{3,}|⋯+)\s*)+|(?:\s*(?:…+|\.{3,}|．{3,}|⋯+)\s*)+$/gu,'').trim();
}
