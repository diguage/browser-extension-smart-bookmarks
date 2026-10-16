import browser from 'webextension-polyfill';
import {
  BOOKMARK_BAR_ID_CHROMIUM,
  BOOKMARK_BAR_ID_FIREFOX,
  MORE_FOLDER_TITLE,
} from './constants';
import { canonicalizeUrl } from './url';
import type { BookmarkNode, StoreData, WeightedItem } from './types';

/** 书签节点是否为文件夹（没有 url 即文件夹）。 */
export function isFolder(node: BookmarkNode): boolean {
  return !node.url;
}

/**
 * 定位书签栏根节点 id。
 * Chrome/Edge 用 "1"，Firefox 用 "toolbar_____"，但为了稳妥：
 * 先在根节点子项中按 id 前缀识别，再用标题兜底，最后回退到约定 id。
 */
export async function getBookmarkBarId(): Promise<string> {
  const tree = await browser.bookmarks.getTree();
  const roots = tree[0]?.children ?? [];

  const byPrefix = roots.find(
    (r) => r.id === BOOKMARK_BAR_ID_CHROMIUM || r.id.startsWith('toolbar'),
  );
  if (byPrefix) return byPrefix.id;

  const byTitle = roots.find((r) =>
    ['书签栏', '书签工具栏', 'Bookmarks bar', 'Bookmarks Toolbar'].includes(r.title),
  );
  if (byTitle) return byTitle.id;

  // 最终兜底：按浏览器环境猜测约定 id
  return navigator.userAgent.includes('Firefox')
    ? BOOKMARK_BAR_ID_FIREFOX
    : BOOKMARK_BAR_ID_CHROMIUM;
}

/** 深度优先收集子树中的所有叶子（链接）节点。 */
export function collectLeafNodes(node: BookmarkNode): BookmarkNode[] {
  const leaves: BookmarkNode[] = [];
  const walk = (n: BookmarkNode) => {
    if (n.url) {
      leaves.push(n);
    } else {
      (n.children ?? []).forEach(walk);
    }
  };
  walk(node);
  return leaves;
}

/**
 * 计算子树中「不同规范化 URL」的集合。
 * 相同 URL 在统计上合并，因此去重后再求和。
 */
export function collectDistinctUrls(node: BookmarkNode): Set<string> {
  const urls = new Set<string>();
  for (const leaf of collectLeafNodes(node)) {
    urls.add(canonicalizeUrl(leaf.url ?? ''));
  }
  return urls;
}

/** 计算一个节点的热度权重：链接取自身 URL 计数，文件夹取子树去重 URL 计数之和。 */
export function computeWeight(node: BookmarkNode, store: StoreData): number {
  if (node.url) {
    return store.visits[canonicalizeUrl(node.url)] ?? 0;
  }
  let total = 0;
  for (const url of collectDistinctUrls(node)) {
    total += store.visits[url] ?? 0;
  }
  return total;
}

/** 计算节点最近访问时间：链接取自身 URL，文件夹取子树中的最大值。 */
export function computeLastVisited(node: BookmarkNode, store: StoreData): number {
  if (node.url) {
    return store.lastVisitedAt[canonicalizeUrl(node.url)] ?? 0;
  }
  let max = 0;
  for (const url of collectDistinctUrls(node)) {
    max = Math.max(max, store.lastVisitedAt[url] ?? 0);
  }
  return max;
}

/** 把直接子项按「热度降序 → 最近访问降序 → 标题」排序。 */
export function sortChildrenByHeat(
  children: BookmarkNode[],
  store: StoreData,
): WeightedItem[] {
  return children
    .map((node) => ({
      node,
      weight: computeWeight(node, store),
      lastVisitedAt: computeLastVisited(node, store),
    }))
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        b.lastVisitedAt - a.lastVisitedAt ||
        a.node.title.localeCompare(b.node.title),
    );
}

/**
 * 获取或创建自建「更多」文件夹。
 * 优先用存储里记录的 id，其次按标题查找，避免重复创建。
 */
export async function getOrCreateMoreFolder(store: StoreData): Promise<BookmarkNode> {
  const barId = await getBookmarkBarId();
  const barChildren = await browser.bookmarks.getChildren(barId);

  // 1) 用记录过的 id 直接命中
  if (store.moreFolderId) {
    const found = barChildren.find((c) => c.id === store.moreFolderId && isFolder(c));
    if (found) return found;
  }

  // 2) 按标题兜底，复用用户已有的同名文件夹
  const byTitle = barChildren.find((c) => isFolder(c) && c.title === MORE_FOLDER_TITLE);
  if (byTitle) {
    store.moreFolderId = byTitle.id;
    return byTitle;
  }

  // 3) 新建并记录 id
  const created = await browser.bookmarks.create({
    parentId: barId,
    title: MORE_FOLDER_TITLE,
  });
  store.moreFolderId = created.id;
  return created;
}

/** 判断某节点是否位于指定祖先（书签栏）之下。 */
export async function isUnderFolder(nodeId: string, ancestorId: string): Promise<boolean> {
  let currentId = nodeId;
  while (currentId) {
    if (currentId === ancestorId) return true;
    const nodes = await browser.bookmarks.get(currentId);
    const parentId = nodes[0]?.parentId;
    if (!parentId) break;
    currentId = parentId;
  }
  return false;
}

/** 收集整棵书签树中「不在指定文件夹之下」的叶子节点。 */
export async function collectLeavesOutside(
  root: BookmarkNode,
  folderId: string,
): Promise<BookmarkNode[]> {
  const allLeaves = collectLeafNodes(root);
  const result: BookmarkNode[] = [];
  for (const leaf of allLeaves) {
    if (!(await isUnderFolder(leaf.id, folderId))) {
      result.push(leaf);
    }
  }
  return result;
}

/** 从一组直接子项收集所有叶子链接（不构造虚拟根节点）。 */
export function collectLeavesOfChildren(children: BookmarkNode[]): BookmarkNode[] {
  const leaves: BookmarkNode[] = [];
  for (const child of children) {
    if (child.url) {
      leaves.push(child);
    } else {
      leaves.push(...collectLeafNodes(child));
    }
  }
  return leaves;
}

/**
 * 递归排序一个文件夹内部：直接子项（Folder 与链接）按热度混合排序，
 * 子文件夹先递归排序自身。返回前重新读取一次子项，避免递归移动导致的索引过期。
 */
export async function sortFolderContents(
  folderId: string,
  store: StoreData,
): Promise<void> {
  const children = await browser.bookmarks.getChildren(folderId);
  for (const child of children) {
    if (isFolder(child)) {
      await sortFolderContents(child.id, store);
    }
  }

  const current = await browser.bookmarks.getChildren(folderId);
  const sorted = sortChildrenByHeat(current, store);
  for (let i = 0; i < sorted.length; i++) {
    const node = sorted[i]!.node;
    if (node.index !== i) {
      await browser.bookmarks.move(node.id, { index: i });
    }
  }
}
