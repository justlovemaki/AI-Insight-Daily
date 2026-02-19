import type { UnifiedData } from '../../../types/index.js';
import type { ConfigField } from '../../../types/plugin.js';

export abstract class BaseAdapter {
  abstract readonly name: string;
  abstract readonly category: string;
  readonly description?: string;
  readonly icon?: string;
  configFields: ConfigField[] = [];
  apiUrl?: string;
  dispatcher?: any;

  abstract fetch(config: any): Promise<any>;
  abstract transform(rawData: any, config?: any): UnifiedData[];

  async fetchAndTransform(config: any): Promise<UnifiedData[]> {
    try {
      const rawData = await this.fetch(config);
      return this.transform(rawData, config);
    } catch (error: any) {
      console.error(`[Adapter: ${this.name}] Fetch error: ${error.message}`, error);
      return [];
    }
  }
}
