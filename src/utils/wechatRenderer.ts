import { LogService } from '../services/LogService.js';

/**
 * 将 Markdown 格式的日报转换为微信公众号 HTML 格式
 * 参考 ccc/convert_md_to_wechat_html.py 实现
 */

export interface WechatArticleData {
  date: string;
  summaryLines: string[];
  sections: Record<string, string[]>;
  allLinks: Array<{ title: string; url: string }>;
}

export class WechatRenderer {
  /**
   * 从 Markdown 内容中提取所有链接及其所属条目的标题
   */
  public static extractAllLinksWithTitles(content: string): Array<{ title: string; url: string }> {
    if (!content) return [];
    
    // 截取到 "AI资讯日报多渠道" 之前的内容
    let mainContent = content;
    const voiceSectionMatch = content.match(/---\s*\n\s*##\s*\*\*AI资讯日报多渠道\*\*/);
    if (voiceSectionMatch && voiceSectionMatch.index !== undefined) {
      mainContent = content.substring(0, voiceSectionMatch.index);
    }

    const links: Array<{ title: string; url: string }> = [];
    const seenUrls = new Set<string>();

    // 首先处理头部的链接 (访问网页版等)
    const headerMatch = mainContent.match(/^[\s\S]*?(?=### )/);
    if (headerMatch) {
      const headerContent = headerMatch[0];
      const linkPattern = /(?<!\!)\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g;
      let match;
      while ((match = linkPattern.exec(headerContent)) !== null) {
        const text = match[1];
        const url = match[2];
        const cleanText = text.replace(/\(AI资讯\)/g, '').trim();
        if (!url.includes('/images/') && !url.includes('/logo/') && cleanText && !seenUrls.has(url)) {
          links.push({ title: cleanText, url });
          seenUrls.add(url);
        }
      }
    }

    // 然后处理各个条目中的链接
    // 使用更宽松的正则匹配条目
    const itemPattern = /\r?\n\d+\.\s+\*\*(.*?)\*\*([\s\S]*?)(?=\r?\n\d+\.\s+\*\*|\r?\n###|\r?\n---| \r?\n|$)/g;
    let itemMatch;
    // 为了匹配第一个条目，我们在前面补一个换行
    const contentToSearch = '\n' + mainContent;
    while ((itemMatch = itemPattern.exec(contentToSearch)) !== null) {
      const itemTitle = itemMatch[1].trim();
      const itemContent = itemMatch[2];

      const linkPattern = /(?<!\!)\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g;
      let linkMatch;
      while ((linkMatch = linkPattern.exec(itemContent)) !== null) {
        const url = linkMatch[2];
        if (url.includes('/images/') || url.includes('/logo/') || seenUrls.has(url)) {
          continue;
        }
        links.push({ title: itemTitle, url });
        seenUrls.add(url);
      }
    }

    return links;
  }

  /**
   * 解析 Markdown 内容
   */
  public static parseMarkdown(content: string): WechatArticleData {
    if (!content) {
      throw new Error('Markdown content is empty');
    }

    LogService.info(`WechatRenderer.parseMarkdown: Received content (length: ${content.length})`);
    LogService.info(`Content preview: ${content.substring(0, 200)}...`);

    // 提取日期
    const dateMatch = content.match(/## AI资讯日报 (\d{4}\/\d{1,2}\/\d{1,2})/);
    const date = dateMatch ? dateMatch[1] : '';

    if (!date) {
      LogService.warn('WechatRenderer: Date not found in markdown');
    }

    // 提取今日摘要
    // 兼容带 ** 或不带 ** 的情况
    const summaryMatch = content.match(/### (?:\*\*)?今日摘要(?:\*\*)?\s+```\s+([\s\S]*?)\s+```/);
    const summaryLines = summaryMatch ? summaryMatch[1].trim().split('\n') : [];

    if (summaryLines.length === 0) {
      LogService.warn('WechatRenderer: Summary not found in markdown');
    }

    // 截取主内容
    let mainContent = content;
    const voiceSectionMatch = content.match(/---\s*\n\s*##\s*\*\*AI资讯日报多渠道\*\*/);
    if (voiceSectionMatch && voiceSectionMatch.index !== undefined) {
      mainContent = content.substring(0, voiceSectionMatch.index);
    }

    const allLinks = this.extractAllLinksWithTitles(content);

    const sections: Record<string, string[]> = {
      '产品与功能更新': [],
      '前沿研究': [],
      '行业展望与社会影响': [],
      '开源TOP项目': [],
      '社媒分享': []
    };

    const lines = mainContent.split(/\r?\n/);
    let currentSectionName: string | null = null;
    let currentSectionLines: string[] = [];

    const processSection = (name: string, lines: string[]) => {
      if (sections[name]) {
        const content = lines.join('\n').trim();
        // 分割条目：匹配数字编号开头，兼容不同换行符
        const items = content.split(/\n(?=\d+\.\s+\*\*)/);
        for (let item of items) {
          item = item.trim();
          if (item && /^\d+\.\s+\*\*/.test(item)) {
            sections[name].push(item.replace(/^\d+\.\s+/, ''));
          }
        }
      }
    };

    for (const line of lines) {
      if (line.startsWith('### ')) {
        // 如果之前在处理某个 section，先处理它
        if (currentSectionName) {
          processSection(currentSectionName, currentSectionLines);
        }

        // 识别新的 section
        const title = line.replace('### ', '').replace(/\*\*/g, '').trim();
        if (sections[title] !== undefined) {
          currentSectionName = title;
        } else {
          currentSectionName = null;
        }
        currentSectionLines = [];
      } else if (currentSectionName) {
        currentSectionLines.push(line);
      }
    }

    // 处理最后一个 section
    if (currentSectionName) {
      processSection(currentSectionName, currentSectionLines);
    }

    return { date, summaryLines, sections, allLinks };
  }

  /**
   * 从条目文本中提取标题、内容和图片
   */
  public static extractItemContent(itemText: string) {
    const titleMatch = itemText.match(/^\*\*(.*?)\*\*/s);
    const title = titleMatch ? titleMatch[1] : '';

    let content = itemText.replace(/^\*\*.*?\*\*\s*/, '');

    // 提取图片
    const imgPattern = /!\[.*?\]\((https:\/\/.*?)\)/g;
    const images: string[] = [];
    let imgMatch;
    while ((imgMatch = imgPattern.exec(content)) !== null) {
      images.push(imgMatch[1]);
    }

    // 移除图片标记，保留文本
    content = content.replace(/(?:<br\/>)?\s*!\[.*?\]\((https:\/\/.*?)\)\s*(?:<br\/>)?/g, '');

    // 处理视频标签
    const videoPattern = /<video[^>]*>([\s\S]*?)<\/video>|<video[^>]*\/>/g;
    const videos: string[] = [];
    let videoMatch;
    while ((videoMatch = videoPattern.exec(content)) !== null) {
      videos.push(videoMatch[0]);
    }

    // 占位符替换
    videos.forEach((video, i) => {
      content = content.replace(video, `___VIDEO_${i}___`);
    });

    content = content.replace(/<br\/>\s*<br\/>/g, '<br/>').trim();

    // 恢复视频
    videos.forEach((video, i) => {
      content = content.replace(`___VIDEO_${i}___`, video);
    });

    return { title, content, images };
  }

  /**
   * 格式化内容为 HTML
   */
  public static formatContentHtml(content: string): string {
    // 保护 video 标签的 width="100%"
    let formatted = content.replace(/width="100%"/g, 'width="___VIDEO_WIDTH_100___"');

    // 数字高亮
    formatted = formatted.replace(/(\d+(?:\.\d+)?[倍万亿美元%]+)/g, '<small style="color: #ff003c; text-decoration: none; font-weight: bold;">$1</small>');

    // 恢复 video width
    formatted = formatted.replace(/width="___VIDEO_WIDTH_100___"/g, 'width="100%"');

    // 替换链接标记
    formatted = formatted.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, (match, text, url) => {
      if (url.includes('/images/') || url.includes('/logo/')) {
        return text;
      }
      if (text.includes('<small')) {
        return text;
      }
      return `<small style="color: #ff003c; text-decoration: none; font-weight: bold;">${text}</small>`;
    });

    // 换行
    formatted = formatted.replace(/\n/g, '<br>');

    return formatted;
  }

  private static generateHtmlItem(index: number, title: string, content: string, images: string[]): string {
    let html = `        <div style="margin-bottom: 20px; padding-left: 10px; border-left: 2px solid #f2f2f2;">
          <p style="font-size: 15px; line-height: 1.8; margin-bottom: 10px;">
            <strong style="color: #000;">${index}. ${title}</strong><br>
            ${this.formatContentHtml(content)}
          </p>`;

    for (const imgUrl of images) {
      html += `
          <img src="${imgUrl}" style="width: 100%; border: 1px solid #000; margin-bottom: 10px;">`;
    }

    html += `
        </div>
`;
    return html;
  }

  private static generateLinkHtml(title: string, url: string): string {
    return `        <!-- Link -->
        <div style="display: flex; align-items: flex-start; gap: 10px;">
          <span style="color: #00e5ff; font-family: monospace; font-size: 14px;">>_</span>
          <div style="flex: 1;">
            <p style="margin: 0 0 2px 0; font-size: 14px; font-weight: bold; color: #fff;">
              ${title}
            </p>
            <p style="margin: 0; font-size: 12px; color: #ff003c; font-family: monospace; word-break: break-all;">
              ${url}
            </p>
          </div>
        </div>

`;
  }

  /**
   * 生成完整的微信 HTML
   */
  public static render(data: WechatArticleData, showVoiceSection: boolean = false): string {
    LogService.info(`WechatRenderer.render: Rendering HTML for date: ${data.date}, showVoiceSection: ${showVoiceSection}`);
    
    const summaryHtml = data.summaryLines.join('<br>');

    const productHtml = data.sections['产品与功能更新'].map((item, i) => {
      const { title, content, images } = this.extractItemContent(item);
      return this.generateHtmlItem(i + 1, title, content, images);
    }).join('');

    const researchHtml = data.sections['前沿研究'].map((item, i) => {
      const { title, content, images } = this.extractItemContent(item);
      return this.generateHtmlItem(i + 1, title, content, images);
    }).join('');

    const industryHtml = data.sections['行业展望与社会影响'].map((item, i) => {
      const { title, content, images } = this.extractItemContent(item);
      return this.generateHtmlItem(i + 1, title, content, images);
    }).join('');

    const opensourceHtml = data.sections['开源TOP项目'].map((item, i) => {
      const { title, content, images } = this.extractItemContent(item);
      return this.generateHtmlItem(i + 1, title, content, images);
    }).join('');

    const socialHtml = data.sections['社媒分享'].map((item, i) => {
      const { title, content, images } = this.extractItemContent(item);
      return this.generateHtmlItem(i + 1, title, content, images);
    }).join('');

    const linksHtml = data.allLinks.map(link => this.generateLinkHtml(link.title, link.url)).join('');

    const voiceSectionHtml = showVoiceSection ? `
      <!-- AI资讯日报多渠道版 -->
      <section style="margin-bottom: 35px;">
        <h2 style="font-size: 18px; font-weight: 900; color: #000; margin-bottom: 15px; display: flex; align-items: center; border-left: 6px solid #fcee0a; padding-left: 12px; height: 20px; line-height: 20px;">
          OTHERS VERSION // AI资讯日报多渠道版
        </h2>

        <!-- 语音版卡片容器 -->
        <div style="width: 100%;">

          <!-- 小宇宙卡片 -->
          <div style="width: 100%; background: #f2f2f2; border: 2px solid #000; padding: 20px; position: relative; margin-bottom: 20px; box-sizing: border-box;">
            <div style="position: absolute; top: -5px; left: -5px; width: 10px; height: 10px; background: #fcee0a;"></div>
            <div style="position: absolute; bottom: -5px; right: -5px; width: 10px; height: 10px; background: #fcee0a;"></div>

            <p style="margin: 0 0 10px 0; font-size: 16px; font-weight: bold; color: #000;">
              🎙️ 小宇宙
            </p>
            <p style="margin: 0 0 15px 0; font-size: 14px; color: #666;">
              来生小酒馆
            </p>
            <small style="display: inline-block; background: #000; color: #fcee0a; padding: 8px 16px; text-decoration: none; font-weight: bold; font-size: 12px; font-family: monospace;">
              >> 立即收听
            </small>
            <div style="margin-top: 15px; text-align: center;">
              <img src="https://source.hubtoday.app/logo/f959f7984e9163fc50d3941d79a7f262.md.png" style="width: 100%; max-width: 120px; border: 1px solid #000;">
            </div>
          </div>

          <br/>
          <!-- 抖音卡片 -->
          <div style="width: 100%; background: #f2f2f2; border: 2px solid #000; padding: 20px; position: relative; box-sizing: border-box;">
            <div style="position: absolute; top: -5px; right: -5px; width: 10px; height: 10px; background: #00e5ff;"></div>
            <div style="position: absolute; bottom: -5px; left: -5px; width: 10px; height: 10px; background: #00e5ff;"></div>

            <p style="margin: 0 0 10px 0; font-size: 16px; font-weight: bold; color: #000;">
              📹 抖音
            </p>
            <p style="margin: 0 0 15px 0; font-size: 14px; color: #666;">
              自媒体账号
            </p>
            <small style="display: inline-block; background: #000; color: #00e5ff; padding: 8px 16px; text-decoration: none; font-weight: bold; font-size: 12px; font-family: monospace;">
              >> 立即观看
            </small>
            <div style="margin-top: 15px; text-align: center;">
              <img src="https://source.hubtoday.app/logo/7fc30805eeb831e1e2baa3a240683ca3.md.png" style="width: 100%; max-width: 120px; border: 1px solid #000;">
            </div>
          </div>

          <br/>
          <br/>
          <!-- 网页版卡片 -->
          <div style="width: 100%; background: #f2f2f2; border: 2px solid #000; padding: 20px; position: relative; box-sizing: border-box;">
            <div style="position: absolute; top: -5px; right: -5px; width: 10px; height: 10px; background: #00e5ff;"></div>
            <div style="position: absolute; bottom: -5px; left: -5px; width: 10px; height: 10px; background: #00e5ff;"></div>
            <small style="display: inline-block; background: #000; color: #00e5ff; padding: 8px 16px; text-decoration: none; font-weight: bold; font-size: 12px; font-family: monospace;">
              >> 浏览网页版日报
            </small>
            <div style="margin-top: 15px; text-align: center;">
              <img src="https://source.hubtoday.app/logo/ai.hubtoday.app.png" style="width: 100%; max-width: 120px; border: 1px solid #000;">
            </div>
          </div>

        </div>
      </section>
    ` : '';

    return `<section style="box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f2f2f2; padding: 15px;">

  <!-- 外部容器:模拟战术面板 -->
  <section style="background-color: #fff; border: 2px solid #000; box-shadow: 6px 6px 0px #00e5ff; position: relative; margin-bottom: 20px;">

    <!-- 顶部 Header:赛博黄 + 故障风 -->
    <section style="background-color: #fcee0a; border-bottom: 2px solid #000; padding: 30px 20px 40px 20px; position: relative; overflow: hidden; clip-path: polygon(0 0, 100% 0, 100% 85%, 90% 100%, 0 100%);">

      <!-- 背景装饰:条形码纹理 -->
      <div style="position: absolute; top: 10px; right: -20px; width: 100px; height: 40px; transform: rotate(90deg); opacity: 0.1; background: repeating-linear-gradient(90deg, #000, #000 2px, transparent 2px, transparent 4px);"></div>

      <!-- 小标 -->
      <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 10px;">
        <span style="font-family: monospace; font-weight: bold; font-size: 12px; color: #000; background: #00e5ff; padding: 2px 6px;">AI_INSIGHT_DAILY</span>
      </div>

      <!-- 主标题:带错位阴影 -->
      <h1 style="margin: 0; font-size: 28px; font-weight: 900; line-height: 1.1; color: #000; text-transform: uppercase; letter-spacing: -1px; text-shadow: 2px 2px 0px #fff;">
        AI资讯日报<br>
        <span style="background: #000; color: #fcee0a; padding: 0 4px;">${data.date}</span>
      </h1>

      <!-- 装饰线 -->
      <div style="height: 4px; background: #000; width: 60px; margin-top: 15px;"></div>
    </section>

    <!-- 正文内容区域 -->
    <section style="padding: 30px 20px 40px 20px; color: #000;">

      <!-- 今日摘要 -->
      <section style="margin-bottom: 35px;">
        <h2 style="font-size: 18px; font-weight: 900; color: #000; margin-bottom: 15px; display: flex; align-items: center; border-left: 6px solid #fcee0a; padding-left: 12px; height: 20px; line-height: 20px;">
          TODAY'S SUMMARY // 今日摘要
        </h2>
        <div style="background: #f2f2f2; border: 1px solid #000; padding: 15px; font-family: monospace; font-size: 13px; line-height: 1.8;">
          ${summaryHtml}
        </div>
      </section>

      <!-- 产品与功能更新 -->
      <section style="margin-bottom: 35px;">
        <h2 style="font-size: 18px; font-weight: 900; color: #000; margin-bottom: 15px; display: flex; align-items: center; border-left: 6px solid #00e5ff; padding-left: 12px; height: 20px; line-height: 20px;">
          PRODUCT UPDATES // 产品与功能更新
        </h2>
${productHtml}
      </section>

      <!-- 前沿研究 -->
      <section style="margin-bottom: 35px;">
        <h2 style="font-size: 18px; font-weight: 900; color: #000; margin-bottom: 15px; display: flex; align-items: center; border-left: 6px solid #ff003c; padding-left: 12px; height: 20px; line-height: 20px;">
          RESEARCH // 前沿研究
        </h2>

${researchHtml}
      </section>

      <!-- 行业展望与社会影响 -->
      <section style="margin-bottom: 35px;">
        <h2 style="font-size: 18px; font-weight: 900; color: #000; margin-bottom: 15px; display: flex; align-items: center; border-left: 6px solid #fcee0a; padding-left: 12px; height: 20px; line-height: 20px;">
          INDUSTRY IMPACT // 行业展望与社会影响
        </h2>

${industryHtml}
      </section>

      <!-- 开源TOP项目 -->
      <section style="margin-bottom: 35px;">
        <h2 style="font-size: 18px; font-weight: 900; color: #000; margin-bottom: 15px; display: flex; align-items: center; border-left: 6px solid #00e5ff; padding-left: 12px; height: 20px; line-height: 20px;">
          OPEN SOURCE // 开源TOP项目
        </h2>

${opensourceHtml}
      </section>

      <!-- 社媒分享 -->
      <section style="margin-bottom: 35px;">
        <h2 style="font-size: 18px; font-weight: 900; color: #000; margin-bottom: 15px; display: flex; align-items: center; border-left: 6px solid #ff003c; padding-left: 12px; height: 20px; line-height: 20px;">
          SOCIAL MEDIA // 社媒分享
        </h2>

${socialHtml}
      </section>

${voiceSectionHtml}

    </section>

    <!-- 底部:引用链接区域 (模拟数据芯片) -->
    <section style="background-color: #1a1a1a; margin: 0; padding: 25px 20px; position: relative; border-top: 4px solid #ff003c;">

      <!-- 芯片顶部装饰 -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #333; padding-bottom: 10px;">
        <span style="color: #fcee0a; font-family: monospace; font-size: 14px; font-weight: bold;">
          [ DATA SHARD DETECTED ]
        </span>
        <!-- 动态模拟的小点 -->
        <div style="display: flex; gap: 2px;">
          <span style="width: 4px; height: 4px; background: #ff003c;"></span>
          <span style="width: 4px; height: 4px; background: #ff003c;"></span>
          <span style="width: 4px; height: 4px; background: #555;"></span>
        </div>
      </div>

      <!-- 引用链接列表 -->
      <div style="display: flex; flex-direction: column; gap: 15px;">

${linksHtml}
      </div>

      <!-- 底部版权 -->
      <div style="margin-top: 25px; border-top: 1px dashed #333; padding-top: 10px; display: flex; justify-content: space-between;">
        <span style="color: #555; font-size: 10px; font-family: monospace;">AI INSIGHT DAILY</span>
        <span style="color: #555; font-size: 10px; font-family: monospace;">${data.date.replace(/\//g, '.')}</span>
      </div>

    </section>

  </section>

  <!-- 最底部:尾部签名 -->
  <div style="text-align: right; padding-right: 10px;">
     <span style="background: #000; color: #fff; padding: 2px 8px; font-size: 10px; font-family: sans-serif; font-weight: bold;">NEVER FADE AWAY</span>
  </div>

</section>`;
  }
}
