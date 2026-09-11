import {safeFetch} from './request';
import {buildCatalogVolumes} from '../../shared/catalog-volumes.mjs';

export type CatalogChapter = {id: string; title: string; chapter_number: number};
export type CatalogSeed = {rows: CatalogChapter[]; total: number | null};
export type CatalogVolume = {id: string; title: string; start: number; count: number};
export type CatalogSnapshot = {
  rows: ReadonlyMap<number, CatalogChapter>; indices: ReadonlyMap<string, number>;
  total: number | null; version?: string; generation: number; resolved: ReadonlySet<string>; error: string;
  volumes?: readonly CatalogVolume[];
};
type WindowData = {rows: CatalogChapter[]; offset: number; total: number; version: string; activeIndex: number | null; volumes?: CatalogVolume[]};
type Job = {offset: number; limit: number; anchor?: string; background: boolean};
export type CatalogNetwork = {saveData?: boolean; effectiveType?: string; downlink?: number};

// Measured against 375- and 10,000-chapter catalogs. Keep the initial view small
// on constrained links; amortize request latency when filling a large catalog.
export function catalogStrategy(total: number | null, network: CatalogNetwork = {}) {
  const constrained = network.saveData || /(^|-)2g$|3g/.test(network.effectiveType ?? '') || (network.downlink !== undefined && network.downlink < 1.5);
  return {initial: !constrained && total !== null && total <= 512 ? Math.max(1, total) : 128,
    batch: constrained ? 512 : 2048, background: !network.saveData && !/2g/.test(network.effectiveType ?? '') && (total === null || total <= 20000)};
}
const empty = (): CatalogSnapshot => ({rows: new Map(), indices: new Map(), total: null, generation: 0, resolved: new Set(), error: ''});
const maxAge = 60000;

export class BookCatalog {
  private snapshot = empty();
  private listeners = new Set<() => void>();
  private queue: Job[] = [];
  private active = new Map<Job, AbortController>();
  private epoch = 0;
  private validatedAt = 0;
  private anchor?: string;
  private backgroundOwners = new Set<symbol>();
  private network: CatalogNetwork = {};
  private failed?: Job;
  private revisions = 0;
  constructor(readonly bookId: string, version?: string, seed?: CatalogSeed) {
    this.snapshot = {...empty(), version};
    if (seed?.total !== null && seed?.total !== undefined) {
      const rows = new Map(seed.rows.map((row, index) => [index, row]));
      this.snapshot = {...this.snapshot, rows, indices: new Map(seed.rows.map((row, index) => [row.id, index])), total: seed.total,
        volumes: seed.rows.length === seed.total ? buildCatalogVolumes(seed.rows) : undefined};
      this.validatedAt = Date.now();
    }
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  get retained() {return this.listeners.size > 0;}
  private publish(snapshot: CatalogSnapshot) {this.snapshot = snapshot; this.listeners.forEach(listener => listener());}
  private reset(version?: string) {
    this.epoch++; for (const controller of this.active.values()) controller.abort(); this.active.clear(); this.queue = [];
    this.validatedAt = 0; this.publish({...empty(), version, generation: this.epoch});
  }
  dispose() {this.epoch++; for (const controller of this.active.values()) controller.abort(); this.queue = [];}
  watch(anchor: string | undefined, background: boolean, network: CatalogNetwork = {}, version?: number) {
    this.anchor = anchor; this.network = network;
    const owner = Symbol(); if (background) this.backgroundOwners.add(owner);
    if (version !== undefined && version > Number(this.snapshot.version ?? -1)) this.reset(String(version));
    else if (this.validatedAt && Date.now() - this.validatedAt > maxAge && this.active.size === 0) this.reset(this.snapshot.version);
    this.locate(anchor); this.pump();
    return () => {
      this.backgroundOwners.delete(owner);
      if (!this.backgroundOwners.size) {
        this.queue = this.queue.filter(job => !job.background);
        for (const [job, controller] of this.active) if (job.background) {controller.abort(); this.active.delete(job);}
      }
    };
  }
  private locate(anchor?: string) {
    const {indices, resolved, total, rows} = this.snapshot;
    if (this.snapshot.volumes && (anchor ? indices.has(anchor) || resolved.has(anchor) : total !== null && (rows.has(0) || total === 0))) return;
    this.enqueue({anchor, offset: 0, limit: catalogStrategy(total, this.network).initial, background: false});
  }
  ensureRange = (start: number, end: number) => {
    const {total, rows} = this.snapshot;
    if (total === null || total === 0) return;
    start = Math.max(0, start); end = Math.min(total - 1, end);
    const missing = Array.from({length: Math.max(0, end - start + 1)}, (_, i) => start + i).find(i => !rows.has(i));
    if (missing === undefined) return;
    const limit = Math.min(128, total);
    const offset = Math.max(0, Math.min(missing - Math.floor(limit / 4), total - limit));
    // Discard queued positions that have already scrolled out of view.
    this.queue = this.queue.filter(job => job.anchor || job.background);
    this.enqueue({offset, limit, background: false});
  };
  retry = () => {
    const failed = this.failed; this.failed = undefined; this.revisions = 0;
    this.publish({...this.snapshot, error: ''});
    if (failed) this.enqueue({...failed, background: false}); else this.locate(this.anchor);
    this.pump();
  };
  private enqueue(job: Job) {
    if ([...this.queue, ...this.active.keys()].some(other => (job.background || !other.background) && (job.anchor ? other.anchor === job.anchor : !other.anchor && other.offset <= job.offset && other.offset + other.limit >= job.offset + job.limit))) return;
    if (job.background) this.queue.push(job); else this.queue.unshift(job);
    this.pump();
  }
  private pump() {
    if (this.snapshot.error) return;
    while (this.active.size < 2 && this.queue.length) {
      const job = this.queue.shift()!;
      const controller = new AbortController(); this.active.set(job, controller);
      void this.read(job, controller, this.epoch);
    }
    // Only one speculative request at a time, leaving a slot for scrolling.
    if (this.active.size || !this.backgroundOwners.size || !catalogStrategy(this.snapshot.total, this.network).background) return;
    const {total, rows} = this.snapshot;
    if (total === null) return;
    let offset = 0; while (offset < total && rows.has(offset)) offset++;
    if (offset === total) return;
    const limit = Math.min(catalogStrategy(total, this.network).batch, total - offset);
    this.enqueue({offset, limit, background: true});
  }
  private async read(job: Job, controller: AbortController, epoch: number) {
    try {
      const params = new URLSearchParams({offset: String(job.offset), limit: String(job.limit)});
      if (job.anchor) params.set('anchor', job.anchor);
      if (this.snapshot.version !== undefined) params.set('version', this.snapshot.version);
      const response = await safeFetch(`/api/books/${this.bookId}/catalog?${params}`, {cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])});
      if (epoch !== this.epoch || controller.signal.aborted) return;
      if (response.status === 409) {
        const {version} = await response.json();
        if (++this.revisions > 2) throw Error('目录正在更新，请重试');
        this.reset(String(version)); this.locate(this.anchor); return;
      }
      if (!response.ok) throw Error(response.status === 404 ? '作品或目录已不可用' : '目录暂不可用，请重试');
      const data: WindowData = await response.json();
      if (epoch !== this.epoch || controller.signal.aborted) return;
      if (!Array.isArray(data.rows) || !Number.isSafeInteger(data.total) || data.total < 0 || !Number.isSafeInteger(data.offset) || data.offset < 0 || data.offset + data.rows.length > data.total || data.rows.some(row => !row.id || typeof row.title !== 'string' || !Number.isFinite(row.chapter_number))) throw Error('目录数据无效，请重试');
      if (this.snapshot.version !== undefined && this.snapshot.version !== data.version) throw Error('目录版本不一致，请重试');
      const volumes = data.volumes ?? (data.offset === 0 && data.rows.length === data.total ? buildCatalogVolumes(data.rows) : [{id: 'body', title: '正文', start: 0, count: data.total}]);
      let covered = 0;
      const volumeIds = new Set<string>();
      for (const volume of volumes) {
        if (!volume.id || volumeIds.has(volume.id) || typeof volume.title !== 'string' || !volume.title.trim() || volume.start !== covered || !Number.isSafeInteger(volume.count) || volume.count < 1) throw Error('分卷数据无效，请重试');
        covered += volume.count; volumeIds.add(volume.id);
      }
      if (covered !== data.total) throw Error('分卷数据不完整，请重试');
      const rows = new Map(this.snapshot.rows), indices = new Map(this.snapshot.indices), resolved = new Set(this.snapshot.resolved);
      for (let i = 0; i < data.rows.length; i++) {rows.set(data.offset + i, data.rows[i]); indices.set(data.rows[i].id, data.offset + i);}
      if (job.anchor && data.activeIndex === null && !indices.has(job.anchor)) resolved.add(job.anchor);
      if (rows.size > 20000) {
        const focus = job.anchor ? indices.get(job.anchor) ?? job.offset : job.offset;
        const farthest = [...rows.keys()].sort((a, b) => Math.abs(b - focus) - Math.abs(a - focus));
        for (const index of farthest.slice(0, rows.size - 20000)) {indices.delete(rows.get(index)!.id); rows.delete(index);}
      }
      this.validatedAt = Date.now(); this.revisions = 0;
      const previousVolumes = this.snapshot.volumes;
      const sameVolumes = previousVolumes?.length === volumes.length && previousVolumes.every((volume, i) => volume.id === volumes[i].id && volume.title === volumes[i].title && volume.start === volumes[i].start && volume.count === volumes[i].count);
      this.publish({rows, indices, resolved, total: data.total, version: data.version, generation: this.epoch, error: '', volumes: sameVolumes ? previousVolumes : volumes});
    } catch (error) {
      if (epoch !== this.epoch || controller.signal.aborted) return;
      this.failed = job; this.publish({...this.snapshot, error: error instanceof Error ? error.message : '目录暂不可用，请重试'});
    } finally {
      this.active.delete(job); if (epoch === this.epoch) this.pump();
    }
  }
}

const catalogs = new Map<string, BookCatalog>();
export function getBookCatalog(bookId: string, version?: number | string, seed?: CatalogSeed) {
  const hint = version === undefined ? undefined : String(version);
  if (typeof window === 'undefined') return new BookCatalog(bookId, hint, seed);
  let catalog = catalogs.get(bookId);
  if (!catalog) {catalog = new BookCatalog(bookId, hint, seed); catalogs.set(bookId, catalog);}
  else {catalogs.delete(bookId); catalogs.set(bookId, catalog);}
  for (const [id, entry] of catalogs) if (catalogs.size > 3 && entry !== catalog) {if (!entry.retained) entry.dispose(); catalogs.delete(id);}
  return catalog;
}
