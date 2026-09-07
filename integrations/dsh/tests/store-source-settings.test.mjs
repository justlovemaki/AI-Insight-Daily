import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { apply as applyDashboard } from '../lib/ui.js'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { SqliteStorageBackend } from '@deepseek-ai/dsh-storage-sqlite'
import { prismContentDomain } from '../lib/store-content.js'
import { prismContentSelectionDomain } from '../lib/store-content-selection.js'
import { Context, Service } from '@deepseek-ai/cordis'
import { CATEGORY_CATALOG_KEY } from '../lib/category-catalog.js'
import { PrismSourceSettings, assertSafeRssUrl, managedSourceSchema, normalizeManagedSource, prismSourceSettingsDomain } from '../lib/store-source-settings.js'

class Table {
  constructor(entries = []) { this.map = new Map(entries); this.failPut = false; this.failDelete = false; this.putCount = 0; this.failPutAt = undefined }
  get(id) { return this.map.get(id) }
  entries() { return this.map.entries() }
  async put(id, value) { this.putCount += 1; if (this.failPut || this.putCount === this.failPutAt) throw new Error('put failed'); this.map.set(id, structuredClone(value)); return value }
  async delete(id) { if (this.failDelete) throw new Error('delete failed'); return this.map.delete(id) }
}
class Registry {
  constructor() { this.providers = new Map() }
  register(provider) {
    if (this.providers.has(provider.id)) throw new Error(`duplicate ${provider.id}`)
    this.providers.set(provider.id, provider)
    return () => { if (this.providers.get(provider.id) === provider) this.providers.delete(provider.id) }
  }
  list() { return [...this.providers.values()].map(provider => ({ id: provider.id, name: provider.name })) }
  categoryBindings() { return [...this.providers.values()].map(provider => ({ sourceId: provider.id, category: provider.category ?? null })) }
}
function fixture(options = {}) {
  const ctx = new Context()
  const registry = new Registry()
  const credentialCalls = []
  const credentialWrites = []
  const starts = []
  Object.defineProperty(ctx, 'prismSources', { value: registry })
  Object.defineProperty(ctx, 'credentials', { value: {
    async resolve(ref) { credentialCalls.push(ref); return options.resolveCredential ? options.resolveCredential(ref) : { value: 'session=secret' } },
    async describe(ref) { credentialCalls.push(`describe:${ref}`); return options.describeCredential ? options.describeCredential(ref) : { configured: true, source: 'file', writable: true } },
    async set(ref, value) { credentialWrites.push({ operation: 'set', ref, value }); if (options.failCredentialWrite) throw new Error('secret backend') },
    async unset(ref) { credentialWrites.push({ operation: 'unset', ref }); if (options.failCredentialWrite) throw new Error('secret backend') },
  } })
  Object.defineProperty(ctx, 'subagents', { value: { async start(provider, request) { starts.push({ provider, request }); return { result: Promise.resolve({ stopReason: 'completed', structured: { items: [{ title: 'One', url: 'https://example.com', description: 'D', content: 'C' }] }, output: [] }), async dispose() { options.onDispose?.() } } } } })
  const service = new PrismSourceSettings(ctx, { credentialSlots: [{ id: 'follow', name: 'Follow login', usage: 'follow-cookie', credentialRef: 'FOLLOW_SECRET', allowDashboardWrite: true }], bootstrap: [] })
  service.sources = new Table()
  return { service, registry, credentialCalls, credentialWrites, starts }
}
const rss = { type: 'rss', id: 'news', name: 'News', category: 'news', enabled: true, limit: 20, url: 'https://example.com/feed.xml' }

function categoryFixture() {
  const base = fixture()
  const contents = new Map(), requests = new Table(), drafts = new Table(), selections = new Table()
  const services = { prismContentStore: { records: () => [...contents.values()] }, prismProduction: { requests, drafts }, prismContentSelections: { selections } }
  Object.defineProperty(base.service.ctx, 'get', { value: name => services[name] })
  const mutate = (action, id, fields = {}) => base.service.mutateCategory({ action, id, expectedRevision: base.service.categoryCatalog().revision, ...fields })
  return { ...base, contents, requests, drafts, selections, mutate, services }
}

test('category CRUD persists metadata, CAS-conflicts stale editors, and never rewrites source or content hashes', async () => {
  const { service, contents, mutate } = categoryFixture()
  assert.equal(service.categoryCatalog().categories.length, 5)
  await mutate('create', 'robotics', { name: '机器人', color: '#123abc', order: 7 })
  const source = await service.save({ ...rss, category: 'robotics' }, { mode: 'create' })
  contents.set('one', { item: { category: 'robotics', title: 'Original' }, sha256: 'unchanged' })
  const oldContent = structuredClone(contents.get('one'))
  const stale = service.categoryCatalog().revision
  await mutate('update', 'robotics', { name: '具身智能', color: '#abcdef', order: 0 })
  assert.deepEqual(service.sources.get(source.settingsId), source)
  assert.deepEqual(contents.get('one'), oldContent)
  assert.equal(service.categoryCatalog().categories.find(row => row.id === 'robotics').name, '具身智能')
  await assert.rejects(service.mutateCategory({ action: 'archive', id: 'robotics', expectedRevision: stale }), error => error.status === 409)
  const restart = categoryFixture().service
  restart.sources = service.sources
  assert.equal(restart.categoryCatalog().categories.find(row => row.id === 'robotics').name, '具身智能')
  assert.equal(service.list().length, 1, 'reserved catalog is not listed as a source')
  await assert.rejects(service.delete(CATEGORY_CATALOG_KEY), /reserved/)
  await assert.rejects(service.delete('@adapter:rss'), /reserved/)
  assert.ok(service.sources.get(CATEGORY_CATALOG_KEY), 'source deletion cannot bypass catalog reference guards')
})

test('archived categories retain existing bindings and history but reject new bindings; deletion is reference guarded', async () => {
  const { service, contents, requests, selections, mutate } = categoryFixture()
  const source = await service.save(rss, { mode: 'create' })
  await mutate('archive', 'news')
  await assert.rejects(service.save({ ...rss, id: 'other' }, { mode: 'create' }), /未归档/)
  await service.save({ ...rss, name: 'Renamed source' }, { mode: 'update', expectedSettingsId: source.settingsId, expectedUpdatedAt: source.updatedAt })
  await assert.rejects(mutate('delete', 'news'), /引用/)
  await service.delete(source.settingsId)
  contents.set('one', { item: { category: 'news' } })
  await assert.rejects(mutate('delete', 'news'), /引用/)
  contents.clear()
  await requests.put('req', { packedMaterials: [{ category: 'news' }] })
  await assert.rejects(mutate('delete', 'news'), /引用/)
  await requests.delete('req')
  await selections.put('selection', { materials: [{ category: 'news' }] })
  await assert.rejects(mutate('delete', 'news'), /引用/)
  await selections.delete('selection')
  await mutate('restore', 'news')
  assert.equal(service.categoryCatalog().categories.find(row => row.id === 'news').canDelete, true)
  await mutate('delete', 'news')
  assert.equal(service.categoryCatalog().categories.some(row => row.id === 'news'), false, 'defaults never resurrect deleted categories')
})

test('new unused categories can be deleted without archive, but references are rechecked at commit', async () => {
  const { service, contents, mutate } = categoryFixture()
  await mutate('create', 'unused', { name: '新分类', color: '#123456', order: 1 })
  const catalog = service.categoryCatalog()
  const row = catalog.categories.find(row => row.id === 'unused')
  assert.equal(row.archived, false)
  assert.equal(row.canDelete, true)
  assert.equal(row.deleteBlockedReason, '')
  contents.set('race', { item: { category: 'unused' } })
  await assert.rejects(service.mutateCategory({ action: 'delete', id: 'unused', expectedRevision: catalog.revision }), /引用/)
  assert.equal(service.categoryCatalog().categories.find(row => row.id === 'unused').canDelete, false)
  contents.clear()
  await mutate('delete', 'unused')
  assert.equal(service.categoryCatalog().categories.some(row => row.id === 'unused'), false)
  const restarted = categoryFixture().service
  restarted.sources = service.sources
  assert.equal(restarted.categoryCatalog().categories.some(row => row.id === 'unused'), false)
})

test('category catalog adopts legacy custom IDs and fails closed for unavailable history, invalid writes and corruption', async () => {
  const { service, registry, contents, mutate, services } = categoryFixture()
  contents.set('old', { item: { category: '旧分类' } })
  assert.equal(service.categoryCatalog().categories.find(row => row.id === '旧分类').name, '旧分类')
  await mutate('update', '旧分类', { name: '旧分类显示名', color: '#123456', order: 8 })
  const revision = service.categoryCatalog().revision
  for (const fields of [
    { id: 'bad id', name: 'bad', color: '#123456', order: 1 },
    { id: 'good', name: '', color: '#123456', order: 1 },
    { id: 'good', name: '名称', color: 'url(javascript:bad)', order: 1 },
    { id: 'good', name: '名称', color: '#123456', order: -1 },
    { id: 'good', name: '新闻资讯', color: '#123456', order: 1 },
  ]) await assert.rejects(mutate('create', fields.id, fields))
  assert.equal(service.categoryCatalog().revision, revision)
  await mutate('archive', 'rss')
  registry.register({ id: 'rss:static' })
  await assert.rejects(mutate('delete', 'rss'), /未声明/)
  registry.providers.clear(); delete services.prismProduction
  const blocked = service.categoryCatalog().categories.find(row => row.id === 'rss')
  assert.equal(blocked.canDelete, true, 'unloaded services do not disable the delete request')
  assert.equal(blocked.deleteCheckRequired, true)
  assert.equal(blocked.deleteBlockedReason, '')
  await assert.rejects(mutate('delete', 'rss'), /历史/)
  service.sources.failPut = true
  await assert.rejects(mutate('restore', 'rss'), /put failed/)
  assert.equal(service.categoryCatalog().categories.find(row => row.id === 'rss').archived, true)
  service.sources.map.set(CATEGORY_CATALOG_KEY, { corrupt: true })
  assert.throws(() => service.categoryCatalog(), /损坏/)
})

test('category deletion reads real SQLite history with all history services disabled and releases only borrowed domains', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prismflow-category-delete-'))
  const backend = new SqliteStorageBackend({ path: join(root, 'data.sqlite'), journalMode: 'wal' })
  const facility = new DomainFacility({ storage: { backend: { get: () => backend } }, emit() {}, logger: { warn() {} } }, { backend: 'test' })
  const { service, registry } = fixture()
  Object.defineProperty(service.ctx, 'storageDomain', { value: facility })
  Object.defineProperty(service.ctx, 'get', { value: () => undefined })
  const mutate = (action, id, fields = {}) => service.mutateCategory({ action, id, expectedRevision: service.categoryCatalog().revision, ...fields })
  let route
  applyDashboard({ get: name => name === 'prismSourceSettings' ? service : undefined,
    webServer: { register(value) { route = value; return () => {} } }, effect(fn) { fn() }, logger: { warn() {} } })
  const server = createServer((req, res) => void route.handler(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    service.sources = (await facility.open(prismSourceSettingsDomain)).table('sources')
    const created = await fetch(`${origin}/api/prismflow/categories/mutate`, { method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ action: 'create', id: 'unused', name: '未关联', color: '#123456', order: 0, expectedRevision: service.categoryCatalog().revision }),
    })
    assert.equal(created.status, 200)
    await created.json()
    const catalogResponse = await fetch(`${origin}/api/prismflow/categories`)
    const catalog = await catalogResponse.json()
    assert.equal(catalogResponse.status, 200)
    assert.equal(catalog.categories.find(row => row.id === 'unused').canDelete, true)
    const deleted = await fetch(`${origin}/api/prismflow/categories/mutate`, { method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ action: 'delete', id: 'unused', expectedRevision: catalog.revision, confirm: true }),
    })
    assert.equal(deleted.status, 200)
    assert.equal((await deleted.json()).categories.some(row => row.id === 'unused'), false)
    assert.ok(facility.get('prismflow_source_settings'), 'source-settings handle stays open')
    assert.equal(facility.get('prismflow_production'), undefined, 'borrowed empty history is closed')
    assert.equal(service.categoryCatalog().categories.some(row => row.id === 'unused'), false)

    let history = await facility.open(prismContentSelectionDomain)
    await history.table('selections').put('retained', { materials: [{ category: 'news' }] })
    await history.close()
    const original = service.sources.get(CATEGORY_CATALOG_KEY)
    await assert.rejects(mutate('delete', 'news'), /引用/)
    assert.deepEqual(service.sources.get(CATEGORY_CATALOG_KEY), original)
    assert.equal(facility.get('prismflow_content_selection'), undefined, 'rejected checks close borrowed history')
    history = await facility.open(prismContentSelectionDomain)
    assert.equal(history.table('selections').get('retained').materials[0].category, 'news')
    let content = await facility.open(prismContentDomain)
    await content.table('items').put('stored', {
      storeId: 'stored', sourceId: 'rss:old', externalId: 'one', firstSeenAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z', fetchedAt: '2026-01-01T00:00:00.000Z', status: 'unread',
      item: { id: 'one', title: 'Old record', url: '', description: '', published_date: '', source: 'Old', category: 'rss' },
    })
    await content.close()
    await assert.rejects(mutate('delete', 'rss'), /引用/)
    content = await facility.open(prismContentDomain)
    assert.equal(content.table('items').get('stored').item.category, 'rss')
    await mutate('create', 'empty', { name: '空分类', color: '#123456', order: 1 })
    registry.register({ id: 'rss:static', category: 'paper' })
    await mutate('delete', 'empty')
    assert.equal(facility.get('prismflow_content'), content, 'reused content handle is never closed')
    assert.equal(facility.get('prismflow_content_selection'), history, 'reused history handle is never closed')
    assert.equal(service.categoryCatalog().categories.find(row => row.id === 'paper').references.sources, 1)
    await assert.rejects(mutate('delete', 'paper'), /引用/)
  } finally {
    await new Promise(resolve => server.close(resolve))
    await facility.closeAll(); await backend.close(); await rm(root, { recursive: true, force: true })
  }
})

test('cold history read failures never delete categories or leak borrowed handles', async () => {
  const { service } = fixture()
  let closed = 0
  Object.defineProperty(service.ctx, 'storageDomain', { value: {
    async open(spec) {
      if (spec.name === 'prismflow_production') throw new Error('database read failed')
      return { table: () => new Table(), async close() { closed += 1 } }
    },
  } })
  const revision = service.categoryCatalog().revision
  await assert.rejects(service.mutateCategory({ action: 'delete', id: 'news', expectedRevision: revision }), error => error.status === 503)
  assert.equal(closed, 1)
  assert.equal(service.categoryCatalog().revision, revision)
})

test('concurrent category and source writes are serialized against archive and exact CAS', async () => {
  const { service, mutate } = categoryFixture()
  const revision = service.categoryCatalog().revision
  const results = await Promise.allSettled([
    service.mutateCategory({ action: 'archive', id: 'news', expectedRevision: revision }),
    service.save(rss, { mode: 'create' }),
    service.mutateCategory({ action: 'archive', id: 'rss', expectedRevision: revision }),
  ])
  assert.deepEqual(results.map(row => row.status), ['fulfilled', 'rejected', 'rejected'])
  await mutate('restore', 'news')
  await service.save(rss, { mode: 'create' })
})

test('managed source CRUD registers immediately and rolls back registry and persistence failures', async () => {
  const { service, registry } = fixture()
  const created = await service.save(rss, { mode: 'create' })
  assert.equal(created.settingsId, 'rss:news')
  assert.ok(registry.providers.has('rss:news'))

  const disabled = await service.save({ ...rss, enabled: false, name: 'News off' }, { mode: 'update', expectedSettingsId: created.settingsId, expectedUpdatedAt: created.updatedAt })
  assert.equal(registry.providers.has('rss:news'), false)
  assert.equal(service.list()[0].name, 'News off')

  const enabled = await service.save({ ...rss, enabled: true }, { mode: 'update', expectedSettingsId: disabled.settingsId, expectedUpdatedAt: disabled.updatedAt })
  service.sources.failPut = true
  await assert.rejects(service.save({ ...rss, name: 'Replacement' }, { mode: 'update', expectedSettingsId: enabled.settingsId, expectedUpdatedAt: enabled.updatedAt }), /put failed/)
  assert.equal(registry.providers.get('rss:news').name, 'News')
  assert.equal(service.list()[0].name, 'News')
  service.sources.failPut = false

  registry.register({ id: 'rss:static', fetch() {} })
  await assert.rejects(service.save({ ...rss, id: 'static' }, { mode: 'create' }), /duplicate/)
  assert.equal(service.sources.get('rss:static'), undefined)
  assert.equal(registry.providers.get('rss:static').id, 'rss:static')

  service.sources.failDelete = true
  await assert.rejects(service.delete('rss:news'), /delete failed/)
  assert.ok(registry.providers.has('rss:news'))
  service.sources.failDelete = false
  await service.delete('rss:news')
  assert.equal(registry.providers.has('rss:news'), false)
})

test('update and delete abort and drain in-flight managed fetches', async () => {
  const { service } = fixture()
  const record = await service.save(rss, { mode: 'create' })
  let observedAbort = false
  const active = service.trackFetch(record.settingsId, (_request, execution) => new Promise((resolve, reject) => {
    execution.signal.addEventListener('abort', () => { observedAbort = true; reject(execution.signal.reason) }, { once: true })
  }), {}, {})
  const deleting = service.delete(record.settingsId)
  await assert.rejects(active, /configuration changed/)
  await deleting
  assert.equal(observedAbort, true)
})

test('RSS URL validation rejects obvious local and private targets', () => {
  for (const url of [
    'file:///tmp/feed', 'http://user:pass@example.com/feed', 'http://localhost/feed', 'http://foo.local/feed',
    'http://127.0.0.1/feed', 'http://10.0.0.1/feed', 'http://100.64.0.1/feed', 'http://169.254.169.254/latest',
    'http://192.0.2.1/feed', 'http://192.168.1.2/feed', 'http://198.51.100.1/feed', 'http://224.0.0.1/feed',
    'http://[::1]/feed', 'http://[fd00::1]/feed', 'http://[fe80::1]/feed', 'http://[2001:db8::1]/feed',
  ]) assert.throws(() => assertSafeRssUrl(url), /RSS URL|url/)
  assert.equal(assertSafeRssUrl('https://example.com/feed').startsWith('https://example.com/feed'), true)
})

test('Follow resolves an opaque configured credential slot for every fetch without projecting its reference or value', async t => {
  const { service, registry, credentialCalls } = fixture()
  const record = await service.save({ type: 'follow', id: 'papers', name: 'Papers', category: 'paper', enabled: true, limit: 20, listId: '123', fetchDays: 3, fetchPages: 1, view: 0, pageDelayMs: 0, detailDelayMs: 0, credentialSlotId: 'follow' }, { mode: 'create' })
  assert.deepEqual(await service.describeCredentialSlots(), [{ id: 'follow', name: 'Follow login', usage: 'follow-cookie', configured: true, source: 'file', writable: true, allowDashboardWrite: true }])
  assert.equal(JSON.stringify(service.list()).includes('FOLLOW_SECRET'), false)
  assert.equal(JSON.stringify(service.list()).includes('session=secret'), false)
  const originalFetch = globalThis.fetch
  const headers = []
  const urls = []
  globalThis.fetch = async (url, init) => { urls.push(String(url)); headers.push(init.headers); return { ok: true, async json() { return { data: [] } } } }
  t.after(() => { globalThis.fetch = originalFetch })
  const provider = registry.providers.get(record.settingsId)
  await provider.fetch({}, {})
  await provider.fetch({}, {})
  assert.deepEqual(credentialCalls, ['describe:FOLLOW_SECRET', 'FOLLOW_SECRET', 'FOLLOW_SECRET'])
  assert.deepEqual(urls, ['https://api.folo.is/entries', 'https://api.folo.is/entries'])
  assert.equal(headers.every(value => value.Cookie === 'session=secret'), true)
  assert.equal(headers.every(value => value['X-App-Version'] === '1.12.0'), true)
})

test('Follow fails closed with a sanitized source error when a selected credential is absent or empty', async () => {
  for (const missing of [undefined, { value: '' }, { value: '   ' }]) {
    const { service, registry } = fixture({ resolveCredential() { return missing } })
    const record = await service.save({ type: 'follow', id: 'papers', name: 'Papers', category: 'paper', enabled: true, limit: 20, listId: '123', fetchDays: 3, fetchPages: 1, view: 0, pageDelayMs: 0, detailDelayMs: 0, credentialSlotId: 'follow' }, { mode: 'create' })
    const provider = registry.providers.get(record.settingsId)
    await assert.rejects(provider.fetch({}, {}), error => {
      assert.equal(error.message, 'Follow credential could not be resolved for source: follow:papers')
      assert.equal(error.message.includes('FOLLOW_SECRET'), false)
      return true
    })
  }
})

test('credential slots are opaque, dashboard-write-gated, redacted, and resolved without caching', async () => {
  const writable = fixture()
  const slots = await writable.service.describeCredentialSlots()
  assert.deepEqual(slots, [{ id: 'follow', name: 'Follow login', usage: 'follow-cookie', configured: true, source: 'file', writable: true, allowDashboardWrite: true }])
  assert.equal(JSON.stringify(slots).includes('FOLLOW_SECRET'), false)
  assert.equal(JSON.stringify(slots).includes('session=secret'), false)
  await writable.service.setCredential('follow', 'session=rotated')
  await writable.service.unsetCredential('follow')
  assert.deepEqual(writable.credentialWrites, [
    { operation: 'set', ref: 'FOLLOW_SECRET', value: 'session=rotated' },
    { operation: 'unset', ref: 'FOLLOW_SECRET' },
  ])
  for (const value of ['', 'bad\nvalue', 'bad\rvalue', `x${String.fromCharCode(0)}y`, 'x'.repeat(16 * 1024 + 1)]) {
    await assert.rejects(writable.service.setCredential('follow', value), /Credential value is invalid/)
  }

  const ctx = new Context()
  Object.defineProperty(ctx, 'prismSources', { value: new Registry() })
  Object.defineProperty(ctx, 'credentials', { value: { async describe() { return { configured: true, source: 'env', writable: false } }, async set() { throw new Error('must not run') }, async unset() { throw new Error('must not run') } } })
  Object.defineProperty(ctx, 'subagents', { value: {} })
  const readOnly = new PrismSourceSettings(ctx, { credentialSlots: [{ id: 'follow', name: 'Follow', usage: 'follow-cookie', credentialRef: 'FOLLOW_SECRET', allowDashboardWrite: false }], bootstrap: [] })
  readOnly.sources = new Table()
  assert.equal((await readOnly.describeCredentialSlots())[0].allowDashboardWrite, false)
  await assert.rejects(readOnly.setCredential('follow', 'secret'), /read-only/)
  await assert.rejects(readOnly.unsetCredential('follow'), /read-only/)
})

test('credential configuration validates usage and POSIX references and sanitizes backend failures', async () => {
  for (const slot of [
    { id: 'x', name: 'X', usage: 'unknown', credentialRef: 'GOOD_REF', allowDashboardWrite: true },
    { id: 'x', name: 'X', usage: 'follow-cookie', credentialRef: 'not-a-ref', allowDashboardWrite: true },
  ]) {
    const ctx = new Context()
    Object.defineProperty(ctx, 'prismSources', { value: new Registry() })
    Object.defineProperty(ctx, 'credentials', { value: {} })
    Object.defineProperty(ctx, 'subagents', { value: {} })
    assert.throws(() => new PrismSourceSettings(ctx, { credentialSlots: [slot], bootstrap: [] }), /Invalid managed source credential slot/)
  }

  const failing = fixture({ failCredentialWrite: true })
  await assert.rejects(failing.service.setCredential('follow', 'super-secret'), error => {
    assert.equal(error.message, 'Credential could not be stored for slot: follow')
    assert.equal(error.message.includes('super-secret'), false)
    assert.equal(error.message.includes('FOLLOW_SECRET'), false)
    return true
  })
})

test('managed source type defaults and edit identity match original Adapter Items', async () => {
  assert.equal(normalizeManagedSource({ type: 'github-trending', id: 'daily', name: 'Daily' }).limit, 25)
  assert.equal(normalizeManagedSource({ type: 'rss', id: 'rss-example', name: 'RSS', url: 'https://example.com/feed.xml' }).limit, 20)
  const ai = normalizeManagedSource({ type: 'ai-search', id: 'ai-news', name: 'AI', keyword: 'AI news' })
  const follow = normalizeManagedSource({ type: 'follow', id: 'papers', name: 'Papers', listId: '1' })
  assert.equal(ai.limit, 10)
  assert.equal(ai.category, 'news')
  assert.equal(follow.limit, 50)
  assert.equal(follow.category, 'paper')
  const { service } = fixture()
  const created = await service.save(rss, { mode: 'create' })
  await assert.rejects(service.save({ ...rss, id: 'renamed' }, { mode: 'update', expectedSettingsId: 'rss:news', expectedUpdatedAt: created.updatedAt }), /identity cannot change/)
  assert.equal(service.sources.get('rss:renamed'), undefined)
  await service.save({ ...rss, name: 'Updated' }, { mode: 'update', expectedSettingsId: 'rss:news', expectedUpdatedAt: created.updatedAt })
  assert.equal(service.sources.get('rss:news').name, 'Updated')
})

test('adapter state persists independently, drains active fetches, survives restart, and rolls back failures', async () => {
  const { service, registry } = fixture()
  const enabled = await service.save(rss, { mode: 'create' })
  await service.save({ ...rss, id: 'off', name: 'Off', enabled: false }, { mode: 'create' })
  let aborted = false
  const active = service.trackFetch(enabled.settingsId, (_request, execution) => new Promise((resolve, reject) => {
    execution.signal.addEventListener('abort', () => { aborted = true; reject(execution.signal.reason) }, { once: true })
  }), {}, {})
  const disabling = service.setAdapterEnabled('rss', false)
  await assert.rejects(active, /configuration changed/)
  await disabling
  assert.equal(aborted, true)
  assert.deepEqual(service.adapterStates().find(state => state.type === 'rss'), { type: 'rss', enabled: false })
  assert.equal(service.list().find(item => item.settingsId === 'rss:news').enabled, true)
  assert.equal(service.list().find(item => item.settingsId === 'rss:off').enabled, false)
  assert.equal(registry.providers.has('rss:news'), false)
  assert.deepEqual(service.sources.get('@adapter:rss'), { kind: 'adapter-state', type: 'rss', enabled: false, updatedAt: service.sources.get('@adapter:rss').updatedAt })

  await service.setAdapterEnabled('rss', true)
  assert.equal(registry.providers.has('rss:news'), true)
  assert.equal(registry.providers.has('rss:off'), false)

  service.sources.failPut = true
  await assert.rejects(service.setAdapterEnabled('rss', false), /put failed/)
  assert.equal(service.adapterStates().find(state => state.type === 'rss').enabled, true)
  assert.equal(registry.providers.has('rss:news'), true)
  service.sources.failPut = false

  await service.setAdapterEnabled('rss', false)
  registry.register({ id: 'rss:news', name: 'Conflict', fetch() {} })
  await assert.rejects(service.setAdapterEnabled('rss', true), /duplicate/)
  assert.equal(service.adapterStates().find(state => state.type === 'rss').enabled, false)
  assert.equal(service.list().find(item => item.settingsId === 'rss:news').enabled, true)

  const table = service.sources
  const restartCtx = new Context()
  const restartRegistry = new Registry()
  Object.defineProperty(restartCtx, 'storageDomain', { value: { async open() { return { table() { return table }, async close() {} } } } })
  Object.defineProperty(restartCtx, 'prismSources', { value: restartRegistry })
  Object.defineProperty(restartCtx, 'subagents', { value: {} })
  Object.defineProperty(restartCtx, 'credentials', { value: {} })
  const restarted = new PrismSourceSettings(restartCtx, { credentialSlots: [], bootstrap: [] })
  await restarted[Service.init]()
  assert.equal(restarted.adapterStates().find(state => state.type === 'rss').enabled, false)
  assert.equal(restarted.list().find(item => item.settingsId === 'rss:news').enabled, true)
  assert.equal(restartRegistry.providers.size, 0)
})

test('source create/update mode rejects duplicates, missing preconditions, and stale edits', async () => {
  const { service } = fixture()
  const created = await service.save(rss, { mode: 'create' })
  await assert.rejects(service.save(rss, { mode: 'create' }), /already exists/)
  await assert.rejects(service.save({ ...rss, name: 'No condition' }, { mode: 'update' }), /precondition/)
  const updated = await service.save({ ...rss, name: 'Fresh' }, { mode: 'update', expectedSettingsId: created.settingsId, expectedUpdatedAt: created.updatedAt })
  assert.notEqual(updated.updatedAt, created.updatedAt)
  await assert.rejects(service.save({ ...rss, name: 'Stale' }, { mode: 'update', expectedSettingsId: created.settingsId, expectedUpdatedAt: created.updatedAt }), /another editor/)
  assert.equal(service.sources.get(created.settingsId).name, 'Fresh')
})

test('managed providers reject invalid requested limits before any external operation', async () => {
  const { service, starts } = fixture()
  const records = [
    normalizeManagedSource(rss),
    normalizeManagedSource({ type: 'github-trending', id: 'daily', name: 'Daily' }),
    normalizeManagedSource({ type: 'follow', id: 'papers', name: 'Papers', listId: '1' }),
    normalizeManagedSource({ type: 'ai-search', id: 'ai', name: 'AI', keyword: 'news' }),
  ]
  for (const record of records) {
    const provider = service.provider(record)
    for (const limit of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      await assert.rejects(provider.fetch({ limit }, { agent: {}, signal: new AbortController().signal }), /positive integer/)
    }
  }
  assert.equal(starts.length, 0)
})

test('managed AI Search requires an Agent and fixes provider/tool while disposing each run', async () => {
  let disposals = 0
  const { service, registry, starts } = fixture({ onDispose() { disposals += 1 } })
  const record = await service.save({ type: 'ai-search', id: 'ai-news', name: 'AI News', category: 'news', enabled: true, limit: 10, keyword: 'AI news' }, { mode: 'create' })
  const provider = registry.providers.get(record.settingsId)
  await assert.rejects(provider.fetch({}, {}), /requires a model-driven DSH tool call/)
  const result = await provider.fetch({}, { agent: { id: 'parent' } })
  assert.equal(result.length, 1)
  assert.equal(starts[0].provider, 'spawn')
  assert.deepEqual(starts[0].request.toolFilter, { allow: ['web_search'] })
  assert.equal(disposals, 1)
})

test('permissive domain schema opens primitive corrupt records and the service isolates them', async () => {
  const values = [null, 'corrupt', ['corrupt'], 42, rss]
  for (const value of values) {
    assert.equal(managedSourceSchema.safeParse(value).success, true)
    assert.equal(prismSourceSettingsDomain.tables.sources.valueSchema.safeParse(value).success, true)
  }
  const table = new Table([
    ['corrupt:null', null], ['corrupt:string', 'corrupt'], ['corrupt:array', ['corrupt']], ['corrupt:number', 42], ['rss:news', rss],
  ])
  const ctx = new Context()
  const registry = new Registry()
  Object.defineProperty(ctx, 'storageDomain', { value: { async open(spec) {
    for (const value of table.map.values()) spec.tables.sources.valueSchema.parse(value)
    return { table() { return table }, async close() {} }
  } } })
  Object.defineProperty(ctx, 'prismSources', { value: registry })
  Object.defineProperty(ctx, 'subagents', { value: {} })
  Object.defineProperty(ctx, 'credentials', { value: {} })
  const service = new PrismSourceSettings(ctx, { credentialSlots: [], bootstrap: [] })
  await service[Service.init]()
  assert.deepEqual(service.list().map(record => record.settingsId), ['rss:news'])
  assert.equal(registry.providers.has('rss:news'), true)
})

test('bootstrap applies only to an empty domain and malformed records are isolated', async () => {
  const table = new Table()
  const ctx = new Context()
  const registry = new Registry()
  const warnings = []
  Object.defineProperty(ctx, 'storageDomain', { value: { async open() { return { table() { return table }, async close() {} } } } })
  Object.defineProperty(ctx, 'prismSources', { value: registry })
  Object.defineProperty(ctx, 'subagents', { value: {} })
  Object.defineProperty(ctx, 'credentials', { value: {} })
  Object.defineProperty(ctx, 'logger', { value: { warn(message) { warnings.push(message) } } })
  const service = new PrismSourceSettings(ctx, { credentialSlots: [], bootstrap: [rss, { ...rss, id: 'bad', url: 'http://127.0.0.1/feed' }] })
  await service[Service.init]()
  assert.equal(service.list().length, 1)
  assert.ok(registry.providers.has('rss:news'))
  assert.equal(warnings.length, 1)

  const bad = { type: 'rss', id: 'corrupt', name: '', enabled: true, secret: 'must-not-project' }
  table.map.set('rss:corrupt', bad)
  assert.equal(service.list().some(item => item.settingsId === 'rss:corrupt'), false)
})

test('bootstrap skips duplicate and static collisions before persistence', async () => {
  const table = new Table()
  const ctx = new Context()
  const registry = new Registry()
  registry.register({ id: 'rss:static', name: 'Static', fetch() {} })
  Object.defineProperty(ctx, 'storageDomain', { value: { async open() { return { table() { return table }, async close() {} } } } })
  Object.defineProperty(ctx, 'prismSources', { value: registry })
  Object.defineProperty(ctx, 'subagents', { value: {} })
  Object.defineProperty(ctx, 'credentials', { value: {} })
  const service = new PrismSourceSettings(ctx, { credentialSlots: [], bootstrap: [
    { ...rss, id: 'static' }, rss, { ...rss, name: 'Duplicate' },
  ] })
  await service[Service.init]()
  assert.equal(table.get('rss:static'), undefined)
  assert.equal(table.putCount, 1)
  assert.equal(service.list()[0].settingsId, 'rss:news')
  assert.equal(registry.providers.get('rss:static').name, 'Static')
  assert.ok(registry.providers.has('rss:news'))
})

test('bootstrap write failure rolls back registrations and all attempted writes so restart retries', async () => {
  const table = new Table()
  table.failPutAt = 2
  const make = () => {
    const ctx = new Context()
    const registry = new Registry()
    Object.defineProperty(ctx, 'storageDomain', { value: { async open() { return { table() { return table }, async close() {} } } } })
    Object.defineProperty(ctx, 'prismSources', { value: registry })
    Object.defineProperty(ctx, 'subagents', { value: {} })
    Object.defineProperty(ctx, 'credentials', { value: {} })
    return { service: new PrismSourceSettings(ctx, { credentialSlots: [], bootstrap: [rss, { ...rss, id: 'other', name: 'Other' }] }), registry }
  }
  const first = make()
  await assert.rejects(first.service[Service.init](), /put failed/)
  assert.equal(table.map.size, 0)
  assert.equal(first.registry.providers.size, 0)

  table.failPutAt = undefined
  table.putCount = 0
  const second = make()
  await second.service[Service.init]()
  assert.deepEqual([...table.map.keys()].sort(), ['rss:news', 'rss:other'])
  assert.deepEqual([...second.registry.providers.keys()].sort(), ['rss:news', 'rss:other'])
})

test('bootstrap surfaces aggregate failure when best-effort rollback also fails', async () => {
  const table = new Table()
  table.failPutAt = 2
  table.failDelete = true
  const ctx = new Context()
  const registry = new Registry()
  Object.defineProperty(ctx, 'storageDomain', { value: { async open() { return { table() { return table }, async close() {} } } } })
  Object.defineProperty(ctx, 'prismSources', { value: registry })
  Object.defineProperty(ctx, 'subagents', { value: {} })
  Object.defineProperty(ctx, 'credentials', { value: {} })
  const service = new PrismSourceSettings(ctx, { credentialSlots: [], bootstrap: [rss, { ...rss, id: 'other', name: 'Other' }] })
  await assert.rejects(service[Service.init](), error => {
    assert.equal(error instanceof AggregateError, true)
    assert.match(error.message, /bootstrap and rollback failed/)
    return true
  })
})

test('normalization keeps disabled managed records visible with stable full ids', () => {
  const record = normalizeManagedSource({ ...rss, enabled: false })
  assert.equal(record.settingsId, 'rss:news')
  assert.equal(record.enabled, false)
})

test('bundle keeps visual source settings disabled for headless profiles without storage', async () => {
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /id: prismflow-store-source-settings\s+name: '@prismflow\/dsh\/store-source-settings'\s+disabled: true/)
})
