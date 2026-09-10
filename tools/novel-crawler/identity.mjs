import OpenCC from 'opencc-js';

let toSimplified;
export function normalizedIdentity(value, normalization) {
  let text = String(value ?? '');
  if (normalization === 'chinese-simplified') {
    toSimplified ||= OpenCC.Converter({from: 'tw', to: 'cn'});
    text = toSimplified(text);
  }
  return text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
}
