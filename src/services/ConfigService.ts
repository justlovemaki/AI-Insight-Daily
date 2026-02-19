import { LocalStore } from './LocalStore.js';
import { defaultSettings } from '../config.js';
import { SystemSettings } from '../types/config.js';

export class ConfigService {
  private static instance: ConfigService;
  private settings: SystemSettings;
  private store: LocalStore;

  private constructor(store: LocalStore) {
    this.store = store;
    this.settings = { ...defaultSettings } as SystemSettings;
  }

  public static async getInstance(store: LocalStore): Promise<ConfigService> {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService(store);
    } else {
      // 确保单例持有当前 store 引用（同进程通常一致，这里做防御性处理）
      ConfigService.instance.store = store;
    }

    // 每次获取实例时都从持久化层重新加载，避免热重载后读取到旧缓存
    await ConfigService.instance.load();
    return ConfigService.instance;
  }

  /**
   * 加载配置：合并 默认配置 -> 环境变量 -> 数据库持久化配置
   */
  public async load(): Promise<SystemSettings> {
    const storedSettings = await this.store.get('system_settings');
    
    // 基础合并
    this.settings = {
      ...defaultSettings,
      ...(storedSettings || {})
    } as SystemSettings;

    // 迁移逻辑：将旧的 storage ID 'github' 更新为 'github-storage'
    let needsSave = false;
    if (this.settings.STORAGES && Array.isArray(this.settings.STORAGES)) {
      for (const storage of this.settings.STORAGES) {
        if (storage.id === 'github') {
          storage.id = 'github-storage';
          needsSave = true;
        }
      }
    }
    
    // 迁移 CLOSED_PLUGINS 中的 storage ID
    if (this.settings.CLOSED_PLUGINS && Array.isArray(this.settings.CLOSED_PLUGINS)) {
      const index = this.settings.CLOSED_PLUGINS.indexOf('github');
      if (index !== -1) {
        // 检查是否有 'github' publisher，如果没有则说明这是 storage
        const hasGithubPublisher = this.settings.PUBLISHERS?.some((p: any) => p.id === 'github');
        if (!hasGithubPublisher) {
          this.settings.CLOSED_PLUGINS[index] = 'github-storage';
          needsSave = true;
        }
      }
    }

    if (needsSave) {
      await this.save();
      console.log('Migrated storage ID from "github" to "github-storage"');
    }

    return this.settings;
  }

  public getSettings(): SystemSettings {
    return this.settings;
  }

  public async updateSettings(newSettings: Partial<SystemSettings>): Promise<void> {
    this.settings = { ...this.settings, ...newSettings };
    await this.save();
  }

  private async save(): Promise<void> {
    await this.store.put('system_settings', this.settings);
  }
}
