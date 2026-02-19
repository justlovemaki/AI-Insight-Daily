import RSS from 'rss';
import type { UnifiedData } from '../types/index.js';

export class RSSService {
  generateFeed(items: UnifiedData[], options: any) {
    const feed = new RSS(options);

    items.forEach(item => {
      feed.item({
        title: item.title,
        description: item.description,
        url: item.url,
        date: item.published_date,
        author: item.author
      });
    });

    return feed.xml({ indent: true });
  }
}
