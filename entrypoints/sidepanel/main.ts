import browser from 'webextension-polyfill';
import { getBookmarkBarId, isFolder, sortChildrenByHeat } from '../../lib/bookmarks';
import { sendToBackground } from '../../lib/messages';
import { loadStore } from '../../lib/storage';
import type { BookmarkNode, WeightedItem } from '../../lib/types';

/**
 * 自绘侧边栏：需求 3 的严格实现。
 *
 * 布局要点：
 *   - 用 flex row-reverse 让「访问次数最高」的项永远贴在最右；
 *   - ResizeObserver 监听容器宽度，按实测项宽贪心决定可见数量；
 *   - 放不下的低热度项折叠进左侧「更多 N+」弹层。
 * 注意：这里只做展示与打开，不移动真实书签（移动由后台日调度完成）。
 */

const rowEl = document.querySelector<HTMLElement>('#bookmarkRow')!;
const backBtn = document.querySelector<HTMLButtonElement>('#backBtn')!;
const breadcrumbEl = document.querySelector<HTMLElement>('#breadcrumb')!;
const morePopover = document.querySelector<HTMLElement>('#morePopover')!;

/** 当前浏览的文件夹 id（初始为书签栏）。 */
let currentFolderId = '';
let parentFolderId: string | undefined;

/** 当前排序后的直接子项，供「更多」弹层复用。 */
let currentItems: WeightedItem[] = [];

backBtn.addEventListener('click', () => {
  if (parentFolderId) void enterFolder(parentFolderId);
});

document.addEventListener('click', (event) => {
  if (!morePopover.hidden && !morePopover.contains(event.target as Node)) {
    morePopover.hidden = true;
  }
});

/** 进入某个文件夹视图。 */
async function enterFolder(folderId: string): Promise<void> {
  currentFolderId = folderId;
  const folder = (await browser.bookmarks.get(folderId))[0];
  parentFolderId = folder?.parentId;
  backBtn.hidden = !parentFolderId;
  breadcrumbEl.textContent = folder?.title || '书签';
  await render();
}

/** 渲染当前文件夹的直接子项，并执行自适应裁剪。 */
async function render(): Promise<void> {
  const store = await loadStore();
  const children = await browser.bookmarks.getChildren(currentFolderId);
  currentItems = sortChildrenByHeat(children, store);

  rowEl.innerHTML = '';
  morePopover.hidden = true;

  const elements = currentItems.map((item) => buildItem(item));
  for (const el of elements) rowEl.appendChild(el);

  // 首次渲染后再做一次自适应，拿到真实项宽
  requestAnimationFrame(() => applyAdaptive());
}

/** 构造单个书签 / 文件夹元素。 */
function buildItem(item: WeightedItem): HTMLElement {
  const el = document.createElement('button');
  el.className = 'bookmark-item';
  el.dataset.item = 'true';
  el.title = `${item.node.title}\n访问次数：${item.weight}`;

  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.textContent = isFolder(item.node) ? '📁' : '🔗';

  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = item.node.title;

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = String(item.weight);

  el.append(icon, title, badge);
  el.addEventListener('click', () => void openItem(item.node));
  return el;
}

/** 打开链接或进入文件夹。 */
async function openItem(node: BookmarkNode): Promise<void> {
  if (isFolder(node)) {
    await enterFolder(node.id);
  } else {
    await sendToBackground({ type: 'openBookmark', id: node.id });
  }
}

/** 根据真实容器宽度计算可见数量，并把其余项收进「更多」。 */
function applyAdaptive(): void {
  const containerWidth = rowEl.clientWidth;
  const itemEls = Array.from(
    rowEl.querySelectorAll<HTMLElement>('[data-item]'),
  );

  // 先把所有项恢复显示再测量，避免上一次被隐藏的项宽度为 0 导致估算失真
  for (const el of itemEls) el.style.display = '';

  // row-reverse 下：第一个 DOM 项在最右（热度最高），后续项向左延伸
  let used = 0;
  let visibleCount = 0;
  const moreBtnWidth = 72;

  for (const el of itemEls) {
    const width = el.getBoundingClientRect().width;
    if (used + width > containerWidth - moreBtnWidth && visibleCount > 0) break;
    used += width;
    visibleCount++;
  }
  visibleCount = Math.max(1, visibleCount);

  itemEls.forEach((el, index) => {
    el.style.display = index < visibleCount ? '' : 'none';
  });

  const hidden = currentItems.slice(visibleCount);
  renderMoreButton(hidden.length);
}

/** 渲染「更多 N+」按钮及其弹层。 */
function renderMoreButton(hiddenCount: number): void {
  const existing = document.getElementById('moreBtn');
  existing?.remove();

  if (hiddenCount <= 0) {
    morePopover.hidden = true;
    return;
  }

  const btn = document.createElement('button');
  btn.id = 'moreBtn';
  btn.className = 'bookmark-item';
  btn.textContent = `更多 ${hiddenCount}+`;
  btn.addEventListener('click', () => {
    const hidden = currentItems.slice(
      currentItems.length - hiddenCount,
    );
    morePopover.innerHTML = '';
    for (const item of hidden) {
      const entry = document.createElement('button');
      entry.textContent = `${isFolder(item.node) ? '📁' : '🔗'} ${item.node.title}（${item.weight}）`;
      entry.addEventListener('click', () => void openItem(item.node));
      morePopover.appendChild(entry);
    }
    morePopover.hidden = !morePopover.hidden;
  });
  rowEl.appendChild(btn);
}

/** 监听容器宽度变化，重新执行自适应。 */
const resizeObserver = new ResizeObserver(() => applyAdaptive());
resizeObserver.observe(rowEl);

/** 初始化：从书签栏根节点开始。 */
async function init(): Promise<void> {
  currentFolderId = await getBookmarkBarId();
  breadcrumbEl.textContent = '书签栏';
  backBtn.hidden = true;
  await render();
}

void init();
