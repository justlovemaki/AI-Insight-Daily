/**
 * 日期处理工具类，统一处理上海时区时间
 */

/**
 * 获取今日上海日期 (格式: YYYY-MM-DD)
 */
export const getTodayShanghai = (): string => {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Shanghai'
  }).format(new Date());
};

/**
 * 将日期字符串格式化为上海时间 (格式: YYYY-MM-DD HH:mm:ss)
 */
export const formatToShanghai = (dateStr: string | Date): string => {
  if (!dateStr) return '';
  try {
    const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
    if (isNaN(date.getTime())) return String(dateStr);
    
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'Asia/Shanghai'
    }).format(date).replace(/\//g, '-');
  } catch (e) {
    return String(dateStr);
  }
};

/**
 * 将日期转换为上海时区的 Date 对象
 */
export const convertToShanghaiTime = (dateStr: string | Date): Date => {
  const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  const formatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
    timeZone: 'Asia/Shanghai'
  });
  
  const parts = formatter.formatToParts(date);
  const map: Record<string, number> = {};
  parts.forEach(p => {
    if (p.type !== 'literal') map[p.type] = parseInt(p.value);
  });
  
  return new Date(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
};
