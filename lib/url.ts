/**
 * URL 规范化工具。
 *
 * 目标：把「指向同一页面」的不同写法映射到同一个 key，作为统计与去重的合并键。
 * 合并键规则（与设计文档一致）：
 *   - 协议 + 域名 + 端口(默认端口归一) + 路径 + 查询参数全等才视为同一 URL；
 *   - #fragment 不参与比较；
 *   - 查询参数按原顺序比较，不做排序。
 */

/** 规范化一个 URL；解析失败时原样返回，保证不抛异常、不丢数据。 */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);

    // fragment 不参与比较
    u.hash = '';

    // 协议统一小写（http / https 大小写差异不影响页面身份）
    const protocol = u.protocol.toLowerCase();

    // 默认端口归一：http:80 与 https:443 视为无端口
    let port = u.port;
    if ((protocol === 'http:' && port === '80') || (protocol === 'https:' && port === '443')) {
      port = '';
    }

    // 手工拼装 key，避免 URL.toString() 自动补尾斜杠导致的边界不一致
    const host = u.hostname.toLowerCase();
    const path = u.pathname || '/';
    return `${protocol}//${host}${port ? ':' + port : ''}${path}${u.search}`;
  } catch {
    return raw;
  }
}

/** 判断字符是否属于宽字符（中日韩等），用于文本宽度估算。 */
function isWideChar(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一表意文字
    (code >= 0x3040 && code <= 0x30ff) || // 日文假名
    (code >= 0xff00 && code <= 0xffef) || // 全角字符
    (code >= 0xac00 && code <= 0xd7af) // 韩文
  );
}

/** 估算一段文本的显示宽度（像素）。后台 service worker 无 DOM，只能用启发式。 */
export function estimateTextWidth(
  text: string,
  asciiWidth = 8,
  cjkWidth = 16,
): number {
  let width = 0;
  for (const ch of text) {
    width += isWideChar(ch.codePointAt(0) ?? 0) ? cjkWidth : asciiWidth;
  }
  return width;
}
