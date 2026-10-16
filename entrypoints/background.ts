import browser from 'webextension-polyfill';
import { defineBackground } from 'wxt/utils/define-background';
import {
  collectLeafNodes,
  collectLeavesOutside,
  collectLeavesOfChildren,
  getBookmarkBarId,
  getOrCreateMoreFolder,
  isFolder,
  isUnderFolder,
  sortChildrenByHeat,
  sortFolderContents,
} from '../lib/bookmarks';
import { computeWeight } from '../lib/bookmarks';
import { DEFAULT_RESERVE_WIDTH } from '../lib/constants';
import type { BackgroundMessage, BackgroundResponse } from '../lib/messages';
import {
  clearVisits,
  loadSettings,
  loadStore,
  pullAndMergeSync,
  pushSyncSnapshot,
  saveStore,
  updateSettings,
} from '../lib/storage';
import type { BookmarkNode, StoreData, WeightedItem } from '../lib/types';
import { canonicalizeUrl } from '../lib/url';
import { estimateAvailableWidth, estimateItemWidth } from '../lib/width';

/**
 * 后台 service worker / event page：整个扩展的唯一写入口。
 *
 * 职责：
 *   1. 监听 history.onVisited 统计被访问次数；
 *   2. 维护「规范化 URL -> 书签 id[]」索引；
 *   3. 每天一次（或开发期短周期）执行原生书签栏重排；
 *   4. 处理 UI 发来的消息（排序、统计、设置、去重、打开书签）。
 */

/** URL 索引：规范化 URL -> 命中它的书签 id 列表。 */
let urlIndex = new Map<string, string[]>();

/** 写串行化：MV3 事件可能交错触发，用 promise 链保证读改写原子。 */
let writeChain: Promise<unknown> = Promise.resolve();

/** 同步推送的 debounce 计时器。 */
let syncTimer: ReturnType<typeof setTimeout> | undefined;

/** 重排是否正在执行，防止日调度与手动触发重叠。 */
let sortingInProgress = false;

/**
 * 初始化：加载数据、合并跨设备快照、重建索引、安排调度、绑定事件。
 */
async function initialize(): Promise<void> {
  const store = await loadStore();
  await pullAndMergeSync(store);
  await rebuildIndex();
  scheduleDailySort();
  scheduleDebugSort(store.settings.debugSortIntervalMinutes);
  await checkAndSortIfNeeded();
  bindEvents();
}

/**
 * 重建 URL 索引。
 * 整树遍历 + 整树重建：书签量级下是 O(n)，比增量维护更简单可靠。
 */
async function rebuildIndex(): Promise<void> {
  const tree = await browser.bookmarks.getTree();
  const next = new Map<string, string[]>();

  for (const leaf of collectLeafNodes(tree[0]!)) {
    const key = canonicalizeUrl(leaf.url ?? '');
    const ids = next.get(key) ?? [];
    ids.push(leaf.id);
    next.set(key, ids);
  }
  urlIndex = next;
}

/** 书签结构变化时 debounce 重建索引，避免批量导入/拖拽时频繁全量遍历。 */
function bindIndexRebuild(): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void rebuildIndex(), 500);
  };

  browser.bookmarks.onCreated.addListener(schedule);
  browser.bookmarks.onChanged.addListener(schedule);
  browser.bookmarks.onMoved.addListener(schedule);
  browser.bookmarks.onRemoved.addListener(schedule);
}

/**
 * 串行写队列：把一次写操作排进 promise 链。
 * 所有计数写、重排都经过它，保证后台单线程下不会交错。
 */
function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task);
  writeChain = run.catch(() => undefined);
  return run;
}

/** 记录一次访问：规范化 URL 计数 +1，更新最近访问时间。 */
async function recordVisit(rawUrl: string): Promise<void> {
  const key = canonicalizeUrl(rawUrl);
  if (!urlIndex.has(key)) return;

  await enqueueWrite(async () => {
    const store = await loadStore();
    store.visits[key] = (store.visits[key] ?? 0) + 1;
    store.lastVisitedAt[key] = Date.now();
    await saveStore(store);
    scheduleSyncPush(store);
  });
}

/** 监听历史访问：只处理能命中书签的 URL。 */
function bindHistoryListener(): void {
  browser.history.onVisited.addListener((item) => {
    if (item.url) void recordVisit(item.url);
  });
}

/** 安排每日重排 alarm（周期 24h，叠加首次启动检查）。 */
function scheduleDailySort(): void {
  if (typeof browser.alarms === 'undefined') return;
  browser.alarms.create('dailySort', { periodInMinutes: 24 * 60 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'dailySort') {
      void enqueueWrite(() => performSort());
    }
  });
}

/** 开发 / 调试用短周期 alarm，由设置控制，生产默认关闭。 */
function scheduleDebugSort(intervalMinutes: number): void {
  if (typeof browser.alarms === 'undefined') return;
  browser.alarms.clear('debugSort').then(() => {
    if (intervalMinutes > 0) {
      browser.alarms.create('debugSort', { periodInMinutes: intervalMinutes });
    }
  });
}

/** 当天是否已经排过：用本地日期字符串判断。 */
function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 当天首次使用浏览器时执行一次重排。 */
async function checkAndSortIfNeeded(): Promise<void> {
  const lastSortKey = 'lastSortDate';
  const result = await browser.storage.local.get(lastSortKey);
  if (result[lastSortKey] === todayString()) return;
  await enqueueWrite(async () => {
    await performSort();
    await browser.storage.local.set({ [lastSortKey]: todayString() });
  });
}

/** 主重排逻辑：见 lib/ 各模块，这里只做编排。 */
async function performSort(): Promise<void> {
  if (sortingInProgress) return;
  sortingInProgress = true;
  try {
    const store = await loadStore();
    if (!store.settings.reorderNativeBar) return;

    const barId = await getBookmarkBarId();

    // 1) 可选：把其他收藏里的高热链接升级到书签栏
    if (store.settings.autoPromoteToBar) {
      await promoteHotBookmarks(store, barId);
    }

    // 2) 收集书签栏当前直接子项（自建「更多」文件夹除外）
    const barChildren = await browser.bookmarks.getChildren(barId);
    let moreFolder: BookmarkNode | undefined;
    let barItems = barChildren;

    if (store.settings.overflowMode === 'customFolder') {
      moreFolder = await getOrCreateMoreFolder(store);
      await saveStore(store); // 持久化 moreFolderId
      barItems = barChildren.filter((c) => c.id !== moreFolder!.id);
    }

    const moreItems =
      store.settings.overflowMode === 'customFolder'
        ? await browser.bookmarks.getChildren(moreFolder!.id)
        : [];

    // 3) 合并参与排序的全部顶层项（书签栏 + 「更多」内已有项）
    const allNodes = [...barItems, ...moreItems];
    const sorted = sortChildrenByHeat(allNodes, store);

    // 4) 递归排序每个 Folder 内部
    if (store.settings.sortSubfolders) {
      for (const item of sorted) {
        if (isFolder(item.node)) {
          await sortFolderContents(item.node.id, store);
        }
      }
    }

    if (store.settings.overflowMode === 'customFolder') {
      await reorderWithCustomFolder(sorted, barId, moreFolder!, store);
    } else {
      await reorderNativeOnly(sorted, barId, store);
    }
  } finally {
    sortingInProgress = false;
  }
}

/** 把其他收藏里达到阈值的高热链接移动到书签栏（只升级、不降级）。 */
async function promoteHotBookmarks(store: StoreData, barId: string): Promise<void> {
  const tree = await browser.bookmarks.getTree();
  const outside = await collectLeavesOutside(tree[0]!, barId);

  // 书签栏已有的 URL 集合，避免把一个 URL 重复提升到栏内
  const barChildren = await browser.bookmarks.getChildren(barId);
  const barUrls = new Set<string>();
  for (const leaf of collectLeavesOfChildren(barChildren)) {
    barUrls.add(canonicalizeUrl(leaf.url ?? ''));
  }

  for (const leaf of outside) {
    const weight = computeWeight(leaf, store);
    if (weight >= store.settings.promoteThreshold) {
      const key = canonicalizeUrl(leaf.url ?? '');
      if (!barUrls.has(key)) {
        await browser.bookmarks.move(leaf.id, { parentId: barId });
        barUrls.add(key);
      }
    }
  }
}

/** 自建「更多」文件夹模式：可见项放书签栏（rightHigh），放不下的收进「更多」（热度降序）。 */
async function reorderWithCustomFolder(
  sorted: WeightedItem[],
  barId: string,
  moreFolder: BookmarkNode,
  store: StoreData,
): Promise<void> {
  const windowWidth = await getWindowWidth();
  const available = estimateAvailableWidth(windowWidth, DEFAULT_RESERVE_WIDTH);
  const visibleCount = countByWidth(sorted, available);

  const visible = sorted.slice(0, visibleCount);
  const hidden = sorted.slice(visibleCount);

  // 1) 放不下的项进入「更多」，index 0 是最热的，菜单里自然在顶部
  for (let i = 0; i < hidden.length; i++) {
    const node = hidden[i]!.node;
    if (node.parentId !== moreFolder.id || node.index !== i) {
      await browser.bookmarks.move(node.id, { parentId: moreFolder.id, index: i });
    }
  }

  // 2) 可见项放回书签栏：rightHigh = 升序摆放（最低在左、最高在右）
  const ordered = store.settings.nativeDirection === 'rightHigh'
    ? [...visible].reverse()
    : visible;
  for (let i = 0; i < ordered.length; i++) {
    const node = ordered[i]!.node;
    if (node.parentId !== barId || node.index !== i) {
      await browser.bookmarks.move(node.id, { parentId: barId, index: i });
    }
  }

  // 3) 「更多」文件夹放到书签栏最右侧
  const finalChildren = await browser.bookmarks.getChildren(barId);
  const moreIndex = finalChildren.findIndex((c) => c.id === moreFolder.id);
  const targetIndex = finalChildren.length - 1;
  if (moreIndex !== -1 && moreIndex !== targetIndex) {
    await browser.bookmarks.move(moreFolder.id, { index: targetIndex });
  }
}

/** 原生 >> 模式：只重排书签栏现有子项，不移动归属。 */
async function reorderNativeOnly(
  sorted: WeightedItem[],
  barId: string,
  store: StoreData,
): Promise<void> {
  const ordered = store.settings.nativeDirection === 'rightHigh'
    ? [...sorted].reverse()
    : sorted;
  for (let i = 0; i < ordered.length; i++) {
    const node = ordered[i]!.node;
    if (node.parentId !== barId || node.index !== i) {
      await browser.bookmarks.move(node.id, { parentId: barId, index: i });
    }
  }
}

/** 按宽度贪心计算可见数量。 */
function countByWidth(sorted: WeightedItem[], available: number): number {
  let used = 0;
  let count = 0;
  for (const item of sorted) {
    const w = estimateItemWidth(item.node.title);
    if (used + w > available && count > 0) break;
    used += w;
    count++;
  }
  return Math.max(1, count);
}

/** 读取最后聚焦窗口的宽度（DIP），失败回退到 1280。 */
async function getWindowWidth(): Promise<number> {
  try {
    const win = await browser.windows.getLastFocused();
    return win?.width ?? 1280;
  } catch {
    return 1280;
  }
}

/** debounce 后推送同步快照，避免每条访问都写 storage.sync。 */
function scheduleSyncPush(store: StoreData): void {
  if (!store.settings.syncEnabled) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void loadStore().then(pushSyncSnapshot);
  }, 30_000);
}

/** 绑定所有事件监听。 */
function bindEvents(): void {
  bindHistoryListener();
  bindIndexRebuild();
  browser.runtime.onMessage.addListener((message: unknown) =>
    handleMessage(message as BackgroundMessage),
  );
}

/** 统计 TOP N：把计数映射回书签标题后返回。 */
async function getTopStats(limit = 50) {
  const store = await loadStore();
  const tree = await browser.bookmarks.getTree();
  const titleByUrl = new Map<string, string>();
  for (const leaf of collectLeafNodes(tree[0]!)) {
    const key = canonicalizeUrl(leaf.url ?? '');
    if (!titleByUrl.has(key)) titleByUrl.set(key, leaf.title || leaf.url || key);
  }

  return Object.entries(store.visits)
    .map(([url, count]) => ({
      url,
      count,
      title: titleByUrl.get(url) ?? url,
      lastVisitedAt: store.lastVisitedAt[url] ?? 0,
    }))
    .sort((a, b) => b.count - a.count || b.lastVisitedAt - a.lastVisitedAt)
    .slice(0, limit);
}

/** 物理去重预览：按相同 URL 分组，给出保留项与将删除项。 */
async function dedupePreview() {
  const tree = await browser.bookmarks.getTree();
  const barId = await getBookmarkBarId();
  const leaves = collectLeafNodes(tree[0]!);

  const groups = new Map<string, BookmarkNode[]>();
  for (const leaf of leaves) {
    const key = canonicalizeUrl(leaf.url ?? '');
    const list = groups.get(key) ?? [];
    list.push(leaf);
    groups.set(key, list);
  }

  const result = [];
  for (const [url, nodes] of groups) {
    if (nodes.length <= 1) continue;
    // 优先保留书签栏内的；否则保留树中先出现的一份
    const inBar = [];
    for (const n of nodes) {
      if (await isUnderFolder(n.id, barId)) inBar.push(n);
    }
    const keep = (inBar.length > 0 ? inBar : nodes)[0]!;
    result.push({
      url,
      title: keep.title,
      keepId: keep.id,
      remove: nodes.filter((n) => n.id !== keep.id).map((n) => ({ id: n.id, title: n.title })),
    });
  }
  return result;
}

/** 执行物理去重：需要用户在设置里打开了该能力开关。 */
async function dedupeExecute() {
  const store = await loadStore();
  if (!store.settings.deduplicateEnabled) {
    throw new Error('物理去重未启用，请先在设置中打开开关');
  }
  const preview = await dedupePreview();
  for (const group of preview) {
    for (const item of group.remove) {
      await browser.bookmarks.remove(item.id);
    }
  }
  await rebuildIndex();
  return { removedGroups: preview.length };
}

/** 统一消息处理入口。 */
async function handleMessage(
  message: BackgroundMessage,
): Promise<BackgroundResponse> {
  try {
    switch (message.type) {
      case 'getStats':
        return { ok: true, data: await getTopStats() };
      case 'getSettings':
        return { ok: true, data: await loadSettings() };
      case 'updateSettings':
        {
          const next = await updateSettings(message.patch);
          scheduleDebugSort(next.debugSortIntervalMinutes);
          return { ok: true, data: next };
        }
      case 'sortNow':
        await enqueueWrite(() => performSort());
        return { ok: true, data: null };
      case 'clearStats':
        await clearVisits();
        return { ok: true, data: null };
      case 'openBookmark': {
        const nodes = await browser.bookmarks.get(message.id);
        const node = nodes[0];
        if (node?.url) {
          await browser.tabs.create({ url: node.url });
        }
        return { ok: true, data: null };
      }
      case 'dedupePreview':
        return { ok: true, data: await dedupePreview() };
      case 'dedupeExecute':
        return { ok: true, data: await dedupeExecute() };
      default:
        return { ok: false, error: '未知消息类型' };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * WXT 要求后台入口默认导出一个 defineBackground(...)。
 * service worker / event page 每次被唤醒时，回调内的 initialize 都会执行一次，
 * 恰好满足「当天首次使用浏览器时检查并重排」的语义。
 */
export default defineBackground(() => {
  void initialize();
});
