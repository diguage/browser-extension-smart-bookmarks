/**
 * 全局常量与默认配置。
 *
 * 集中放置便于维护：所有魔法值都从这里取，避免散落在业务代码里。
 */

/** 本地存储的主 key，整个数据对象存在一个 key 下，读写更一致。 */
export const STORE_KEY = 'smartBookmarkVisits';

/** 当前存储 schema 版本，升级时用于迁移。 */
export const SCHEMA_VERSION = 2;

/** 自建「更多」文件夹的默认标题（物理溢出收纳用）。 */
export const MORE_FOLDER_TITLE = '更多书签';

/** Chromium 系（Chrome / Edge）书签栏根节点约定 id。 */
export const BOOKMARK_BAR_ID_CHROMIUM = '1';

/** Firefox 书签工具栏根节点约定 id。 */
export const BOOKMARK_BAR_ID_FIREFOX = 'toolbar_____';

/** 按 1920×1080 常见屏幕估算：可放书签数约 12–15 个，取两倍并取整。 */
export const DEFAULT_PROMOTE_THRESHOLD = 30;

/** 每项宽度的基线：图标 + 左右内边距，标题宽度在此基础上追加。 */
export const ITEM_ICON_WIDTH = 20;
export const ITEM_PADDING = 12;
export const ITEM_GAP = 6;

/** 标题最大显示宽度，超出部分按「…」截断参与计算。 */
export const MAX_TITLE_WIDTH = 160;

/** 原生书签栏可用宽度的默认预留（浏览器 UI、溢出按钮等），设置页可调。 */
export const DEFAULT_RESERVE_WIDTH = 400;

/** 字符宽度估算：ASCII 与 CJK 分别的近似像素值（后台无 DOM，只能用启发式）。 */
export const CHAR_WIDTH_ASCII = 8;
export const CHAR_WIDTH_CJK = 16;
