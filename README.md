# 智能书签访问统计

统计书签「被访问次数」，并按热度从右向左重排书签栏的浏览器扩展。

支持：Chrome / Edge / Firefox（Manifest V3）。Safari 因缺少 `bookmarks` 与 `history` API，首版不支持。

设计文档见 [docs/design.md](docs/design.md)。

## 功能

- 以浏览器历史为事实来源，统计每个书签 URL 的被访问次数。
- 相同完整 URL（不含 `#fragment`）在统计上合并为一个实体。
- Folder 访问次数 = 其子树中不同 URL 的访问次数之和。
- 原生书签栏按热度重排：最高项在最右，放不下的收进自建「更多」文件夹（内部热度降序）。
- 自绘侧边栏：从右向左、随窗口宽度自适应，保证最高项始终可见。
- 可选：高热度自动升级到书签栏、物理去重、跨设备同步（`storage.sync`）。
- 生产环境每天首次打开浏览器时重排一次；开发期可配置 1–5 分钟调试周期。

## 快速开始

需要 Node.js 20+（建议 22/24）。

```bash
npm install

# 开发模式（Chrome，热更新）
npm run dev

# 开发模式（Firefox）
npm run dev:firefox

# 生产构建
npm run build:chrome
npm run build:edge
npm run build:firefox
```

构建产物在 `.output/` 下：

- Chrome / Edge：`.output/chrome-mv3/`
- Firefox：`.output/firefox-mv3/`

加载方式：

- Chrome / Edge：打开 `chrome://extensions` 或 `edge://extensions`，开启「开发者模式」，选择「加载已解压的扩展程序」，指向对应目录。
- Firefox：打开 `about:debugging#/runtime/this-firefox`，点击「临时载入附加组件」，选择 `.output/firefox-mv3/manifest.json`。

## 目录结构

```text
entrypoints/
  background.ts       后台：统计、索引、聚合、重排、调度、消息处理
  sidepanel/          自绘侧边栏（右到左自适应展示）
  popup/              弹窗（快捷操作与统计视图）
  options/            设置页（配置、物理去重预览与执行）
lib/
  constants.ts        常量与默认值
  types.ts            共享类型
  url.ts              URL 规范化与文本宽度估算
  storage.ts          本地存储、同步快照与合并
  bookmarks.ts        书签树遍历、聚合、排序辅助
  width.ts            宽度估算
  messages.ts         后台消息协议
wxt.config.ts         三端 manifest 配置
```

## 关键设计约定

- **单一写者**：所有计数写与结构修改都由后台 service worker / event page 串行执行，UI 只发消息。
- **计数按 URL 保存**：书签移动、导入导出不影响计数；Folder 计数读取时实时推导。
- **重排调度**：生产每天一次（当天首次打开浏览器时），避免打扰用户；侧边栏实时布局不移动真实书签。
- **跨浏览器**：Chrome/Edge 走 `side_panel`，Firefox 走 `sidebar_action` 与 event page 后台；书签栏根节点按约定 id 定位（Chromium `1`、Firefox `toolbar_____`）。

## 已知限制

- 原生书签栏是 LTR、右侧先溢出，「最右」与「始终可见」无法同时保证；严格保证由侧边栏承担。
- 原生 `>>` 菜单顺序不可控，因此默认使用自建「更多」文件夹实现溢出内热度倒序。
- Firefox 侧边栏默认在浏览器左侧，与「鼠标在右」存在落差，需实测评估。
- Firefox 上架前需按 Extension Workshop 文档复核 `data_collection_permissions` 的类别声明。
- Safari 暂不支持（缺少 `bookmarks` / `history` API）。
