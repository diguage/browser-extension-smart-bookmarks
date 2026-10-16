import { defineConfig } from 'wxt';

/**
 * 三端共用的构建配置。
 *
 * - 后台脚本：wxt 会按目标浏览器自动处理 Chrome/Edge 的 service worker
 *   与 Firefox 的 event page，无需手写两套 background。
 * - 侧边栏：Chrome/Edge 使用 side_panel，Firefox 使用 sidebar_action。
 * - popup / options 三端一致。
 */
export default defineConfig({
  manifestVersion: 3,
  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';

    return {
      name: '智能书签访问统计',
      description: '统计书签被访问次数，并按热度从右向左重排书签栏',
      version: '0.1.0',
      permissions: [
        'bookmarks',
        'storage',
        'history',
        'alarms',
        // Firefox 没有 sidePanel 权限，只保留给 Chromium 系
        ...(isFirefox ? [] : ['sidePanel']),
      ],
      action: {
        default_title: '智能书签访问统计',
        default_popup: 'popup.html',
      },
      ...(isFirefox
        ? {
            sidebar_action: {
              default_title: '智能书签访问统计',
              default_panel: 'sidepanel.html',
            },
          }
        : {
            side_panel: {
              default_path: 'sidepanel.html',
            },
          }),
      options_ui: {
        page: 'options.html',
        open_in_tab: true,
      },
      ...(isFirefox
        ? {
            // Firefox MV3 要求显式扩展 ID（首次上架后不可更改）
            browser_specific_settings: {
              gecko: {
                id: 'smart-bookmark-visits@diguage.dev',
                // Mozilla 自 2025-11 起要求新扩展声明数据收集类别。
                // 本扩展只读取浏览历史与书签做本地计数，不向任何服务器上传。
                // 上架前请按 Extension Workshop 文档复核这两个类别。
                data_collection_permissions: {
                  required: ['browsingActivity', 'bookmarksInfo'],
                },
              },
            },
          }
        : {}),
    };
  },
});
