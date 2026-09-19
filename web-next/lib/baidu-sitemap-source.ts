import {GET as getIndex} from '@/app/sitemap.xml/route';
import {GET as getStatic} from '@/app/sitemaps/static.xml/route';
import {GET as getAuthors} from '@/app/sitemaps/authors.xml/route';
import {GET as getChapters} from '@/app/sitemaps/[bookId]/[page]/route';
import {getApiBaseUrl} from '@/utils/api';
import {siteUrl} from '@/lib/sitemap';
import {baiduFilePath, cacheBaiduFiles, splitBaiduEntries, type BaiduFile} from '@/lib/baidu-sitemap';

type FilePlan = {entries: string[]; partitions: string[]; read?: () => Promise<BaiduFile[]>};
const chapterPartition = /^\/sitemaps\/([a-f0-9]{24})\/([1-9][0-9]*\.xml)$/;

function entriesFrom(body: string, base: string) {
  if (!body.includes('<urlset')) throw new Error('Expected URL set');
  return [...body.matchAll(/<url>\s*<loc>([^<]+)<\/loc>[\s\S]*?<\/url>/g)].map(match => {
    const url = new URL(match[1]);
    if (url.origin !== base || url.search || url.hash || !/^\/(?:$|ranking$|forum$|author\/[a-f0-9]{24}$|book\/[a-f0-9]{24}(?:\/[a-f0-9]{24})?$)/i.test(url.pathname)) throw new Error('Non-public sitemap URL');
    return match[0];
  });
}

async function createPlan(): Promise<FilePlan[]> {
  const base = siteUrl();
  const index = await getIndex();
  if (!index.ok) throw new Error('Sitemap index unavailable');
  const paths = [...(await index.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => {
    const url = new URL(match[1]);
    if (url.origin !== base || url.search || url.hash) throw new Error('Unexpected partition');
    return url.pathname;
  });
  if (!paths.includes('/sitemaps/static.xml') || !paths.includes('/sitemaps/authors.xml')) throw new Error('Missing static partitions');
  const partitions = paths.filter(path => !['/sitemaps/static.xml', '/sitemaps/authors.xml'].includes(path));
  if (partitions.some(path => !chapterPartition.test(path))) throw new Error('Unexpected chapter partition');
  const authors = await getAuthors();
  if (!authors.ok) throw new Error('Authors unavailable');
  const headers = entriesFrom(await getStatic().text(), base).concat(entriesFrom(await authors.text(), base));
  const plans: FilePlan[] = [];
  // Each book partition has at most 1,001 URLs. Limit work as well as file size:
  // cold requests must not aggregate the whole library behind a 15-second proxy.
  for (let n = 0; n < Math.max(Math.ceil(partitions.length / 10), Math.ceil(headers.length / 10000)); n++) {
    plans.push({entries: headers.slice(n * 10000, (n + 1) * 10000), partitions: partitions.slice(n * 10, (n + 1) * 10)});
  }
  return plans;
}

async function loadFile(plan: FilePlan): Promise<BaiduFile[]> {
  const base = siteUrl(), bodies: string[][] = new Array(plan.partitions.length);
  let next = 0, failed = false;
  await Promise.all(Array.from({length: Math.min(6, plan.partitions.length)}, async () => {
    while (!failed && next < plan.partitions.length) {
      const position = next++;
      try {
        const path = plan.partitions[position], match = path.match(chapterPartition)!;
        const response = await getChapters(new Request(base + path), {params: Promise.resolve({bookId: match[1], page: match[2]})});
        if (!response.ok) throw new Error('Sitemap partition unavailable');
        bodies[position] = entriesFrom(await response.text(), base);
      } catch (error) {failed = true; throw error;}
    }
  }));
  const files = splitBaiduEntries(new Set([...plan.entries, ...bodies.flat()]));
  if (files.length !== 1) throw new Error('Unexpected partition capacity');
  return files;
}

// Share the plan and each completed file across route bundles for five minutes.
// Only requested groups are generated. Failures never publish partial groups.
type State = {key: string; expires: number; plans?: FilePlan[]; pending?: Promise<FilePlan[]>};
const globalState = globalThis as typeof globalThis & {baiduSitemapPlan?: State};
async function getPlan() {
  const key = siteUrl() + '|' + getApiBaseUrl();
  if (globalState.baiduSitemapPlan?.key !== key) globalState.baiduSitemapPlan = {key, expires: 0};
  const state = globalState.baiduSitemapPlan;
  if (state.plans && Date.now() < state.expires) return state.plans;
  if (!state.pending) state.pending = createPlan().then(plans => {
    state.plans = plans; state.expires = Date.now() + 300000; return plans;
  }).finally(() => {state.pending = undefined;});
  return state.pending;
}

export async function getBaiduFileList() {
  return (await getPlan()).map((_, index) => ({url: siteUrl() + baiduFilePath(index + 1)}));
}
export async function getBaiduFile(page: number) {
  const plan = (await getPlan())[page - 1];
  if (!plan) return undefined;
  plan.read ??= cacheBaiduFiles(() => loadFile(plan));
  return (await plan.read())[0];
}
