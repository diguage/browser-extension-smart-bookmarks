import type browser from 'webextension-polyfill';

/** 用户可配置项，全部带默认值，见 constants / storage。 */
export interface Settings {
  /** 是否重排原生书签栏。 */
  reorderNativeBar: boolean;
  /** 原生栏方向：rightHigh=最高在最右；leftHigh=最高在最左。 */
  nativeDirection: 'rightHigh' | 'leftHigh';
  /** 原生栏溢出：customFolder=自建「更多」文件夹；browser=交给原生 >>。 */
  overflowMode: 'browser' | 'customFolder';
  /** 是否递归排序 Folder 内部。 */
  sortSubfolders: boolean;
  /** 物理去重开关（仅作为能力开关，执行仍需用户在 options 里手动确认）。 */
  deduplicateEnabled: boolean;
  /** 高热度自动升级到书签栏。 */
  autoPromoteToBar: boolean;
  /** 升级阈值：访问次数 >= 此值才升级。 */
  promoteThreshold: number;
  /** 跨设备同步开关。 */
  syncEnabled: boolean;
  /** 开发调试用重排周期（分钟），0 表示关闭。 */
  debugSortIntervalMinutes: number;
}

/** 本地持久化的完整数据对象。 */
export interface StoreData {
  schemaVersion: number;
  /** key = 规范化 URL，value = 被访问次数。 */
  visits: Record<string, number>;
  /** key = 规范化 URL，value = 最近访问时间戳。 */
  lastVisitedAt: Record<string, number>;
  /** 自建「更多」文件夹的节点 id，避免每次按标题查找。 */
  moreFolderId?: string;
  settings: Settings;
}

/** bookmarks API 返回的节点类型别名，便于书写。 */
export type BookmarkNode = browser.Bookmarks.BookmarkTreeNode;

/** 排序后的展示项：节点 + 计算出的热度权重。 */
export interface WeightedItem {
  node: BookmarkNode;
  weight: number;
  lastVisitedAt: number;
}
