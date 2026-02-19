import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import { typeid } from 'typeid-js';
import mime from 'mime-types';
import crypto from 'node:crypto';
import { LogService } from './LogService.js';
import { IStorageProvider } from '../types/plugin.js';

const DELETE_SENTINEL = "__DELETE_THIS_ASSET__";

const DOMAIN_PREFIX_MAP: Record<string, string> = {
    "tvax1.sinaimg.cn": "https://webp.follow.is/?url=",
    "tvax2.sinaimg.cn": "https://webp.follow.is/?url=",
};

const VIDEO_DOMAINS_TO_DELETE = [
    "upload.chinaz.com",
    "videocdnv2.ruguoapp.com"
];

export class ImageService {
  private async processAndConvertAsset(localFilePath: string, mediaType: 'image' | 'video', tempDir: string, processConfig: any): Promise<string> {
    if (mediaType === 'image' && processConfig.CONVERT_IMAGES) {
        LogService.info("  [转换] 准备转换图片为 AVIF...");
        try {
            const metadata = await sharp(localFilePath).metadata();
            
            if (metadata.pages && metadata.pages > 1) {
                LogService.info("  [信息] 检测到动态图片 (GIF)，将跳过转换并直接上传原图。");
                return localFilePath;
            }

            const baseName = path.basename(localFilePath, path.extname(localFilePath));
            const outputFilename = `${baseName}-conv.avif`;
            const outputPath = path.join(tempDir, outputFilename);

            await sharp(localFilePath)
                .toFormat('avif', { quality: processConfig.AVIF_QUALITY, effort: processConfig.AVIF_EFFORT })
                .toFile(outputPath);

            const originalSize = (await fs.stat(localFilePath)).size / 1024;
            const newSize = (await fs.stat(outputPath)).size / 1024;
            LogService.info(`  [成功] 图片已转换为AVIF (质量: ${processConfig.AVIF_QUALITY}). 大小: ${originalSize.toFixed(1)} KB -> ${newSize.toFixed(1)} KB`);
            return outputPath;
        } catch (e) {
            LogService.warn(`  [警告] 图片转换为AVIF失败: ${e}. 将使用原图。`);
            return localFilePath;
        }
    } else if (mediaType === 'video' && processConfig.CONVERT_VIDEOS) {
        LogService.info("  [转换] 准备使用 FFmpeg 转换视频...");
        const baseName = path.basename(localFilePath, path.extname(localFilePath));
        const outputFilename = `${baseName}-conv.mp4`;
        const outputPath = path.join(tempDir, outputFilename);

        return new Promise((resolve) => {
            try {
                ffmpeg(localFilePath)
                    .outputOptions([
                        '-c:v libx264',
                        `-preset ${processConfig.VIDEO_PRESET}`,
                        `-crf ${processConfig.VIDEO_CRF}`,
                        '-c:a aac',
                        '-b:a 128k',
                        '-movflags +faststart',
                        '-y'
                    ])
                    .on('end', async () => {
                        try {
                            const originalSize = (await fs.stat(localFilePath)).size / (1024 * 1024);
                            const newSize = (await fs.stat(outputPath)).size / (1024 * 1024);
                            LogService.info(`  [成功] 视频已转换为MP4 (CRF: ${processConfig.VIDEO_CRF}). 大小: ${originalSize.toFixed(2)} MB -> ${newSize.toFixed(2)} MB`);
                            resolve(outputPath);
                        } catch (e) {
                            resolve(outputPath);
                        }
                    })
                    .on('error', (err: any) => {
                        LogService.error(`  [错误] FFmpeg 转换失败: ${err.message}`);
                        resolve(localFilePath);
                    })
                    .save(outputPath);
            } catch (err: any) {
                LogService.error(`  [错误] FFmpeg 启动失败: ${err.message}`);
                resolve(localFilePath);
            }
        });
    }

    return localFilePath;
  }

  private async downloadFileTemporarily(url: string, tempDir: string, isVideo: boolean, processConfig: any): Promise<string | null> {
    LogService.info(`  [下载] 准备下载: ${url.substring(0, 80)}...`);
    
    if (isVideo) {
        try {
            const headResponse = await axios({
                method: 'head',
                url: url,
                timeout: 5000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            const contentLength = headResponse.headers['content-length'];
            if (contentLength && parseInt(contentLength) > processConfig.MAX_VIDEO_SIZE_MB * 1024 * 1024) {
                LogService.warn(`  [跳过] 视频文件过大 (${(parseInt(contentLength) / (1024 * 1024)).toFixed(2)} MB > ${processConfig.MAX_VIDEO_SIZE_MB} MB)。`);
                return null;
            }
        } catch (e: any) {
            if (e.response && (e.response.status === 404 || e.response.status === 403 || e.response.status === 410)) {
                LogService.warn(`  [${e.response.status}] (HEAD) 资源确认不可访问，将标记删除。`);
                return DELETE_SENTINEL;
            }
        }
    }

    try {
        const response = await axios({
            method: 'get',
            url: url,
            responseType: 'arraybuffer',
            timeout: 20000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        if (isVideo) {
            const contentLength = response.headers['content-length'];
            if (contentLength && parseInt(contentLength) > processConfig.MAX_VIDEO_SIZE_MB * 1024 * 1024) {
                LogService.warn(`  [跳过] 视频文件过大 (${(parseInt(contentLength) / (1024 * 1024)).toFixed(2)} MB > ${processConfig.MAX_VIDEO_SIZE_MB} MB)。`);
                return null;
            }
        }

        const contentType = response.headers['content-type'] || 'application/octet-stream';
        const hash = crypto.createHash('md5').update(url).digest('hex');
        
        let extension = mime.extension(contentType) || '';
        if (!extension && url.includes('.')) {
            try {
                const urlExt = path.extname(new URL(url).pathname);
                if (urlExt) extension = urlExt.substring(1);
            } catch (e) {}
        }
        if (!extension) extension = 'dat';
        if (!extension.startsWith('.')) extension = `.${extension}`;
        
        if (url.endsWith('.gifv')) extension = '.mp4';

        const filename = `${hash}${extension}`;
        const tempFilePath = path.join(tempDir, filename);
        await fs.writeFile(tempFilePath, Buffer.from(response.data));
        LogService.info(`  [成功] 文件已下载到: ${path.basename(tempFilePath)}`);
        return tempFilePath;
    } catch (e: any) {
        if (e.response && (e.response.status === 404 || e.response.status === 403 || e.response.status === 410)) {
            LogService.warn(`  [${e.response.status} ${e.response.status === 404 ? 'Not Found' : 'Forbidden'}] 资源不可访问，将从文件中删除。`);
            return DELETE_SENTINEL;
        }
        if (e.code === 'ECONNRESET' || e.message?.includes('ECONNRESET')) {
            LogService.warn(`  [连接重置] 资源连接失败，将从文件中删除。`);
            return DELETE_SENTINEL;
        }
        LogService.error(`  [错误] 下载失败: ${e.message}`);
        return null;
    }
  }

  private cleanExcessiveBrTags(content: string): string {
    const lines = content.split('\n');
    const result: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      
      if (/^(<br\s*\/?>[\s]*)+$/i.test(trimmedLine)) {
        const prevLine = i > 0 ? lines[i - 1] : '';
        const nextLine = i < lines.length - 1 ? lines[i + 1] : '';
        
        const hasMediaInPrev = /<img[^>]*>|<video[^>]*>/i.test(prevLine);
        const hasMediaInNext = /<img[^>]*>|<video[^>]*>/i.test(nextLine);
        
        if (!hasMediaInPrev && !hasMediaInNext) {
          continue;
        }
      }
      result.push(line);
    }
    return result.join('\n');
  }

  public async processMarkdown(content: string, settings: any, filePath?: string, storageProvider?: IStorageProvider): Promise<string> {
    if (!content) return "";
    if (!storageProvider) {
      LogService.warn("No storage provider configured for ImageService. Skipping upload.");
      return content;
    }
    
    const processConfig = settings.IMAGE_PROCESS_CONFIG;
    let workingDir = process.cwd();
    if (filePath) {
      workingDir = path.dirname(filePath);
    }
    
    let tempDir: string | null = null;
    try {
        tempDir = await fs.mkdtemp(path.join(workingDir, 'tmp-assets-'));
        LogService.info(`创建临时目录: ${tempDir}`);

        const urlDiscoveryPattern = /\]\((https?:\/\/[^\s\)]+)\)|src="(https?:\/\/[^"]+)"/g;
        const urlsToPrefix = new Set<string>();
        let match;
        while ((match = urlDiscoveryPattern.exec(content)) !== null) {
            const url = match[1] || match[2];
            if (url) urlsToPrefix.add(url);
        }

        for (const url of urlsToPrefix) {
            try {
                const domain = new URL(url).hostname;
                if (DOMAIN_PREFIX_MAP[domain]) {
                    const prefix = DOMAIN_PREFIX_MAP[domain];
                    const newUrl = `${prefix}${url}`;
                    content = content.split(url).join(newUrl);
                }
            } catch (e) {}
        }

        const p1 = /(\[!\[.*?\]\()(https?:\/\/[^\s\)]+)(\)\]\()(https?:\/\/[^\s\)]+)(\))/g;
        const p2 = /(!\[(?!\[).*?\]\()(https?:\/\/[^\s\)]+)(\))/g;
        const p3 = /(<img.*?src=")(https?:\/\/[^"]+)(".*?>)/g;
        const p4 = /(<video[^>]*?src=")(https?:\/\/[^"]+)(".*?>([\s\S]*?<\/video>)?)/gi;
        const p5 = /(<source[^>]*?src=")(https?:\/\/[^"]+)(".*?>)/gi;

        const urlMap: Record<string, string> = {};
        const urlsToProcess: Record<string, 'image' | 'video'> = {};

        const addUrl = (url: string, type: 'image' | 'video') => {
            if (url && !urlsToProcess[url]) urlsToProcess[url] = type;
        };

        let m;
        while ((m = p1.exec(content)) !== null) addUrl(m[2], 'image');
        p1.lastIndex = 0;
        while ((m = p2.exec(content)) !== null) addUrl(m[2], 'image');
        p2.lastIndex = 0;
        while ((m = p3.exec(content)) !== null) addUrl(m[2], 'image');
        p3.lastIndex = 0;
        while ((m = p4.exec(content)) !== null) addUrl(m[2], 'video');
        p4.lastIndex = 0;
        while ((m = p5.exec(content)) !== null) addUrl(m[2], 'video');
        p5.lastIndex = 0;

        if (Object.keys(urlsToProcess).length === 0) {
            LogService.info("没有发现需要处理的媒体链接。");
            return content;
        }

        const ignoredDomains = [
            "s1.imagehub.cc",
            "source.hubtoday.app",
            "cdnv2.ruguoapp.com"
        ].filter(Boolean);

        for (const [url, mediaType] of Object.entries(urlsToProcess)) {
            try {
                const domain = new URL(url).hostname;
                if (mediaType === 'video' && VIDEO_DOMAINS_TO_DELETE.includes(domain)) {
                    urlMap[url] = DELETE_SENTINEL;
                    continue;
                }
                
                if (ignoredDomains.includes(domain)) {
                    continue;
                }

                const downloadResult = await this.downloadFileTemporarily(url, tempDir, mediaType === 'video', processConfig);
                if (downloadResult === DELETE_SENTINEL) {
                    urlMap[url] = DELETE_SENTINEL;
                } else if (downloadResult) {
                    const processedFilePath = await this.processAndConvertAsset(downloadResult, mediaType, tempDir, processConfig);
                    const extension = path.extname(processedFilePath);
                    const newFilename = `${typeid(processConfig.TYPEID_PREFIX).toString()}${extension}`;
                    
                    const newCdnUrl = await storageProvider.upload(processedFilePath, newFilename);
                    if (newCdnUrl) urlMap[url] = newCdnUrl;
                }
            } catch (e: any) {
                LogService.warn(`  [警告] 处理 URL 失败 (${url}): ${e.message}`);
            }
        }

        let newContent = content;
        const tagsToReplace: { start: number, end: number, oldTag: string, newTag: string }[] = [];

        const patterns = [
            { regex: p1, type: 'p1' },
            { regex: p2, type: 'p2' },
            { regex: p3, type: 'p3' },
            { regex: p4, type: 'p4' },
            { regex: p5, type: 'p5' }
        ];

        for (const { regex, type } of patterns) {
            let match;
            regex.lastIndex = 0;
            while ((match = regex.exec(content)) !== null) {
                const fullTag = match[0];
                let newTag = fullTag;
                let shouldReplace = false;

                if (type === 'p1') {
                    const imgUrl = match[2];
                    const linkUrl = match[4];
                    const newImgUrl = urlMap[imgUrl];
                    if (newImgUrl === DELETE_SENTINEL) {
                        newTag = "";
                        shouldReplace = true;
                    } else if (newImgUrl) {
                        newTag = fullTag.split(imgUrl).join(newImgUrl).split(linkUrl).join(newImgUrl);
                        shouldReplace = true;
                    }
                } else {
                    const url = match[2];
                    const newUrl = urlMap[url];
                    if (newUrl === DELETE_SENTINEL) {
                        newTag = "";
                        shouldReplace = true;
                    } else if (newUrl) {
                        newTag = fullTag.split(url).join(newUrl);
                        shouldReplace = true;
                    }
                }

                if (shouldReplace) {
                    tagsToReplace.push({
                        start: match.index,
                        end: match.index + fullTag.length,
                        oldTag: fullTag,
                        newTag: newTag
                    });
                }
            }
        }

        const sortedTags = tagsToReplace.sort((a, b) => b.start - a.start || b.end - a.end);
        const uniqueTags: typeof tagsToReplace = [];
        let lastStart = Infinity;

        for (const tag of sortedTags) {
            if (tag.end <= lastStart) {
                uniqueTags.push(tag);
                lastStart = tag.start;
            } else {
                LogService.info(`  [信息] 忽略重叠标签: ${tag.oldTag}`);
            }
        }

        for (const tag of uniqueTags) {
            let start = tag.start;
            let end = tag.end;
            if (tag.newTag === "") {
                // 向后查找并删除紧邻的 <br> 标签
                const afterContent = newContent.substring(end);
                const brAfterMatch = afterContent.match(/^(\s*<br\s*\/?>)+/i);
                if (brAfterMatch) {
                    end += brAfterMatch[0].length;
                }
                
                // 向前查找并删除紧邻的 <br> 标签
                const beforeContent = newContent.substring(0, start);
                const brBeforeMatch = beforeContent.match(/(<br\s*\/?>)+\s*$/i);
                if (brBeforeMatch) {
                    start -= brBeforeMatch[0].length;
                }
                
                // 处理换行符
                if (end < newContent.length && newContent[end] === '\n') {
                    end++;
                }
                while (start > 0 && (newContent[start - 1] === ' ' || newContent[start - 1] === '\t')) {
                    start--;
                }
            }
            newContent = newContent.substring(0, start) + tag.newTag + newContent.substring(end);
        }

        newContent = this.cleanExcessiveBrTags(newContent);

        if (filePath && await fs.pathExists(filePath)) {
          await fs.writeFile(filePath, newContent, 'utf-8');
          LogService.info(`文件 '${filePath}' 已成功更新！`);
        }

        return newContent;

    } catch (error: any) {
        LogService.error(`处理 Markdown 媒体失败: ${error.message}`);
        return content;
    } finally {
        if (tempDir) {
            try {
                await fs.remove(tempDir);
            } catch (e) {}
        }
    }
  }
}
