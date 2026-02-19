import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getSettings, saveSettings, getPluginMetadata } from '../services/settingsService';

const PluginManagement: React.FC = () => {
  const [settings, setSettings] = useState<any>({});
  const [metadata, setMetadata] = useState<{ adapters: any[], publishers: any[], storages: any[] }>({
    adapters: [],
    publishers: [],
    storages: []
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [settingsData, metadataData] = await Promise.all([
        getSettings(),
        getPluginMetadata()
      ]);
      setSettings(settingsData || {});

      setMetadata({
        adapters: metadataData?.adapters || [],
        publishers: metadataData?.publishers || [],
        storages: metadataData?.storages || []
      });
    } catch (error) {
      console.error('Failed to load plugin data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const isClosed = (id: string) => {
    return (settings.CLOSED_PLUGINS || []).includes(id);
  };

  const togglePlugin = async (id: string) => {
    const closedPlugins = [...(settings.CLOSED_PLUGINS || [])];
    const index = closedPlugins.indexOf(id);
    
    if (index > -1) {
      closedPlugins.splice(index, 1);
    } else {
      closedPlugins.push(id);
    }

    const updatedSettings = { ...settings, CLOSED_PLUGINS: closedPlugins };
    setSettings(updatedSettings);

    try {
      setIsSaving(true);
      await saveSettings(updatedSettings);
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert('保存失败');
      // Rollback
      loadData();
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const renderPluginCard = (plugin: any, type: 'adapter' | 'publisher' | 'storage' | 'aiProvider') => {
    const id = type === 'adapter' ? plugin.type : plugin.id;
    const enabled = !isClosed(id);
    
    return (
      <motion.div 
        key={id} 
        layout
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className={`bg-white dark:bg-surface-dark rounded-3xl border transition-all duration-300 p-6 flex flex-col justify-between ${
          enabled 
            ? 'border-slate-200 dark:border-white/5 shadow-sm' 
            : 'border-slate-100 dark:border-white/[0.02] opacity-60 bg-slate-50/50 dark:bg-black/10'
        }`}
      >
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
              enabled ? 'bg-primary/10 text-primary' : 'bg-slate-100 dark:bg-white/5 text-slate-400'
            }`}>
              <span className="material-symbols-outlined text-2xl">
                {plugin.icon || (type === 'adapter' ? 'extension' : type === 'publisher' ? 'send' : type === 'storage' ? 'cloud_upload' : 'psychology')}
              </span>
            </div>
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white">{plugin.name}</h4>
              <p className="text-[10px] font-mono text-slate-400 uppercase tracking-tight">{id}</p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input 
              type="checkbox" 
              className="sr-only peer"
              checked={enabled}
              onChange={() => togglePlugin(id)}
              disabled={isSaving}
            />
            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
          </label>
        </div>
        
        <div className="space-y-2">
          <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 min-h-[2.5rem]">
            {plugin.description || (
              type === 'adapter' ? '数据源适配器，负责抓取和转换特定平台的数据。' : 
              type === 'publisher' ? '内容发布器，负责将生成的内容分发到对应平台。' : 
              type === 'storage' ? '存储插件，负责多媒体资源的上传与托管。' :
              'AI 提供商，为系统提供 LLM 推理、翻译和生成能力。'
            )}
          </p>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
              enabled ? 'bg-green-100 dark:bg-green-500/20 text-green-600' : 'bg-slate-100 dark:bg-white/5 text-slate-400'
            }`}>
              {enabled ? '已启用' : '已禁用'}
            </span>
            <span className="text-[9px] text-slate-400 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-full font-bold">
              {type === 'aiProvider' ? 'AI PROVIDER' : type.toUpperCase()}
            </span>
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">插件管理</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">全局管理系统插件的启用状态。禁用的插件将在系统设置中隐藏且不可用。</p>
      </div>

      <div className="space-y-10">
        {/* Adapters Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-3 ml-1">
            <span className="material-symbols-outlined text-primary">extension</span>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white">数据适配器 (Adapters)</h3>
          </div>
          <motion.div 
            layout
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            <AnimatePresence mode="popLayout">
              {metadata.adapters.map(plugin => renderPluginCard(plugin, 'adapter'))}
            </AnimatePresence>
          </motion.div>
        </section>

        {/* Publishers Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-3 ml-1">
            <span className="material-symbols-outlined text-primary">send</span>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white">发布渠道 (Publishers)</h3>
          </div>
          <motion.div 
            layout
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            <AnimatePresence mode="popLayout">
              {metadata.publishers.map(plugin => renderPluginCard(plugin, 'publisher'))}
            </AnimatePresence>
          </motion.div>
        </section>

        {/* Storages Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-3 ml-1">
            <span className="material-symbols-outlined text-primary">cloud_upload</span>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white">存储插件 (Storages)</h3>
          </div>
          <motion.div 
            layout
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            <AnimatePresence mode="popLayout">
              {metadata.storages.map(plugin => renderPluginCard(plugin, 'storage'))}
            </AnimatePresence>
          </motion.div>
        </section>
      </div>
      
      {isSaving && (
        <div className="fixed bottom-8 right-8 bg-primary text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-bounce">
          <span className="material-symbols-outlined animate-spin">sync</span>
          <span className="font-bold text-sm">正在保存配置...</span>
        </div>
      )}
    </div>
  );
};

export default PluginManagement;
