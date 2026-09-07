import { createHash } from 'node:crypto'
import { z } from 'zod'

export const CATEGORY_CATALOG_KEY = '@categories:v1'
const categoryId = z.string().min(1).max(64).regex(/^[^\u0000-\u001f\u007f]+$/u).refine(value => !!value.trim())
const categorySchema = z.object({
  id: categoryId, name: z.string().trim().min(1).max(64).regex(/^[^\u0000-\u001f\u007f]+$/u),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/u), order: z.number().int().min(0).max(9999), archived: z.boolean(),
}).strict()
const catalogSchema = z.object({ kind: z.literal('category-catalog'), version: z.literal(1), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1), categories: z.array(categorySchema).max(1000) }).strict()
export const DEFAULT_CATEGORIES = [
  { id: 'news', name: '新闻资讯', color: '#2563eb' },
  { id: 'githubTrending', name: 'GitHub 热门', color: '#7c3aed' },
  { id: 'paper', name: '学术论文', color: '#0891b2' },
  { id: 'socialMedia', name: '社交媒体', color: '#db2777' },
  { id: 'rss', name: 'RSS 订阅', color: '#ea580c' },
].map((row, order) => ({ ...row, order, archived: false }))

export class CategoryError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'CategoryError'; this.status = status }
}

/** Legacy IDs remain intact; display metadata never changes content or artifact hashes. */
export function readCategoryCatalog(table, referencedIds = []) {
  const raw = table.get(CATEGORY_CATALOG_KEY)
  const parsed = catalogSchema.safeParse(raw ?? { kind: 'category-catalog', version: 1, revision: 0, categories: DEFAULT_CATEGORIES })
  if (!parsed.success) throw new CategoryError('分类存储损坏，请恢复配置备份。', 503)
  const catalog = parsed.data
  const ids = new Set(catalog.categories.map(row => row.id))
  if (ids.size !== catalog.categories.length) throw new CategoryError('分类 ID 重复，请恢复配置备份。', 503)
  for (const id of referencedIds) {
    if (!ids.has(id) && categoryId.safeParse(id).success) {
      catalog.categories.push({ id, name: id, color: '#64748b', order: 9999, archived: false }); ids.add(id)
    }
  }
  if (catalog.categories.length > 1000) throw new CategoryError('分类数量超过 1000 上限。', 503)
  catalog.categories.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  const revision = createHash('sha256').update(JSON.stringify(catalog)).digest('hex')
  return { catalog, revision }
}

export function mutateCategoryCatalog(current, input) {
  if (input.expectedRevision !== current.revision) throw new CategoryError('分类已被其他操作修改，请刷新后重试。', 409)
  const { action, id } = input
  const rows = current.catalog.categories.map(row => ({ ...row }))
  const index = rows.findIndex(row => row.id === id)
  if (action === 'create' || action === 'update') {
    if (action === 'create' && (!/^[a-zA-Z0-9_-]{1,64}$/u.test(id) || index !== -1)) throw new CategoryError('新分类 ID 必须唯一，且仅包含字母、数字、下划线或连字符。')
    if (action === 'update' && index === -1) throw new CategoryError('分类不存在。', 404)
    const parsed = categorySchema.safeParse({ id, name: input.name, color: input.color, order: input.order, archived: index < 0 ? false : rows[index].archived })
    if (!parsed.success) throw new CategoryError('分类名称、颜色或排序无效。')
    if (rows.some(row => row.id !== id && row.name === parsed.data.name)) throw new CategoryError('分类名称已存在。')
    if (index < 0) rows.push(parsed.data)
    else rows[index] = parsed.data
  } else {
    if (index < 0) throw new CategoryError('分类不存在。', 404)
    if (action === 'archive' || action === 'restore') rows[index].archived = action === 'archive'
    else if (action === 'delete') {
      rows.splice(index, 1)
    } else throw new CategoryError('分类操作无效。')
  }
  if (rows.length > 1000) throw new CategoryError('分类数量不能超过 1000。')
  return { ...current.catalog, revision: current.catalog.revision + 1, categories: rows }
}

/** Count records containing an exact category reference, including immutable packed history. */
export function referencedCategories(value, output = new Set()) {
  if (!value || typeof value !== 'object') return output
  for (const [key, child] of Object.entries(value)) {
    if (key === 'category' && typeof child === 'string' && child) output.add(child)
    else if (child && typeof child === 'object') referencedCategories(child, output)
  }
  return output
}
