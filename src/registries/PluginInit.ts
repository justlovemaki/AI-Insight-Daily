import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { AdapterRegistry } from './AdapterRegistry.js';
import { PublisherRegistry } from './PublisherRegistry.js';
import { StorageRegistry } from './StorageRegistry.js';
import { LogService } from '../services/LogService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 递归扫描目录并自动注册插件
 */
async function scanAndRegister(
  dir: string, 
  registry: any, 
  type: 'adapter' | 'publisher' | 'storage'
) {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir, { recursive: true }) as string[];
  
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) continue;
    if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;
    if (file.endsWith('.d.ts')) continue;
    if (file.includes('base') || file.includes('Base')) continue;

    try {
      // 转换为文件 URL 以支持 Windows
      const fileUrl = pathToFileURL(fullPath).href;
      const module = await import(fileUrl);
      
      // 遍历模块导出，寻找带有 metadata 静态属性的类
      for (const exportKey of Object.keys(module)) {
        const ExportedClass = module[exportKey];
        if (typeof ExportedClass === 'function' && ExportedClass.metadata) {
          const metadata = ExportedClass.metadata;
          
          if (type === 'adapter') {
            registry.register(metadata.type, ExportedClass, metadata);
          } else {
            registry.register(metadata.id, ExportedClass, metadata);
          }
          LogService.info(`Auto-registered ${type}: ${metadata.name || metadata.id || metadata.type}`);
        }
      }
    } catch (error: any) {
      LogService.error(`Failed to auto-register plugin from ${file}: ${error.message}`);
    }
  }
}

export async function initRegistries() {
  const adapterRegistry = AdapterRegistry.getInstance();
  const publisherRegistry = PublisherRegistry.getInstance();
  const storageRegistry = StorageRegistry.getInstance();

  const pluginsDir = path.resolve(__dirname, '../plugins');

  // 1. 扫描适配器
  await scanAndRegister(
    path.join(pluginsDir, 'adapters'), 
    adapterRegistry, 
    'adapter'
  );

  // 2. 扫描发布器
  await scanAndRegister(
    path.join(pluginsDir, 'publishers'), 
    publisherRegistry, 
    'publisher'
  );

  // 3. 扫描存储提供商
  await scanAndRegister(
    path.join(pluginsDir, 'storages'), 
    storageRegistry, 
    'storage'
  );
}
