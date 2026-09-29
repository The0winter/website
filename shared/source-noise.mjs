// Confirmed publisher/aggregator boilerplate. Match complete signatures, never
// ordinary mentions of websites, collections, authors or requests for votes.
const normalize = text => text.normalize('NFKC').replace(/[\t \u3000\u200b-\u200d\ufeff]/gu, '');
const mirrorHosts = new Set(['www.shudugu.org', 'shudugu.org', 'www.deqixs.org', 'deqixs.org', 'youyouxs.com', 'www.4jiwx.com']);
const electronicHosts = new Set(['ixdzs8.com', 'd.80qishu.com', 't.80qishu.com', 'www.80qishu.com', 'www.80qishu.cc']);

const wholeLines = [
  ['mirror-domain-reminder', mirrorHosts, /^【写到这里我希望读者记一下我们域名[^【】\r\n]{0,180}】$/u],
  ['mirror-fastest-site', mirrorHosts, /^【记住全网最快小说站[^【】\r\n]{0,120}】$/u],
  ['mirror-site-reminder', mirrorHosts, /^【记住本站域名[^【】\r\n]{0,180}】$/u],
  ['mirror-first-publication', mirrorHosts, /^本书首发[^\r\n]{1,100}[,，]提供给你无错章节，无乱序章节的阅读体验$/u],
  ['shudugu-phonetic-address', mirrorHosts, /^[A-Za-zɡ?.]{1,40}首发更新，无错字。看不到地址输入速读谷的拼音后缀\.cc即可进入首发更新站点。$/u],
  ['shudugu-share-promotion', mirrorHosts, /^(?:更新不易|超给力)[、，,][^\r\n]{0,80}速[-·]*读[-·]*谷[^\r\n]{0,120}(?:看书不迷路哦！|看(?:最新(?:无错|无措)?|无错最新|更新最快)章节！|更新快，不出错！)$/u],
  ['shudugu-reader-address', mirrorHosts, /^书友们，请记住、速读谷新地址www\.shudugu\.org更多热门小说最新章节优先读哟！$/u],
  ['shudugu-empty-address', new Set(['www.shudugu.org', 'shudugu.org']), /^https:\/\/$/u],
  ['shudugu-misspelled-brand', mirrorHosts, /^速-度-谷最新地址、www\.shudugu\.org大家记得收藏，免迷路哦。$/u],
  ['mirror-facebook-promotion', mirrorHosts, /^【请记住我们的域名，如果喜欢本站请分享到Faebk脸】$/u],
  ['mirror-biquge-promotion', mirrorHosts, /^，笔趣阁高速首发！$/u],
  ['deqixs-glyph-promotion', mirrorHosts, /^[「」德得旗奇]{0,12}「小」「说」「网」「手打」「更新」$/u],
  ['deqixs-search-promotion', mirrorHosts, /^前往[「」]*必[「」]*应[「」]*搜[「」]*索[「」]*(?:[德得][「」]*[旗奇][「」]*)?小[「」]*说[「」]*网[「」]*可查看最[「」]*新章[「」]*节！$/u],
  ['deqixs-bing-promotion', mirrorHosts, /^必应搜索“嘚齐小说网”可看本书最新更新章节！$/u],
  ['deqixs-invitation-promotion', mirrorHosts, /^最后一批邀请码1900人发放，官方反馈群1104270100$/u],
  ['deqixs-obfuscated-address', mirrorHosts, /^请\.访问\.得\.奇\.小\.说网看最新章节！地址：[\\a-zA-Z.]{8,120}$/u],
  ['deqixs-empty-font-address', mirrorHosts, /^地址：[\\.]{6,100}$/u],
  ['deqixs-repeated-address', mirrorHosts, /^记住更新地址不迷路：[^\r\n]{1,400}或者必应搜索：德其小说网$/u],
  ['mirror-font-reminder', mirrorHosts, /^[?A-Za-z0-9.]{1,30}提醒您查看最新内容$/u],
  ['mirror-empty-font-domain', mirrorHosts, /^[,，][?]{2,40}\.[?]{2,40}$/u],
  ['deqixs-address', mirrorHosts, /^(?:https?:\/\/)?www\.deqixs\.org\/?$/u],
  ['101-repost-promotion', mirrorHosts, /^(?:101看书)?101看书网[^\r\n]{0,140}全手打无错站$/u],
  ['69shuba-repost-promotion', mirrorHosts, /^无错版本在读！[0-9=+_@#书吧]{0,30}首发本小说。$/u],
  ['69shuba-latest-promotion', mirrorHosts, /^本小说最新章节在[0-9=+_@#书吧]{1,30}首发，请您到六九书吧去看！$/u],
  ['69shuba-interleaved-read-promotion', mirrorHosts, /^无错版本在[0-9xX=+_@#书吧]{0,30}读！[0-9xX=+_@#书吧一]{0,30}首一?发一?本小说。读?$/u],
  ['2000-repost-promotion', mirrorHosts, /^【2000小说网，第一时间更新最新章节修复错误章节，支持简繁阅读和搜索】$/u],
  ['ixdzs-repost-opening', electronicHosts, /^一秒记住【[^【】\r\n]{0,80}】[，,](?:精彩小说无弹窗免费阅读！|本站为您提供热门小说免费阅读。)$/u],
  ['ixdzs-dingdian-address', electronicHosts, /^请记住本书首发域名：[^\r\n]{0,80}。顶点小说手机版阅读网址：[^\r\n]{0,80}$/u],
  ['ixdzs-genius-address', electronicHosts, /^天才一秒记住本站地址：[^\r\n]{0,80}。手机版阅读网址：[^\r\n]{0,80}$/u],
  ['ixdzs-truncated-footer', electronicHosts, /^请记住本书首发域名：\.。m\.$/u],
  ['ixdzs-broken-book-address', electronicHosts, /^https:\/\/\/html\/book\/44\/44323\/l$/u],
  ['ixdzs-aiyousheng-promotion', electronicHosts, /^【本章节首发[.．]爱[.．]有[.．]声[.．]小说网[,，]请记住网址】$/u],
  ['xszj-sharing-footer', new Set(['xszj.tw']), /^小說集為廣大書友們提供好看的網路小說全文免費線上閱讀，如果您喜歡本站，請分享給更多的書友們！$/u],
  ['xszj-book-sharing', new Set(['xszj.tw']), /^如果您覺得《[^《》\r\n]{1,200}》小說很精彩的話，請貼上以下網址分享給您的好友，謝謝支援！$/u],
  ['xszj-book-address', new Set(['xszj.tw']), /^\(本書網址：https:\/\/xszj\.tw\/book\/[0-9]+\)$/u],
  ['xszj-repost-address', new Set(['xszj.tw']), /^請牢記本站域名\.,或者在百度搜尋:$/u],
];
const normalizedRules = wholeLines.map(([name, hosts, pattern]) => [name, hosts, new RegExp(pattern.source.normalize('NFKC'), 'u')]);
const rulesByHost = new Map();
for (const [name, hosts, pattern] of normalizedRules) for (const host of hosts) {
  if (!rulesByHost.has(host)) rulesByHost.set(host, []);
  rulesByHost.get(host).push([name, pattern]);
}
const lineHint = /www|https?|首|网|網|域名|网址|網址|速|手打|记住|記住|提醒您|收藏|小說集|小说|全文|看书|看書|邀请码|地址|請牢記|一秒|起点|搜索|无错|[?？]{2,}/u;
const fragmentHint = /www|https?|狂_人|&amp;|未完待续|【|记住|[\u200b-\u200d\ufeff]|首发|手打|乱码/u;

export function sourceNoiseLineRule(text, host, {line = Infinity} = {}) {
  if (text.length > 500 || !rulesByHost.has(host) || !lineHint.test(text)) return null;
  const normalized = normalize(text);
  for (const [name, pattern] of rulesByHost.get(host)) if (pattern.test(normalized)) return name;
  if (mirrorHosts.has(host)) {
    const bare = normalized.replace(/^[~"'「」]+|[~"'「」]+$/gu, '');
    if (bare.length <= 240 && /(?:www\.)?s(?:u|hu)dugu\.org/iu.test(bare)
      && /^(?:更新不易|最新首发|写到这里|看书就[上来]|追书就上|看(?:最新|完整)|阅读更多|更多精彩小说|各位书友|书友们|请分享|请牢记[,，]速读谷|请收藏新域名|请使用必应搜索|天冷了[,，]更新不易)/u.test(bare)) return 'shudugu-address-promotion';
    if (bare === '看最新完整章節,就上速讀谷' || bare === '请使用必应搜索:速读谷免费看最新章节') return 'shudugu-search-promotion';
    if (/⊥/u.test(normalized) && /^最新小说在(?:六9书吧)?首发!$/u.test(normalized.replaceAll('⊥', ''))) return '69shuba-glyph-promotion';
    if (normalized === '无一错一首一发一内一容一在一一看!') return '69shuba-interleaved-promotion';
    if (/^请[.]*您[.]*收藏[_0-9.书吧（）()六九\\!]+[!]?$/u.test(normalized) && /书.*吧/u.test(normalized)) return '69shuba-collection-promotion';
    if (normalized === '原文在六#9@书/吧看!') return '69shuba-original-promotion';
    const glyphless = normalized.replace(/[「」、]/gu, '');
    if (/[「」]/u.test(normalized) && /^(?:请记住)?(?:[德得][旗奇])?小说唯一网?址:[A-Za-z0-9?.]{0,80},站长有且只有这一个网站,其它网站随时断更。$/u.test(glyphless)) return 'deqixs-glyph-address';
    if (/[「」]/u.test(normalized) && /^(?:[德得][旗奇])?小说网首发[A-Za-z0-9?.]{0,80}$/u.test(glyphless)) return 'deqixs-glyph-first-publication';
    if (/^「「/u.test(normalized) && /^首发[A-Za-z0-9?.]{0,80}$/u.test(glyphless)) return 'deqixs-empty-glyph-promotion';
    if (/[【】]/u.test(normalized) && /^搜索(?:[德得][旗奇])?小说网查看本书最新章节!$/u.test(normalized.replace(/[【】]/gu, ''))) return 'deqixs-bracket-search-promotion';
    if (glyphless === '德奇小说网首发。请搜索关注德奇小说网。') return 'deqixs-separated-promotion';
    if (normalized.length <= 160 && /全手打无错站$/u.test(normalized) && /(?:101(?:看书|kan)|\?{2,})/u.test(normalized)
      && /^(?:101|[?①.0-9]|找好书上|海量好书在|超便捷|体验佳|追书认准|看书首选|就上|看书就上|解闷好)/u.test(normalized)) return 'mirror-handtyped-promotion';
    if (line <= 5 && /^(?:一秒记住【网|一秒记住【49小说网)$/u.test(normalized)) return 'mirror-truncated-opening';
  }
  if (electronicHosts.has(host)) {
    // Decode only this recognition string. The surviving novel is never HTML
    // decoded or reformatted; nested escaped link markup occurs in old TXT.
    const markup = normalized.replace(/&(?:amp;)*lt;/gu, '<').replace(/&(?:amp;)*gt;/gu, '>');
    if (/^(?:<ahref=[^<>\r\n]{1,120}>)?起点中文网[.。]欢迎广大书友光临阅读,最新、最快、最火的连载作品尽在起点原创!(?:<\/a>)?$/u.test(markup)) return 'qidian-escaped-promotion';
  }
  return null;
}

export function stripSourceNoiseFragments(text, host) {
  if ((!mirrorHosts.has(host) && !electronicHosts.has(host) && host !== 'www.kanunu8.com') || !fragmentHint.test(text)) return {text, removed: []};
  const removed = [];
  const remove = (pattern, rule) => {text = text.replace(pattern, (value, offset) => {removed.push({text: value, offset, rule});return '';});};
  if (host === 'www.kanunu8.com') remove(/(?:https?:\/\/)?www\.21coming\.com(?:整理)?/gu, 'kanunu-repost-watermark');
  if (host === 'ixdzs8.com') {
    remove(/\(狂_人_小_说_网-www\.xiaoshuo\.kr\)/gu, 'ixdzs-kuangren-watermark');
    remove(/&amp;长&amp;风&amp;文学\{www\}\.\{cf\}\{wx\}\.\{net\}/gu, 'ixdzs-changfeng-watermark');
    remove(/【本章节首发[．、.-]爱[．、.-]有[．、.-]声[．、.-]小说网[,，]请记住网址】/gu, 'ixdzs-aiyousheng-watermark');
  }
  if (mirrorHosts.has(host) || electronicHosts.has(host)) {
    remove(/[（(]未完待续，如欲知后事如何，请登陆(?:www\.[A-Za-z0-9.*]+)?，章节更多，(?:支持作者，支持正版阅读！[)）]?)?$/gu, 'qidian-legacy-footer');
  }
  if (mirrorHosts.has(host)) {
    remove(/【(?:写到这里我希望读者记一下我们域名|记住本站域名)[^【】\r\n]{0,180}】/gu, 'mirror-inline-domain-reminder');
    remove(/记住这个名字：可乐小说。记住这个域名：。好书不迷路。/gu, 'mirror-kele-watermark');
    remove(/记住我们的域名：，精彩随时可读。/gu, 'mirror-empty-domain-watermark');
    remove(/一秒记住【中文网】，为您提供高速文字首发。(?:&nbsp){0,4}/gu, 'mirror-zhongwen-opening');
    remove(/\(首发、域名\(请记住_三$/gu, 'mirror-truncated-domain-watermark');
    for (const [rule, pattern] of decoratedFragments) remove(pattern, rule);
  }
  return {text, removed};
}

const gap = '(?:[\\u200b-\\u200d\\ufeff]|<span class=["\']txt["\']>|<\\/span>)*';
const literal = text => new RegExp(gap + [...text].map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(gap) + gap, 'gu');
const decoratedFragments = [
  ['deqixs-handtyped-watermark', literal('全文字手打www.deqixs.org')],
  ['deqixs-direct-watermark', literal('避免乱码，推荐访问得奇小说网直达：www.deqixs.org')],
  ['deqixs-first-watermark', literal('本书首发于得奇小说网（www.deqixs.org），请勿随意转载！')],
];

export const sourceNoiseRuleNames = [...wholeLines.map(([name]) => name), 'qidian-escaped-promotion', 'shudugu-address-promotion', 'shudugu-search-promotion',
  '69shuba-glyph-promotion', '69shuba-interleaved-promotion', '69shuba-collection-promotion', '69shuba-original-promotion',
  'deqixs-glyph-address', 'deqixs-glyph-first-publication', 'deqixs-separated-promotion', 'mirror-handtyped-promotion',
  'deqixs-empty-glyph-promotion', 'deqixs-bracket-search-promotion', 'mirror-truncated-opening',
  'kanunu-repost-watermark', 'ixdzs-kuangren-watermark', 'ixdzs-changfeng-watermark', 'ixdzs-aiyousheng-watermark',
  'qidian-legacy-footer', 'mirror-inline-domain-reminder', 'mirror-kele-watermark', 'mirror-empty-domain-watermark',
  'mirror-zhongwen-opening', 'mirror-truncated-domain-watermark', ...decoratedFragments.map(([name]) => name)];
