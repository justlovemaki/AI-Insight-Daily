export function proxyImageUrl(url: string, proxyTemplate?: string): string {
  if (!url || !proxyTemplate) return url;
  
  // 如果 URL 已经是代理后的，或者是 data: 协议，则跳过
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  
  try {
    // 替换模板中的 {url}
    // 注意：可能需要对 URL 进行编码
    return proxyTemplate.replace('{url}', encodeURIComponent(url));
  } catch (e) {
    console.error('Failed to proxy image URL:', e);
    return url;
  }
}

/**
 * 处理 HTML 字符串中的所有图片 src，添加代理
 */
export function proxyHtmlImages(html: string, proxyTemplate?: string): string {
  if (!html || !proxyTemplate) return html;
  
  return html.replace(/<img([^>]+)src=["']([^"']+)["']([^>]*)>/gi, (_match, p1, src, p3) => {
    const proxiedSrc = proxyImageUrl(src, proxyTemplate);
    return `<img${p1}src="${proxiedSrc}"${p3}>`;
  });
}
