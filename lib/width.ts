import {
  DEFAULT_RESERVE_WIDTH,
  ITEM_GAP,
  ITEM_ICON_WIDTH,
  ITEM_PADDING,
  MAX_TITLE_WIDTH,
} from './constants';
import { estimateTextWidth } from './url';

/**
 * 估算单个书签项的显示宽度。
 * 规则：图标 + 标题实测宽 + 左右 padding + 项间距；标题为空取最小宽，
 * 超长标题按最大宽度截断（用「…」的语义），避免单个长标题占满整栏。
 */
export function estimateItemWidth(title: string): number {
  const clamped = Math.min(estimateTextWidth(title || ''), MAX_TITLE_WIDTH);
  return ITEM_ICON_WIDTH + clamped + ITEM_PADDING + ITEM_GAP;
}

/**
 * 估算原生书签栏可用宽度。
 * 后台无 DOM，只能用窗口宽度减一个可调预留值来逼近；
 * 精确的「放得下几项」是浏览器内部行为，无法获得，文档已声明该边界。
 */
export function estimateAvailableWidth(
  windowWidth: number,
  reserveWidth = DEFAULT_RESERVE_WIDTH,
): number {
  return Math.max(200, windowWidth - reserveWidth);
}

/**
 * 按可用宽度贪心计算可见数量。
 * 返回的 N 保证前 N 项总宽不超过可用宽度（不足时至少保留 1 项）。
 */
export function estimateVisibleCount(titles: string[], availableWidth: number): number {
  let used = 0;
  let count = 0;
  for (const title of titles) {
    const w = estimateItemWidth(title);
    if (used + w > availableWidth && count > 0) break;
    used += w;
    count++;
  }
  return Math.max(1, count);
}
