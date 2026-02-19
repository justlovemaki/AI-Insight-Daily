import { request } from './api';

export const getContent = (date?: string) => request(`/api/content${date ? `?date=${date}` : ''}`);

export const publishContent = (id: string, data: { content: string, [key: string]: any }) =>
  request(`/api/publish/${id}`, { method: 'POST', body: JSON.stringify(data) });

export const generateCoverImage = (prompt: string, agentId?: string) =>
  request('/api/ai/generate-image', { method: 'POST', body: JSON.stringify({ prompt, agentId }) });

export const uploadWechatMaterial = (url: string) =>
  request('/api/wechat/upload-material', { method: 'POST', body: JSON.stringify({ url }) });

export const writeData = (date: string) => 
  request('/writeData', { method: 'POST', body: JSON.stringify({ date }) });
