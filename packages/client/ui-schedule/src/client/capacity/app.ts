/** 迁移自独立版的纯 DOM 视图；计算与状态逻辑由 core.ts 提供。 */
import * as C from './core.ts'
import { DEMO_OVERRIDES, DEMO_SCHEDULES } from './demo.ts'
import { SHELL } from './shell.ts'

/* ------------------------------------------------------------------ */
/* 常量与状态                                                          */
/* ------------------------------------------------------------------ */

const PREF_KEY = 'yd.capacity.prefs.v2'
const TOKEN_KEY = 'yd.capacity.token.v2'
const SESSION_KEY = 'yd.capacity.token.session.v2'
const CACHE_KEY = 'yd.capacity.cache.v2'
const WEEK_SHORT = ['日', '一', '二', '三', '四', '五', '六']

const CATEGORY = {
  财务: '#2563eb',
  物流: '#d97706',
  客服: '#0e9384',
  IT: '#7c3aed',
  采购: '#db2777',
  运营: '#0891b2',
  通用: '#64748b',
}

const state = {
  source: 'demo',
  fromCache: false,
  tasks: [],
  overrides: {},
  capacity: 3,
  fallback: 15,
  rangeDays: 7,
  rangeStart: C.startOfDay(Date.now()),
  dayIndex: 0,
  search: '',
  filter: 'all',
  typeFilter: 'all',
  sortKey: 'load',
  sortDir: 'desc',
  highlight: null,
  lastSync: null,
  derived: null,
  api: { token: '', credential: '', proxy: false },
}

let app = null
const cleanupFns = []
let resizeObserver = null

const $ = (sel, scope = app) => scope.querySelector(sel)
const $$ = (sel, scope = app) => [...scope.querySelectorAll(sel)]

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

const esc = value =>
  String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function pad2(n) {
  return String(n).padStart(2, '0')
}

function fmtDur(minutes, compact = false) {
  const raw = Number(minutes) || 0
  if (raw <= 0) return '0 分'
  if (raw < 1) return `${Math.max(1, Math.round(raw * 60))} 秒`
  const m = Math.round(raw)
  if (m < 60) return `${m} 分`
  const h = Math.floor(m / 60)
  const r = m % 60
  if (compact) return r ? `${h}h${pad2(r)}m` : `${h}h`
  return r ? `${h} 小时 ${r} 分` : `${h} 小时`
}

/** 统计值可能小于一分钟（秒级任务），按秒显示更直观。 */
function fmtStat(minutes) {
  if (minutes == null) return '—'
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))} 秒`
  return `${Math.round(minutes * 10) / 10} 分钟`
}

/** 样本在文本框里用可读单位显示：秒级用“12秒”，长任务用“3.47分”。 */
function fmtSample(minutes) {
  if (!(Number(minutes) > 0)) return ''
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))}秒`
  return `${Math.round(minutes * 100) / 100}分`
}

/** 超载窗口跨度为秒级时，显示到秒，避免出现 “09:00 – 09:00”。 */
function timeSpan(start, end) {
  const short = end - start < 60000
  const label = ms => (short ? `${C.hhmm(ms)}:${pad2(new Date(ms).getSeconds())}` : C.hhmm(ms))
  return `${label(start)} – ${label(end)}`
}

function fmtNum(n, digits = 0) {
  return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function categoryOf(name) {
  const prefix = String(name).split('_')[0].trim()
  return prefix in CATEGORY ? prefix : '其他'
}

function colorOf(name) {
  return CATEGORY[categoryOf(name)] ?? '#475569'
}

function taskShort(name) {
  return String(name).replace(/^[^_]+_/, '').replace(/_数据获取$|_业务操作$|_数据准备$|_数据下载$/, '')
}

function dateLabel(ms) {
  return `周${WEEK_SHORT[new Date(ms).getDay()]}`
}

function timeRange(start, end) {
  return `${C.hhmm(start)} – ${C.hhmm(end)}`
}

function debounce(fn, wait = 120) {
  let timer = null
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
}

function toast(message, kind = '') {
  const host = $('#toastRoot')
  const el = document.createElement('div')
  el.className = `toast ${kind}`
  el.textContent = message
  host.appendChild(el)
  setTimeout(() => el.remove(), 3200)
}

/* ------------------------------------------------------------------ */
/* 偏好与 Token                                                        */
/* ------------------------------------------------------------------ */

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}')
    if (Number.isFinite(saved.capacity)) state.capacity = clamp(Math.round(saved.capacity), 1, 12)
    if (Number.isFinite(saved.fallback)) state.fallback = clamp(Math.round(saved.fallback), 1, 600)
    if ([7, 14].includes(saved.rangeDays)) state.rangeDays = saved.rangeDays
    if (saved.overrides && typeof saved.overrides === 'object') state.overrides = saved.overrides
    if (['all', 'executed', 'scheduled', 'alert', 'estimate', 'conditional', 'hourly'].includes(saved.filter)) {
      state.filter = saved.filter
    }
    if (['all', 'period', 'timer', 'manual', 'disabled'].includes(saved.typeFilter)) state.typeFilter = saved.typeFilter
    if (['name', 'group', 'duration', 'instances', 'load', 'status'].includes(saved.sortKey)) state.sortKey = saved.sortKey
    if (saved.sortDir === 'asc' || saved.sortDir === 'desc') state.sortDir = saved.sortDir
  } catch {
    /* 忽略损坏的本地配置 */
  }

  const raw = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(SESSION_KEY)
  if (raw) {
    try {
      const token = JSON.parse(raw)
      if (token?.token) {
        state.api.token = String(token.token)
        state.api.credential = String(token.credential || '')
      }
    } catch {
      /* 忽略损坏的 token */
    }
  }
}

function savePrefs() {
  const payload = {
    capacity: state.capacity,
    fallback: state.fallback,
    rangeDays: state.rangeDays,
    filter: state.filter,
    typeFilter: state.typeFilter,
    sortKey: state.sortKey,
    sortDir: state.sortDir,
    overrides: state.overrides,
    savedAt: Date.now(),
  }
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(payload))
  } catch {
    /* 空间不足时静默失败 */
  }
}

function persistToken(remember, token, credential) {
  const payload = JSON.stringify({ token, credential })
  localStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(SESSION_KEY)
  if (remember) localStorage.setItem(TOKEN_KEY, payload)
  else sessionStorage.setItem(SESSION_KEY, payload)
}

/* ------------------------------------------------------------------ */
/* 数据接入                                                            */
/* ------------------------------------------------------------------ */

function apiBase() {
  return 'https://api.yingdao.com'
}

function requestHeaders() {
  const headers = {
    accept: 'application/json',
    'accept-language': 'zh-CN',
    'content-type': 'application/json',
    authorization: `Bearer ${state.api.token}`,
    'x-from': 'console',
    timezone: '%2B08%3A00',
  }
  if (state.api.credential) headers['x-credential'] = state.api.credential
  return headers
}

async function fetchSchedulePage(page, size = 100) {
  const res = await fetch(`${apiBase()}/api/dispatch/v2/schedule/list`, {
    method: 'POST',
    headers: requestHeaders(),
    body: JSON.stringify({ page, size, key: '', enabled: '', type: '' }),
    credentials: 'omit',
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const json = await res.json()
  if (json?.success === false || (json?.code && json.code !== 200)) {
    throw new Error(json?.message || json?.msg || `接口返回 code=${json?.code}`)
  }
  if (!Array.isArray(json?.data)) throw new Error('接口返回结构异常：缺少 data 数组')
  return json
}

async function postJson(path, body, timeoutMs = 20_000) {
  const res = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: requestHeaders(),
    body: JSON.stringify(body),
    credentials: 'omit',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const json = await res.json()
  if (json?.success === false || (json?.code && json.code !== 200)) {
    throw new Error(json?.message || json?.msg || `接口返回 code=${json?.code}`)
  }
  return json
}

/** 影刀控制台“执行记录”页使用的接口：runTime 单位为秒，sourceUuid 是计划 UUID。 */
async function fetchTaskSamples(taskId, from, to, size = 40) {
  const json = await postJson('/api/dispatch/v3/scene/inst/page', {
    page: 1,
    size,
    scheduleUuidList: [taskId],
    statusList: ['finish'],
    startTime: apiDateTime(from, '00:00:00'),
    endTime: apiDateTime(to, '23:59:59'),
  })
  const rows = Array.isArray(json?.data)
    ? json.data
    : Array.isArray(json?.data?.dataList) ? json.data.dataList : []
  return rows
    .filter(row => row && row.status === 'finish' && Number(row.runTime) > 0)
    .map(row => Number(row.runTime) / 60)
}

function apiDateTime(ms, clock) {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${clock}`
}

async function fetchAllSchedules() {
  const first = await fetchSchedulePage(1, 100)
  const list = [...first.data]
  const pages = Math.min(Number(first?.page?.pages) || 1, 20)
  for (let page = 2; page <= pages; page += 1) {
    const next = await fetchSchedulePage(page, 100)
    list.push(...next.data)
  }
  return list
}

function explainError(error) {
  const message = String(error?.message || error)
  if (/Failed to fetch|NetworkError|Load failed|Network request failed/i.test(message)) {
    return '无法访问影刀接口：请检查网络，或确认浏览器允许访问 api.yingdao.com。'
  }
  if (/401|403|未认证|token|权限/i.test(message)) return 'Token 失效或没有权限，请从控制台重新复制（Token 每天更新）。'
  return `加载失败：${message}`
}

function applyDemo() {
  state.source = 'demo'
  state.fromCache = false
  state.tasks = DEMO_SCHEDULES.map(C.normalizeSchedule)
  state.overrides = { ...DEMO_OVERRIDES, ...state.overrides }
  state.lastSync = null
  state.highlight = null
  state.dayIndex = 0
  renderAll()
}

/** 计划数据缓存在本机；打开面板只读缓存，只有手动刷新才请求接口。 */
function saveScheduleCache(schedules) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), schedules }))
  } catch {
    /* 配额不足时放弃缓存 */
  }
}

function loadScheduleCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    if (!cached || !Array.isArray(cached.schedules) || !cached.schedules.length) return null
    return { at: Number(cached.at) || null, schedules: cached.schedules }
  } catch {
    return null
  }
}

function applyLive(schedules, { fromCache = false, syncedAt = Date.now() } = {}) {
  state.source = 'live'
  state.fromCache = fromCache
  state.tasks = schedules.map(C.normalizeSchedule)
  state.lastSync = syncedAt
  state.highlight = null
  state.dayIndex = Math.min(state.dayIndex, state.rangeDays - 1)
  if (!fromCache) saveScheduleCache(schedules)
  renderAll()
}

function applyCached() {
  const cached = loadScheduleCache()
  if (!cached) return false
  applyLive(cached.schedules, { fromCache: true, syncedAt: cached.at ?? null })
  return true
}

/* ------------------------------------------------------------------ */
/* 计算                                                                */
/* ------------------------------------------------------------------ */

function compute() {
  const from = state.rangeStart
  const to = C.addDays(from, state.rangeDays)
  const allInstances = C.generateInstances(state.tasks, state.overrides, from, to, state.fallback)
  // 条件任务的心跳检查按秒计，不参与并发峰值与超载判断；实跑才占容量。
  const instances = allInstances.filter(inst => inst.phase !== 'check')
  const segments = C.sweepConcurrency(instances)
  const sim = C.simulate(allInstances, state.capacity)
  const summary = C.summarize(instances, segments, state.capacity)

  const taskStats = new Map()
  for (const task of state.tasks) taskStats.set(task.id, { instances: 0, checks: 0, minutes: 0, overloaded: false })
  for (const inst of allInstances) {
    const stat = taskStats.get(inst.taskId)
    if (!stat) continue
    if (inst.phase === 'check') stat.checks += 1
    else stat.instances += 1
    stat.minutes += inst.minutes
  }

  const taskById = new Map(state.tasks.map(task => [task.id, task]))
  const overloadTaskIds = new Set()
  for (const window of summary.overloads) for (const id of window.taskIds) overloadTaskIds.add(id)
  for (const id of overloadTaskIds) {
    const stat = taskStats.get(id)
    if (stat) stat.overloaded = true
  }

  const days = Array.from({ length: state.rangeDays }, (_, index) => {
    const start = C.addDays(from, index)
    const end = C.addDays(start, 1)
    const dayAll = allInstances.filter(inst => inst.start < end && inst.end > start)
    const dayInstances = dayAll.filter(inst => inst.phase !== 'check')
    const daySegments = C.clipSegments(segments, start, end)
    const dayOverloads = C.overloadWindows(daySegments, state.capacity)
    const profile = C.hourlyProfile(daySegments, start, state.capacity)
    const dayAssignments = sim.assignments.filter(a => a.start < end && a.end > start)
    const busy = C.busyMinutes(daySegments, start, end)
    return {
      index,
      start,
      end,
      instances: dayInstances,
      triggers: dayAll,
      segments: daySegments,
      overloads: dayOverloads,
      profile,
      assignments: dayAssignments,
      peak: daySegments.reduce((max, seg) => Math.max(max, seg.count), 0),
      busy,
      overloadMinutes: dayOverloads.reduce((sum, w) => sum + (w.end - w.start) / C.MINUTE, 0),
      instanceCount: dayInstances.length,
      triggerCount: dayAll.length,
      utilization: busy / (state.capacity * 1440),
    }
  })

  state.derived = {
    from,
    to,
    instances,
    allInstances,
    segments,
    sim,
    summary,
    days,
    taskStats,
    taskById,
    overloadTaskIds,
    scheduledCount: state.tasks.filter(t => t.kind === 'scheduled').length,
    manualCount: state.tasks.filter(t => t.kind === 'manual').length,
    disabledCount: state.tasks.filter(t => t.kind === 'disabled').length,
    unparsedCount: state.tasks.filter(t => t.kind === 'unparsed').length,
  }
  return state.derived
}

/* ------------------------------------------------------------------ */
/* 渲染：状态 / 指标                                                    */
/* ------------------------------------------------------------------ */

function renderStatus() {
  const pill = $('#sourcePill')
  const mode = state.source === 'demo' ? 'demo' : state.fromCache ? 'cached' : 'live'
  const label = mode === 'demo' ? '演示数据' : mode === 'cached' ? '缓存数据' : '影刀实时'
  pill.dataset.state = mode
  pill.innerHTML = `<span class="dot"></span>${label}`
  pill.title = mode === 'cached'
    ? '计划数据来自本地缓存，点右上角「刷新」重新拉取'
    : mode === 'live' ? '已从影刀刷新' : '尚未连接影刀，当前为演示数据'
  const sync = $('#syncTime')
  if (state.source === 'live' && state.lastSync) {
    const date = new Date(state.lastSync)
    const sameDay = date.toDateString() === new Date().toDateString()
    const prefix = sameDay ? '' : `${date.getMonth() + 1}/${date.getDate()} `
    sync.textContent = `同步 ${prefix}${pad2(date.getHours())}:${pad2(date.getMinutes())}`
    sync.title = state.fromCache ? '来自本地缓存，点「刷新」重新拉取' : '已与影刀同步'
  } else if (state.source === 'live') {
    sync.textContent = '已缓存'
    sync.title = '来自本地缓存，点「刷新」重新拉取'
  } else {
    sync.textContent = state.api.token ? '待刷新' : '未连接'
    sync.title = state.api.token ? '已保存 Token，点「刷新」拉取计划' : '点「连接影刀」填入 Token'
  }
}

function kpiCard({ label, value, unit, foot, meter, tone = '' }) {
  return `<article class="card kpi ${tone}">
    <div class="kpi-label"><i></i>${esc(label)}</div>
    <div class="kpi-value">${value}${unit ? `<small>${esc(unit)}</small>` : ''}</div>
    <div class="kpi-foot">${foot}</div>
    ${meter === null ? '' : `<div class="kpi-meter"><i style="width:${clamp(meter, 0, 100).toFixed(1)}%"></i></div>`}
  </article>`
}

function renderKpis() {
  const d = state.derived
  const total = d.instances.length
  const perDay = total / state.rangeDays
  const occupancy = d.instances.length
    ? d.segments.reduce((sum, seg) => sum + ((seg.end - seg.start) / C.MINUTE) * seg.count, 0) /
      (state.capacity * state.rangeDays * 1440)
    : 0

  const cards = [
    kpiCard({
      label: '可排期计划',
      value: fmtNum(d.scheduledCount),
      unit: '个',
      foot: `<span>排期 ${fmtNum(d.scheduledCount)}</span><span class="badge">手动 ${fmtNum(d.manualCount)}</span>${d.disabledCount ? `<span class="badge">停用 ${fmtNum(d.disabledCount)}</span>` : ''}`,
      meter: state.tasks.length ? (d.scheduledCount / state.tasks.length) * 100 : 0,
    }),
    kpiCard({
      label: '计划实例',
      value: fmtNum(total),
      unit: '次',
      foot: `<span>日均 ${fmtNum(perDay, 1)} 次</span>${d.allInstances.length > total ? `<span class="badge">含 ${fmtNum(d.allInstances.length - total)} 次心跳</span>` : `<span class="badge">${state.rangeDays} 天</span>`}`,
      meter: Math.min(100, perDay * 6),
    }),
    kpiCard({
      label: '峰值并发',
      value: fmtNum(d.summary.peak),
      unit: '台',
      foot: d.summary.gap > 0
        ? `<span>容量 ${state.capacity} 台</span><span class="badge badge-danger">缺 ${d.summary.gap} 台</span>`
        : `<span>容量 ${state.capacity} 台</span><span class="badge badge-ok">容量充足</span>`,
      meter: (d.summary.peak / Math.max(1, state.capacity)) * 100,
      tone: d.summary.gap > 0 ? 'is-alert' : 'is-ok',
    }),
    kpiCard({
      label: '超载时长',
      value: d.summary.overloadedMinutes >= 60
        ? fmtNum(Math.floor(d.summary.overloadedMinutes / 60))
        : fmtNum(Math.round(d.summary.overloadedMinutes)),
      unit: d.summary.overloadedMinutes >= 60 ? '小时' : '分',
      foot: d.summary.overloads.length
        ? (d.summary.overloads.every(window => window.end - window.start < 60000)
          ? `<span>${d.summary.overloads.length} 个时段</span><span class="badge badge-warn">均为秒级碰撞</span>`
          : `<span>${d.summary.overloads.length} 个时段</span><span class="badge badge-danger">需扩容</span>`)
        : '<span>本周没有出现容量缺口</span>',
      meter: Math.min(100, (d.summary.overloadedMinutes / (state.rangeDays * 60)) * 100),
      tone: d.summary.overloads.length ? 'is-alert' : 'is-ok',
    }),
    kpiCard({
      label: '机器人占用率',
      value: fmtNum(occupancy * 100),
      unit: '%',
      foot: `<span>排队最长 ${fmtNum(d.sim.maxDelay)} 分</span><span class="badge${d.sim.delayedCount ? ' badge-warn' : ''}">延迟 ${d.sim.delayedCount} 次</span>`,
      meter: occupancy * 100,
    }),
  ]
  $('#kpis').innerHTML = cards.join('')
}

/* ------------------------------------------------------------------ */
/* 渲染：日期页签                                                       */
/* ------------------------------------------------------------------ */

function renderTabs() {
  const d = state.derived
  const maxPeak = Math.max(1, ...d.days.map(day => day.peak), state.capacity)
  $('#dayTabs').innerHTML = d.days
    .map((day) => {
      const active = day.index === state.dayIndex
      const width = day.peak ? Math.max(6, (day.peak / maxPeak) * 100) : 0
      return `<button type="button" role="tab" aria-selected="${active}" class="day-tab${active ? ' is-active' : ''}" data-day="${day.index}">
        <span class="dt-day">${dateLabel(day.start)}</span>
        <span class="dt-date">${C.monthDay(day.start)}</span>
        ${day.overloads.length ? '<span class="dt-dot" title="存在超载"></span>' : ''}
        <span class="dt-bar"><i style="width:${width}%"></i></span>
      </button>`
    })
    .join('')
}

/* ------------------------------------------------------------------ */
/* 渲染：并发曲线                                                       */
/* ------------------------------------------------------------------ */

function renderChart() {
  const host = $('#concHost')
  const day = state.derived.days[state.dayIndex]
  if (!day) return
  const W = Math.max(340, host.clientWidth || 760)
  const H = 206
  const pad = { l: 30, r: 14, t: 16, b: 26 }
  const iw = W - pad.l - pad.r
  const ih = H - pad.t - pad.b
  const cap = state.capacity
  const maxCount = Math.max(cap + 1, day.peak, 4)
  const x = t => pad.l + ((clamp(t, day.start, day.end) - day.start) / C.DAY) * iw
  const y = c => pad.t + ih * (1 - c / maxCount)
  const taskName = id => state.derived.taskById.get(id)?.name ?? id
  const out = []

  out.push(`<svg class="conc" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(`${dateLabel(day.start)}并发曲线`)}">`)
  out.push(`<defs><linearGradient id="concGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#4f46e5" stop-opacity="0.30"></stop>
    <stop offset="100%" stop-color="#4f46e5" stop-opacity="0.015"></stop>
  </linearGradient></defs>`)

  for (const window of day.overloads) {
    const x1 = x(window.start)
    const x2 = x(window.end)
    out.push(`<rect x="${x1.toFixed(1)}" y="${pad.t}" width="${Math.max(1, x2 - x1).toFixed(1)}" height="${ih}" fill="rgba(217,45,32,0.055)"></rect>`)
    out.push(`<rect x="${x1.toFixed(1)}" y="${pad.t}" width="${Math.max(1, x2 - x1).toFixed(1)}" height="2" fill="#d92d20" opacity="0.6"></rect>`)
  }

  const step = maxCount <= 6 ? 1 : 2
  for (let c = 0; c <= maxCount; c += step) {
    out.push(`<line class="axis-line" x1="${pad.l}" y1="${y(c).toFixed(1)}" x2="${W - pad.r}" y2="${y(c).toFixed(1)}"></line>`)
    out.push(`<text x="${pad.l - 7}" y="${(y(c) + 3).toFixed(1)}" text-anchor="end">${c}</text>`)
  }
  out.push(`<line class="base-line" x1="${pad.l}" y1="${y(0).toFixed(1)}" x2="${W - pad.r}" y2="${y(0).toFixed(1)}"></line>`)

  for (let h = 0; h <= 24; h += 3) {
    const px = pad.l + (h / 24) * iw
    out.push(`<line class="axis-line" x1="${px.toFixed(1)}" y1="${pad.t}" x2="${px.toFixed(1)}" y2="${pad.t + ih}"></line>`)
    if (h < 24 && (W >= 560 || h % 6 === 0)) {
      const anchor = h === 0 ? 'start' : h === 21 || (W < 560 && h === 18) ? 'end' : 'middle'
      out.push(`<text x="${px.toFixed(1)}" y="${H - 8}" text-anchor="${anchor}">${pad2(h)}:00</text>`)
    }
  }

  for (const seg of day.segments) {
    const x1 = x(seg.start)
    const x2 = x(seg.end)
    if (x2 - x1 < 0.5) continue
    const yy = y(seg.count)
    out.push(`<path d="M${x1.toFixed(1)} ${y(0).toFixed(1)} L${x1.toFixed(1)} ${yy.toFixed(1)} L${x2.toFixed(1)} ${yy.toFixed(1)} L${x2.toFixed(1)} ${y(0).toFixed(1)} Z" fill="url(#concGrad)"></path>`)
    out.push(`<path class="seg-line" d="M${x1.toFixed(1)} ${yy.toFixed(1)} L${x2.toFixed(1)} ${yy.toFixed(1)}"></path>`)

    const names = seg.taskIds.map(taskName)
    const tip = `${timeRange(seg.start, seg.end)} · ${seg.count} 个任务并行\n${names.slice(0, 6).map(n => `· ${n}`).join('\n')}${names.length > 6 ? `\n· 等 ${names.length} 个任务` : ''}`
    out.push(`<rect class="seg-hit" x="${x1.toFixed(1)}" y="${pad.t}" width="${Math.max(1, x2 - x1).toFixed(1)}" height="${ih}" data-tip="${esc(tip)}"></rect>`)
  }

  const peakSeg = day.segments.find(seg => seg.count === day.peak && seg.count > 1)
  if (peakSeg) {
    out.push(`<text class="peak-label" x="${(x(peakSeg.start) + 3).toFixed(1)}" y="${(y(peakSeg.count) - 5).toFixed(1)}">${peakSeg.count}</text>`)
  }

  const capY = y(cap)
  out.push(`<line class="cap-line" x1="${pad.l}" y1="${capY.toFixed(1)}" x2="${W - pad.r}" y2="${capY.toFixed(1)}"></line>`)
  out.push(`<text class="cap-label" x="${W - pad.r}" y="${(capY - 5).toFixed(1)}" text-anchor="end">容量 ${cap} 台</text>`)

  const now = Date.now()
  if (now >= day.start && now < day.end) {
    const nx = x(now)
    out.push(`<line class="now-line" x1="${nx.toFixed(1)}" y1="${pad.t}" x2="${nx.toFixed(1)}" y2="${pad.t + ih}"></line>`)
    out.push(`<text class="now-label" x="${(nx + 3).toFixed(1)}" y="${pad.t + 10}">现在</text>`)
  }

  if (!day.segments.length) {
    out.push(`<text x="${W / 2}" y="${pad.t + ih / 2}" text-anchor="middle" fill="#98a2b3" font-size="12">这一天没有计划任务</text>`)
  }

  out.push('</svg>')
  host.innerHTML = out.join('')
}

/* ------------------------------------------------------------------ */
/* 渲染：机器人泳道                                                     */
/* ------------------------------------------------------------------ */

function renderLanes() {
  const day = state.derived.days[state.dayIndex]
  if (!day) return
  const cap = state.capacity
  const focus = state.highlight
  const taskById = state.derived.taskById
  const axis = ['<div class="lane-axis"><span></span><div class="lane-hours">']
  for (const h of [0, 6, 12, 18, 24]) {
    axis.push(`<span style="${h === 24 ? 'right:0' : `left:${(h / 24) * 100}%`};transform:${h === 24 ? 'translateX(0)' : h === 0 ? 'none' : 'translateX(-50%)'}">${pad2(h)}</span>`)
  }
  axis.push('</div></div>')

  const rows = []
  for (let robot = 0; robot < cap; robot += 1) {
    const blocks = day.assignments.filter(a => a.robot === robot)
    const busy = blocks.length > 0
    const html = blocks.map((a) => {
      const start = Math.max(a.start, day.start)
      const end = Math.min(a.end, day.end)
      const left = ((start - day.start) / C.DAY) * 100
      const width = Math.max(0.25, ((end - start) / C.DAY) * 100)
      const task = taskById.get(a.taskId)
      const name = task?.name ?? a.taskId
      const color = colorOf(name)
      const isFocus = focus === a.taskId
      const isCheck = a.phase === 'check'
      const parts = []

      if (a.delay > 0.5 && !isCheck) {
        const gStart = Math.max(a.plannedStart, day.start)
        const gEnd = Math.min(a.plannedEnd, day.end)
        if (gEnd > gStart) {
          parts.push(`<span class="ghost" style="left:${(((gStart - day.start) / C.DAY) * 100).toFixed(3)}%;width:${(((gEnd - gStart) / C.DAY) * 100).toFixed(3)}%"></span>`)
        }
      }

      const tip = isCheck
        ? `${name}\n心跳检查 ${C.hhmm(a.start)} · ${Math.round((a.end - a.start) / 1000)} 秒`
        : `${name}\n计划 ${timeRange(a.plannedStart, a.plannedEnd)} · 实际 ${timeRange(a.start, a.end)}\n时长 ${fmtDur(a.end - a.start)}${a.delay > 0.5 ? ` · 排队 ${fmtDur(a.delay)}` : ''}`
      const showLabel = width > 5.5 && !isCheck
      const showDelay = a.delay >= 1 && width > 9 && !isCheck
      parts.push(`<div class="blk${isFocus ? ' is-focus' : ''}${isCheck ? ' is-check' : ''}" data-task="${esc(a.taskId)}" data-tip="${esc(tip)}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%;background:${color}">
        ${showLabel ? `<span class="blk-label">${esc(taskShort(name))}</span>` : ''}
        ${showDelay ? `<span class="delay-tag">+${Math.round(a.delay)}m</span>` : ''}
      </div>`)
      return parts.join('')
    }).join('')

    rows.push(`<div class="lane-row">
      <div class="lane-name"><span class="bot${busy ? ' is-busy' : ''}"><i></i><i></i><i></i></span>机器人 ${pad2(robot + 1)}</div>
      <div class="lane-track">${html}</div>
    </div>`)
  }

  $('#laneHost').innerHTML = axis.join('') + rows.join('')
}

function renderTimelineMeta() {
  const day = state.derived.days[state.dayIndex]
  if (!day) return
  $('#timelineMeta').textContent = `${dateLabel(day.start)} ${C.monthDay(day.start)} · ${day.instanceCount} 个实例 · 峰值 ${day.peak} 台${day.overloadMinutes ? ` · 超载 ${fmtDur(day.overloadMinutes)}` : ''}`
  const flag = $('#peakFlag')
  if (day.overloads.length) {
    const gap = Math.max(0, day.peak - state.capacity)
    flag.hidden = false
    flag.className = 'peak-flag'
    flag.textContent = `容量不足 ${gap} 台 · ${day.overloads.length} 个时段`
  } else if (day.instanceCount > 0) {
    flag.hidden = false
    flag.className = 'peak-flag is-ok'
    flag.textContent = '容量充足'
  } else {
    flag.hidden = true
  }
}

/* ------------------------------------------------------------------ */
/* 渲染：超载列表                                                       */
/* ------------------------------------------------------------------ */

function renderRobotUsage(day) {
  const robots = Array.from({ length: state.capacity }, (_, index) => ({ index, busy: 0, last: 0, count: 0 }))
  for (const assignment of day.assignments) {
    const robot = robots[assignment.robot]
    if (!robot) continue
    const start = Math.max(assignment.start, day.start)
    const end = Math.min(assignment.end, day.end)
    robot.busy += Math.max(0, end - start) / C.MINUTE
    robot.last = Math.max(robot.last, assignment.end)
    robot.count += 1
  }
  $('#robotUsage').innerHTML = '<div class="ru-head">今日机器人占用</div>' + robots.map((robot) => {
    const ratio = Math.min(1, robot.busy / 1440)
    return `<div class="ru-row" title="占用 ${fmtDur(robot.busy)}${robot.last ? ` · 最晚 ${C.hhmm(robot.last)}` : ''}">
      <span class="ru-name">机器人 ${C.pad2(robot.index + 1)}</span>
      <span class="ru-bar"><i style="width:${(ratio * 100).toFixed(1)}%"></i></span>
      <span class="ru-val">${Math.round(ratio * 100)}%</span>
    </div>`
  }).join('')
}

function renderOverload() {
  const d = state.derived
  const day = d.days[state.dayIndex]
  if (!day) return
  renderRobotUsage(day)
  const windows = [...day.overloads].sort((a, b) => b.peak - a.peak || a.start - b.start)
  const totalMinutes = windows.reduce((sum, w) => sum + (w.end - w.start) / C.MINUTE, 0)
  const meta = $('#overloadMeta')
  const badge = $('#overloadCount')
  badge.textContent = String(windows.length)
  badge.className = `badge${windows.length ? ' badge-danger' : ''}`
  meta.textContent = windows.length
    ? `${dateLabel(day.start)} ${C.monthDay(day.start)} · 合计 ${fmtDur(totalMinutes)}`
    : `${dateLabel(day.start)} ${C.monthDay(day.start)} · 没有容量缺口`

  if (!windows.length) {
    const firstBad = d.days.find(item => item.overloads.length > 0)
    $('#overloadList').innerHTML = `<div class="empty-state">
      <div class="es-icon">✓</div>
      <strong>这一天机器人够用</strong>
      <p>峰值 ${day.peak} 台 / 容量 ${state.capacity} 台</p>
      ${firstBad ? `<p style="margin-top:10px"><button class="btn btn-sm" data-goto-day="${firstBad.index}">查看 ${C.monthDay(firstBad.start)} 的超载</button></p>` : ''}
    </div>`
    $('#overloadFoot').innerHTML = '<div class="ol-foot-title"><i></i>错峰参考</div><div class="ol-foot-text">当前日期没有容量缺口，机器人数量够用。</div>'
    return
  }

  $('#overloadFoot').hidden = false
  const worst = windows[0]
  const gap = Math.max(1, worst.peak - state.capacity)
  const peakStart = day.segments.find(seg => seg.count === worst.peak && seg.start >= worst.start)?.start ?? worst.start
  const active = new Map()
  for (const inst of day.instances) {
    if (inst.start <= peakStart && inst.end > peakStart) {
      const current = active.get(inst.taskId)
      if (!current || inst.minutes > current.minutes) active.set(inst.taskId, inst)
    }
  }
  const candidates = [...active.entries()]
    .map(([id, inst]) => ({ id, minutes: inst.minutes, name: d.taskById.get(id)?.name ?? id }))
    .sort((a, b) => b.minutes - a.minutes)
  const moves = candidates.slice(0, gap)
  const names = moves.map(item => taskShort(item.name))
  const shownNames = names.slice(0, 3).join('、') + (names.length > 3 ? ' 等' : '')
  $('#overloadFoot').innerHTML = `<div class="ol-foot-title"><i></i>错峰参考</div>
    <div class="ol-foot-text">${C.hhmm(peakStart)} 峰值 ${worst.peak} 台，超出 ${worst.peak - state.capacity} 台。把当时正在运行的 ${moves.length} 个长任务（${esc(shownNames)}）推迟到 <b>${C.hhmm(worst.end)}</b> 之后，这一段的并发即可压到 ${state.capacity} 台以内。</div>
    <div class="ol-foot-hint">按任务时长排序给出参考；调整后请检查后续时段是否出现新的堆积。</div>`

  $('#overloadList').innerHTML = windows.map((window) => {
    const ids = [...new Set(window.taskIds)]
    const chips = ids.slice(0, 4).map((id) => {
      const name = d.taskById.get(id)?.name ?? id
      return `<button class="ol-chip${state.highlight === id ? ' is-focus' : ''}" data-task="${esc(id)}" title="${esc(name)}">${esc(taskShort(name))}</button>`
    }).join('')
    return `<div class="overload-item">
      <div class="ol-head"><span class="ol-time">${timeSpan(window.start, window.end)}</span><span class="ol-dur">${fmtDur((window.end - window.start) / C.MINUTE)}</span></div>
      <div class="ol-meta">峰值 ${window.peak} 台 · 缺 ${window.peak - state.capacity} 台</div>
      <div class="ol-tasks">${chips}${ids.length > 4 ? `<span class="ol-chip">+${ids.length - 4}</span>` : ''}</div>
    </div>`
  }).join('')
}

/* ------------------------------------------------------------------ */
/* 渲染：热力图 / 每日概览                                              */
/* ------------------------------------------------------------------ */

function heatStyle(peak) {
  if (!peak) return { cls: 'is-empty', style: '' }
  if (peak > state.capacity) return { cls: 'is-over', style: '' }
  const alpha = 0.1 + (peak / state.capacity) * 0.58
  return { cls: '', style: `background:rgba(79,70,229,${alpha.toFixed(3)});${alpha > 0.44 ? 'color:#fff' : 'color:#312e81'}` }
}

function renderHeatmap() {
  const d = state.derived
  const today = C.startOfDay(Date.now())
  const cells = ['<div class="heat-corner">日期 / 时段</div>']
  for (let h = 0; h < 24; h += 1) cells.push(`<div class="heat-hour">${h % 2 === 0 ? pad2(h) : ''}</div>`)

  for (const day of d.days) {
    const isToday = day.start === today
    cells.push(`<div class="heat-day">${isToday ? '<span class="today"></span>' : ''}<b>${dateLabel(day.start)}</b>${C.monthDay(day.start)}</div>`)
    for (let h = 0; h < 24; h += 1) {
      const slot = day.profile[h]
      const { cls, style } = heatStyle(slot.peak)
      const names = [...new Set(
        day.instances
          .filter(inst => inst.start < day.start + (h + 1) * 3_600_000 && inst.end > day.start + h * 3_600_000)
          .map(inst => d.taskById.get(inst.taskId)?.name ?? inst.taskId),
      )]
      const tip = `${C.monthDay(day.start)} ${dateLabel(day.start)} ${pad2(h)}:00–${pad2(h + 1)}:00\n峰值 ${slot.peak} 台${slot.over ? ` · 超载 ${Math.round(slot.over)} 分` : ''}${names.length ? `\n${names.slice(0, 5).map(n => `· ${n}`).join('\n')}` : ''}`
      cells.push(`<div class="heat-cell ${cls}${isToday ? ' is-today' : ''}" role="button" tabindex="0" data-day="${day.index}" data-tip="${esc(tip)}" style="${style}">${slot.peak || ''}</div>`)
    }
  }
  $('#heatmap').innerHTML = `<div class="heat-grid">${cells.join('')}</div>`
}

function renderDaily() {
  const d = state.derived
  const maxPeak = Math.max(1, ...d.days.map(day => day.peak))
  const unit = Math.max(maxPeak, state.capacity)
  $('#dailyList').innerHTML = d.days.map((day) => {
    const safe = (Math.min(day.peak, state.capacity) / unit) * 100
    const over = (Math.max(0, day.peak - state.capacity) / unit) * 100
    return `<button type="button" class="daily-row${day.index === state.dayIndex ? ' is-active' : ''}" data-day="${day.index}">
      <span class="daily-date"><b>${dateLabel(day.start)}</b> ${C.monthDay(day.start)}</span>
      <span class="daily-bar">
        <i class="safe" style="width:${safe.toFixed(1)}%"></i>
        ${over > 0 ? `<i class="over" style="left:${safe.toFixed(1)}%;width:${over.toFixed(1)}%"></i>` : ''}
      </span>
      <span class="daily-metrics">${day.instanceCount} 次 · 峰 ${day.peak}/${state.capacity}${day.overloadMinutes ? ` · 超 ${fmtDur(day.overloadMinutes, true)}` : ''}</span>
    </button>`
  }).join('')
}

/* ------------------------------------------------------------------ */
/* 渲染：任务表                                                         */
/* ------------------------------------------------------------------ */

function durationOf(task) {
  return C.resolveDuration(task, state.overrides, state.fallback)
}

/** 条件任务配置（心跳检查 + 到点实跑）。 */
function conditionalOf(task) {
  return state.overrides[task.id]?.conditional ?? null
}

function isAlertTask(task) {
  return task.kind === 'scheduled' && state.derived.taskStats.get(task.id)?.instances > 0
    && state.derived.overloadTaskIds.has(task.id)
}

/** 行状态与状态排序权重：问题任务排在前面。 */
const STATUS_RANK = { alert: 0, conditional: 1, estimate: 2, warn: 3, ok: 4, manual: 5, off: 6 }

function statusOf(task) {
  if (task.kind === 'disabled') return ['off', '已停用']
  if (task.kind === 'manual') return ['manual', '手动触发']
  if (task.kind === 'unparsed') return ['warn', '待确认']
  if (conditionalOf(task)) return ['conditional', '条件任务']
  if (isAlertTask(task)) return ['alert', '超载参与']
  if (durationOf(task).source === 'estimate') return ['estimate', '待校准']
  return ['ok', '正常']
}

/** 表头排序标记：仅当前列显示方向箭头。 */
function renderSortMarks() {
  $$('.task-table thead th').forEach((th) => {
    const button = th.querySelector('.th-sort')
    if (!button) return
    const active = button.dataset.sort === state.sortKey
    th.setAttribute('aria-sort', active ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none')
    button.classList.toggle('is-active', active)
    const mark = th.querySelector('.sort-mark')
    if (mark) mark.textContent = active ? (state.sortDir === 'asc' ? '▲' : '▼') : ''
  })
}

/** 类型筛选旁边的数量，帮助判断计划/定时/手动各有多少。 */
function renderTypeCounts() {
  const counts = {
    all: state.tasks.length,
    period: state.tasks.filter(task => task.kind === 'scheduled' && task.type !== 'timer').length,
    timer: state.tasks.filter(task => task.kind === 'scheduled' && task.type === 'timer').length,
    manual: state.tasks.filter(task => task.kind === 'manual').length,
    disabled: state.tasks.filter(task => task.kind === 'disabled').length,
  }
  $$('#typeFilter button[data-type]').forEach((button) => {
    let badge = button.querySelector('.chip-count')
    if (!badge) {
      badge = document.createElement('span')
      badge.className = 'chip-count'
      button.appendChild(badge)
    }
    badge.textContent = String(counts[button.dataset.type] ?? 0)
  })
}

function renderTable() {
  const d = state.derived
  const search = state.search.trim().toLowerCase()
  const stat = task => d.taskStats.get(task.id) ?? { instances: 0, checks: 0, minutes: 0 }
  let tasks = [...state.tasks]

  if (search) {
    tasks = tasks.filter(task => task.name.toLowerCase().includes(search) || task.group.toLowerCase().includes(search))
  }
  if (state.typeFilter === 'period') tasks = tasks.filter(task => task.kind === 'scheduled' && task.type !== 'timer')
  if (state.typeFilter === 'timer') tasks = tasks.filter(task => task.kind === 'scheduled' && task.type === 'timer')
  if (state.typeFilter === 'manual') tasks = tasks.filter(task => task.kind === 'manual')
  if (state.typeFilter === 'disabled') tasks = tasks.filter(task => task.kind === 'disabled')
  if (state.filter === 'executed') tasks = tasks.filter(task => stat(task).instances + stat(task).checks > 0)
  if (state.filter === 'scheduled') tasks = tasks.filter(task => task.kind === 'scheduled')
  if (state.filter === 'alert') tasks = tasks.filter(task => isAlertTask(task))
  if (state.filter === 'estimate') tasks = tasks.filter(task => task.kind === 'scheduled' && durationOf(task).source === 'estimate')
  if (state.filter === 'unscheduled') tasks = tasks.filter(task => task.kind !== 'scheduled')
  if (state.filter === 'conditional') tasks = tasks.filter(task => Boolean(conditionalOf(task)))
  if (state.filter === 'hourly') tasks = tasks.filter(task => task.kind === 'scheduled' && task.spec && task.spec.hours.size === 24)

  const compare = (a, b) => {
    switch (state.sortKey) {
      case 'name': return a.name.localeCompare(b.name, 'zh-CN')
      case 'group': return (a.group || '').localeCompare(b.group || '', 'zh-CN')
      case 'duration': return durationOf(a).minutes - durationOf(b).minutes
      case 'instances': return stat(a).instances - stat(b).instances
      case 'status': return (STATUS_RANK[statusOf(a)[0]] ?? 9) - (STATUS_RANK[statusOf(b)[0]] ?? 9)
      default: return stat(a).minutes - stat(b).minutes
    }
  }
  tasks.sort((a, b) => {
    const result = compare(a, b)
    if (result !== 0) return state.sortDir === 'asc' ? result : -result
    return a.name.localeCompare(b.name, 'zh-CN')
  })

  const maxLoad = Math.max(1, ...tasks.map(task => stat(task).minutes))
  const rows = tasks.map((task) => {
    const duration = durationOf(task)
    const stats = stat(task)
    const conditional = conditionalOf(task)
    const srcClass = duration.source === 'median' ? 'is-median' : duration.source === 'mean' ? 'is-mean' : duration.source === 'manual' ? 'is-manual' : 'is-estimate'
    const srcLabel = duration.source === 'median' ? '中位' : duration.source === 'mean' ? '均值' : duration.source === 'manual' ? '手填' : '估算'
    const srcText = `${srcLabel}${duration.n ? ` n=${duration.n}` : ''}`
    const recordStats = state.overrides[task.id]?.stats
    const statsTitle = recordStats
      ? `执行记录：中位 ${fmtDur(recordStats.median)} · 均值 ${fmtDur(recordStats.mean)} · ${recordStats.n} 条`
      : ''
    const status = statusOf(task)
    const schedule = task.kind === 'scheduled'
      ? task.label
      : task.kind === 'manual' ? '手动触发' : task.kind === 'disabled' ? '已停用' : task.label
    const conditionNote = conditional
      ? `<span class="sep"></span><span class="t-cond">每 ${fmtNum(conditional.periodHours)} 小时实跑 · 检查 ${fmtNum(conditional.checkSeconds)} 秒</span>`
      : ''

    return `<tr data-task="${esc(task.id)}" class="${state.highlight === task.id ? 'is-focus' : ''}">
      <td>
        <div class="t-name">
          <i class="t-dot" style="background:${colorOf(task.name)}"></i>
          <div style="min-width:0">
            <div class="t-title" title="${esc(task.name)}">${esc(task.name)}</div>
            <div class="t-sub"><span>${esc(schedule)}</span>${conditionNote}${task.nextExecuteTime ? `<span class="sep"></span><span>下次 ${esc(task.nextExecuteTime.slice(5, 16))}</span>` : ''}</div>
            <div class="t-mobile">${task.kind === 'scheduled' ? `${esc(fmtDur(duration.minutes))} · ${srcText} · ` : ''}${stats.instances ? `${stats.instances} 次 · ` : ''}${status[1]}</div>
          </div>
        </div>
      </td>
      <td><span class="t-group">${esc(task.group || '—')}</span></td>
      <td class="ta-r">
        ${task.kind === 'scheduled'
          ? `<button type="button" class="dur-btn" data-dur="${esc(task.id)}" title="${statsTitle ? `${statsTitle}；点击修改` : conditional ? '条件任务：实跑时长（检查不计入）' : '点击设置执行时长'}">${esc(fmtDur(duration.minutes))}${conditional ? '<span class="src is-conditional">实跑</span>' : ''}<span class="src ${srcClass}">${srcText}</span></button>`
          : '<span class="t-num" style="color:#98a2b3">—</span>'}
      </td>
      <td class="ta-r"><span class="t-num" title="${stats.checks ? `另有 ${stats.checks} 次心跳检查` : ''}">${stats.instances || '—'}${stats.instances ? ' <small>次</small>' : ''}</span></td>
      <td class="ta-r">
        <div class="t-num">${stats.minutes ? (stats.minutes >= 60 ? `${(stats.minutes / 60).toFixed(1)} <small>小时</small>` : `${Math.round(stats.minutes)} <small>分</small>`) : '—'}</div>
        <div class="t-load-bar"><i style="width:${((stats.minutes / maxLoad) * 100).toFixed(1)}%"></i></div>
      </td>
      <td><span class="status-pill ${status[0]}">${status[1]}</span></td>
    </tr>`
  })

  $('#taskRows').innerHTML = rows.length
    ? rows.join('')
    : '<tr class="is-empty-row"><td colspan="6" style="padding:28px 20px;color:#98a2b3;text-align:center">没有符合条件的任务</td></tr>'

  const alertCount = state.tasks.filter(isAlertTask).length
  const conditionalCount = state.tasks.filter(task => conditionalOf(task)).length
  const estimateCount = state.tasks.filter(task => task.kind === 'scheduled' && durationOf(task).source === 'estimate').length
  $('#taskMeta').textContent = `共 ${state.tasks.length} 个计划 · 参与排期 ${d.scheduledCount} · 条件任务 ${conditionalCount} · 超载相关 ${alertCount} · 待校准 ${estimateCount}`
  renderTypeCounts()
  renderSortMarks()
}

/* ------------------------------------------------------------------ */
/* 总渲染                                                              */
/* ------------------------------------------------------------------ */

function renderAll() {
  compute()
  renderStatus()
  renderKpis()
  renderTabs()
  renderTimelineMeta()
  renderChart()
  renderLanes()
  renderOverload()
  renderHeatmap()
  renderDaily()
  renderTable()
  syncControls()
}

function syncControls() {
  $('#capValue').textContent = String(state.capacity)
  $('#fallbackInput').value = String(state.fallback)
  $$('#rangeGroup button').forEach(btn => btn.classList.toggle('is-active', Number(btn.dataset.days) === state.rangeDays))
  $$('#taskFilter button').forEach(btn => btn.classList.toggle('is-active', btn.dataset.filter === state.filter))
  $$('#typeFilter button').forEach(btn => btn.classList.toggle('is-active', btn.dataset.type === state.typeFilter))
  $('#taskSearch').value = state.search
}

/* ------------------------------------------------------------------ */
/* 选择与高亮                                                          */
/* ------------------------------------------------------------------ */

function selectDay(index) {
  if (index == null) return
  const next = clamp(Number(index), 0, state.rangeDays - 1)
  if (next === state.dayIndex) return
  state.dayIndex = next
  renderTabs()
  renderTimelineMeta()
  renderChart()
  renderLanes()
  renderOverload()
  renderDaily()
}

function toggleHighlight(taskId) {
  if (!taskId) return
  state.highlight = state.highlight === taskId ? null : taskId
  app.classList.toggle('has-focus', Boolean(state.highlight))
  renderChart()
  renderLanes()
  renderOverload()
  renderTable()
}

/* ------------------------------------------------------------------ */
/* 弹层                                                                */
/* ------------------------------------------------------------------ */

let closeCurrentModal = null

function openModal(html, onMount) {
  const root = $('#modalRoot')
  root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`
  const backdrop = root.firstElementChild
  const close = () => {
    root.innerHTML = ''
    closeCurrentModal = null
    app.style.overflow = ''
  }
  closeCurrentModal = close
  app.style.overflow = 'hidden'
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close()
  })
  backdrop.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', close))
  if (onMount) onMount(backdrop, close)
  const focusable = [...backdrop.querySelectorAll('input, textarea')].find(el => el.offsetParent !== null)
    ?? backdrop.querySelector('button')
  if (focusable) setTimeout(() => focusable.focus({ preventScroll: true }), 20)
  return { root: backdrop, close }
}

function openConnectModal() {
  const remember = Boolean(localStorage.getItem(TOKEN_KEY))
  const { root, close } = openModal(`
    <div class="modal-head">
      <div>
        <h3>连接影刀控制台</h3>
        <p>Token 每天更新，粘贴当天的值即可；只会保存在这台电脑的浏览器里。</p>
      </div>
      <button type="button" class="modal-close" data-close aria-label="关闭">×</button>
    </div>
    <div class="modal-body">
      <div class="field">
        <label for="fToken">Authorization Token</label>
        <input class="input" id="fToken" type="password" placeholder="粘贴 Bearer 后面的值" autocomplete="off" spellcheck="false" value="${esc(state.api.token)}" />
        <span class="hint">控制台按 F12 → Network → 任意 api.yingdao.com 请求 → Request Headers 里的 <code>authorization</code>，去掉 “Bearer ” 前缀。</span>
      </div>
      <div class="field">
        <label for="fCredential">x-credential <span style="color:#98a2b3;font-weight:400">（可选）</span></label>
        <input class="input" id="fCredential" type="text" placeholder="接口文档里出现的 x-credential" autocomplete="off" spellcheck="false" value="${esc(state.api.credential)}" />
        <span class="hint">如果接口返回 401/403，把控制台请求头里的 x-credential 也填进来。</span>
      </div>
      <label class="check"><input type="checkbox" id="fRemember" ${remember ? 'checked' : ''} /><span>在这台电脑记住 Token（下次打开自动连接）</span></label>
      <div class="notice info">
        计划列表由浏览器直接读取影刀接口，Token 只保存在这台电脑的浏览器里。
      </div>
      <div class="field" id="fError" hidden></div>
    </div>
    <div class="modal-foot">
      <button type="button" class="btn" data-demo>先用演示数据</button>
      <button type="button" class="btn btn-primary" data-connect>连接并加载</button>
    </div>
  `)

  const error = root.querySelector('#fError')
  const button = root.querySelector('[data-connect]')

  root.querySelector('[data-demo]').addEventListener('click', () => {
    close()
    applyDemo()
    toast('已切换到演示数据')
  })

  const submit = async () => {
    const token = root.querySelector('#fToken').value.trim().replace(/^Bearer\s+/i, '')
    const credential = root.querySelector('#fCredential').value.trim()
    const rememberIt = root.querySelector('#fRemember').checked
    error.hidden = true
    if (!token) {
      error.hidden = false
      error.className = 'field form-error'
      error.textContent = '请先填入 Token。'
      return
    }
    button.disabled = true
    button.textContent = '连接中…'
    state.api.token = token
    state.api.credential = credential
    try {
      const schedules = await fetchAllSchedules()
      persistToken(rememberIt, token, credential)
      applyLive(schedules)
      close()
      toast(`已加载 ${schedules.length} 个计划`)
    } catch (err) {
      error.hidden = false
      error.className = 'field form-error'
      error.textContent = explainError(err)
      button.disabled = false
      button.textContent = '连接并加载'
    }
  }

  button.addEventListener('click', submit)
  root.querySelector('#fToken').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit()
  })
}

function openDurationModal(task) {
  const override = state.overrides[task.id] ?? {}
  const mode = override.mode === 'manual' ? 'manual' : override.mode === 'mean' ? 'mean' : 'median'
  const conditional = override.conditional
  const samples = (Array.isArray(override.samples) ? override.samples : []).map(fmtSample).join(', ')
  const manual = Number.isFinite(Number(override.manual)) ? String(override.manual) : ''
  const triggerPerDay = task.spec ? C.occurrences(task.spec, state.rangeStart, C.addDays(state.rangeStart, 1)).length : 0

  const defaultAnchor = () => {
    const date = new Date()
    date.setHours(8, 0, 0, 0)
    if (date.getTime() > Date.now()) date.setDate(date.getDate() - 1)
    return date
  }
  const anchorValue = (() => {
    const date = new Date(conditional?.nextRunAt ?? defaultAnchor().getTime())
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  })()

  const { root, close } = openModal(`
    <div class="modal-head">
      <div>
        <h3>设置执行时长</h3>
        <p>${esc(task.name)}</p>
      </div>
      <button type="button" class="modal-close" data-close aria-label="关闭">×</button>
    </div>
    <div class="modal-body">
      ${triggerPerDay >= 12 ? `<div class="notice info">这个任务每天触发 ${triggerPerDay} 次。如果它只是巡检、到点才真正执行，请勾选下面的「条件任务」。</div>` : ''}
      <div class="cond-toggle">
        <label class="check"><input type="checkbox" id="fConditional" ${conditional ? 'checked' : ''} /><span>条件任务：每次只做快速检查，到点才真正执行</span></label>
      </div>
      <div class="cond-pane" id="fCondPane" ${conditional ? '' : 'hidden'}>
        <div class="cond-grid">
          <div class="field">
            <span class="field-label">检查耗时</span>
            <label class="num-field"><input id="fCheckSeconds" type="number" min="0" max="600" step="1" value="${conditional?.checkSeconds ?? 5}" /><span>秒</span></label>
          </div>
          <div class="field">
            <span class="field-label">实跑周期</span>
            <label class="num-field"><input id="fPeriodHours" type="number" min="1" max="720" step="1" value="${conditional?.periodHours ?? 25}" /><span>小时</span></label>
          </div>
        </div>
        <div class="field">
          <label for="fNextRun">最近一次实际执行时间</label>
          <input class="input" id="fNextRun" type="datetime-local" value="${anchorValue}" />
          <span class="hint">按这个时间和周期向前后推算；到点后的第一次触发会执行完整任务。</span>
        </div>
      </div>
      <div class="mode-switch" role="tablist">
        <button type="button" data-mode="median" class="${mode === 'median' ? 'is-active' : ''}">中位数</button>
        <button type="button" data-mode="mean" class="${mode === 'mean' ? 'is-active' : ''}">平均值</button>
        <button type="button" data-mode="manual" class="${mode === 'manual' ? 'is-active' : ''}">手动指定</button>
      </div>
      <div class="field" data-pane="median">
        <label for="fSamples" id="fSamplesLabel">历史耗时样本（分钟）</label>
        <textarea class="textarea" id="fSamples" placeholder="例如：12, 15, 13.5&#10;也支持 3分12秒 / 00:03:12">${esc(samples)}</textarea>
        <span class="hint" id="fSamplesHint">每行或逗号分隔；系统取这些样本的中位数，作为每次执行的占机时长。</span>
      </div>
      <div class="stat-grid">
        <div class="stat" data-stat="median"><span>中位数</span><b id="fMedian">—</b></div>
        <div class="stat" data-stat="mean"><span>平均值</span><b id="fMean">—</b></div>
        <div class="stat" data-stat="count"><span>样本</span><b id="fCount">0</b></div>
      </div>
      <div class="form-ok" id="fIgnored" hidden></div>
      <div class="field" data-pane="manual" hidden>
        <label for="fManual">固定时长（分钟）</label>
        <input class="input" id="fManual" type="number" min="0.5" step="0.5" value="${esc(manual)}" />
        <span class="hint">填写后忽略样本，所有实跑实例都按这个时长计算。</span>
      </div>
    </div>
    <div class="modal-foot">
      <button type="button" class="btn" data-clear>清除设置</button>
      <button type="button" class="btn btn-primary" data-save>保存</button>
    </div>
  `)

  let currentMode = mode
  const conditionalEl = root.querySelector('#fConditional')
  const paneEl = root.querySelector('#fCondPane')
  const checkEl = root.querySelector('#fCheckSeconds')
  const periodEl = root.querySelector('#fPeriodHours')
  const nextRunEl = root.querySelector('#fNextRun')
  const medianEl = root.querySelector('#fMedian')
  const meanEl = root.querySelector('#fMean')
  const countEl = root.querySelector('#fCount')
  const samplesEl = root.querySelector('#fSamples')
  const manualEl = root.querySelector('#fManual')
  const samplesLabel = root.querySelector('#fSamplesLabel')
  const samplesHint = root.querySelector('#fSamplesHint')
  const ignoredEl = root.querySelector('#fIgnored')

  const parseSamples = () =>
    samplesEl.value
      .split(/[\s,，;；]+/)
      .map(item => C.parseDurationText(item))
      .filter(value => Number.isFinite(value) && value > 0)

  /** 条件任务把小于 30 秒的样本视为心跳检查，不参与实跑统计。 */
  const effectiveSamples = () => {
    const all = parseSamples()
    if (!conditionalEl.checked) return { samples: all, ignored: 0 }
    const long = all.filter(value => value >= 0.5)
    return { samples: long, ignored: all.length - long.length }
  }

  const refresh = () => {
    const isConditional = conditionalEl.checked
    paneEl.hidden = !isConditional
    const { samples: effective, ignored } = effectiveSamples()
    const middle = C.median(effective)
    const mean = effective.length ? effective.reduce((sum, value) => sum + value, 0) / effective.length : null
    const text = value => fmtStat(value)
    medianEl.textContent = text(middle)
    meanEl.textContent = text(mean)
    countEl.textContent = String(effective.length)
    root.querySelectorAll('[data-stat]').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.stat === currentMode)
    })
    ignoredEl.hidden = !isConditional || ignored === 0
    ignoredEl.textContent = ignored ? `已忽略 ${ignored} 条不足 30 秒的检查样本` : ''
    samplesLabel.textContent = isConditional ? '实跑耗时样本（分钟）' : '历史耗时样本（分钟）'
    samplesHint.textContent = isConditional
      ? '只填真正执行时的耗时；不足 30 秒的样本会按心跳检查忽略。'
      : '每行或逗号分隔；也可以用右上角「从执行记录估算」自动填入最近 30 天的记录。'
    root.querySelectorAll('[data-pane]').forEach((pane) => {
      const active = pane.dataset.pane === (currentMode === 'manual' ? 'manual' : 'median')
      pane.hidden = !active
    })
    root.querySelectorAll('[data-mode]').forEach(btn => btn.classList.toggle('is-active', btn.dataset.mode === currentMode))
  }

  root.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentMode = btn.dataset.mode
      refresh()
    })
  })
  conditionalEl.addEventListener('change', refresh)
  samplesEl.addEventListener('input', refresh)
  manualEl.addEventListener('input', refresh)
  refresh()

  root.querySelector('[data-clear]').addEventListener('click', () => {
    const { [task.id]: _removed, ...rest } = state.overrides
    state.overrides = rest
    savePrefs()
    close()
    renderAll()
    toast('已清除该任务的时长设置')
  })

  root.querySelector('[data-save]').addEventListener('click', () => {
    const { samples: parsed } = effectiveSamples()
    const manualValue = Number(manualEl.value)
    if (currentMode === 'manual' && !(manualValue > 0)) {
      manualEl.focus()
      toast('请填写大于 0 的分钟数', 'err')
      return
    }
    if (currentMode !== 'manual' && !parsed.length) {
      samplesEl.focus()
      toast('至少填写一个实跑耗时样本', 'err')
      return
    }
    let nextConditional
    if (conditionalEl.checked) {
      const periodHours = Number(periodEl.value)
      const checkSeconds = Number(checkEl.value)
      const nextRunAt = new Date(nextRunEl.value).getTime()
      if (!(periodHours > 0)) {
        periodEl.focus()
        toast('实跑周期需要大于 0 小时', 'err')
        return
      }
      if (!Number.isFinite(nextRunAt)) {
        nextRunEl.focus()
        toast('请选择一个新的到点时刻', 'err')
        return
      }
      nextConditional = {
        periodHours: Math.round(periodHours * 100) / 100,
        checkSeconds: Math.max(0, Math.round(Number(checkSeconds) || 0)),
        nextRunAt,
      }
    }
    const previousStats = state.overrides[task.id]?.stats
    const middle = C.median(parsed)
    const mean = parsed.length ? parsed.reduce((sum, value) => sum + value, 0) / parsed.length : null
    const stats = parsed.length && middle != null && mean != null
      ? { median: middle, mean, n: parsed.length, syncedAt: previousStats?.syncedAt ?? Date.now() }
      : undefined
    state.overrides[task.id] = {
      mode: currentMode,
      samples: parseSamples(),
      manual: Number.isFinite(manualValue) && manualValue > 0 ? manualValue : undefined,
      ...(stats ? { stats } : {}),
      ...(nextConditional ? { conditional: nextConditional } : {}),
    }
    savePrefs()
    close()
    renderAll()
    toast(nextConditional ? '条件任务已更新' : '执行时长已更新')
  })
}

function openBulkModal() {
  const { root, close } = openModal(`
    <div class="modal-head">
      <div>
        <h3>批量录入执行时长</h3>
        <p>每行一个任务，格式：任务名, 耗时</p>
      </div>
      <button type="button" class="modal-close" data-close aria-label="关闭">×</button>
    </div>
    <div class="modal-body">
      <div class="field">
        <label for="fBulk">任务名与耗时</label>
        <textarea class="textarea" id="fBulk" style="min-height:150px" placeholder="财务_报告库下载（延迟、北美）_数据获取, 41&#10;物流_领星订单审核发货_业务操作, 66&#10;客服_亚马逊取消订单_每晚八点, 3分12秒"></textarea>
        <span class="hint">任务名可以只写一部分（能唯一匹配即可）。冒号、制表符同样可用。样本会追加到已有记录里，并按中位数计算。</span>
      </div>
      <div class="form-ok" id="fBulkInfo" hidden></div>
    </div>
    <div class="modal-foot">
      <button type="button" class="btn" data-close>取消</button>
      <button type="button" class="btn btn-primary" data-apply>解析并写入</button>
    </div>
  `)

  const textarea = root.querySelector('#fBulk')
  const info = root.querySelector('#fBulkInfo')

  const parseLines = () => textarea.value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = Math.max(line.lastIndexOf(','), line.lastIndexOf('，'), line.lastIndexOf('\t'), line.lastIndexOf('：'))
      if (index <= 0) return null
      const name = line.slice(0, index).trim()
      const minutes = C.parseDurationText(line.slice(index + 1).trim())
      if (!name || !Number.isFinite(minutes) || minutes <= 0) return null
      return { name, minutes }
    })
    .filter(Boolean)

  textarea.addEventListener('input', () => {
    const rows = parseLines()
    info.hidden = !rows.length
    info.textContent = rows.length ? `已识别 ${rows.length} 行` : ''
  })

  root.querySelector('[data-apply]').addEventListener('click', () => {
    const rows = parseLines()
    if (!rows.length) {
      toast('没有识别到有效行，请检查格式', 'err')
      return
    }
    let matched = 0
    const unmatched = []
    for (const row of rows) {
      const target = state.tasks.find(task => task.name === row.name)
        ?? state.tasks.find(task => task.name.includes(row.name))
        ?? state.tasks.find(task => row.name.includes(task.name))
      if (!target) {
        unmatched.push(row.name)
        continue
      }
      const current = state.overrides[target.id] ?? { mode: 'median', samples: [] }
      const samples = [...(Array.isArray(current.samples) ? current.samples : []), row.minutes]
      state.overrides[target.id] = { ...current, mode: 'median', samples }
      matched += 1
    }
    savePrefs()
    close()
    renderAll()
    toast(`已写入 ${matched} 个任务${unmatched.length ? `，${unmatched.length} 行未匹配` : ''}`)
  })
}

/* ------------------------------------------------------------------ */
/* 导入导出                                                            */
/* ------------------------------------------------------------------ */

function exportConfig() {
  const payload = {
    app: 'yingdao-capacity',
    version: 1,
    exportedAt: new Date().toISOString(),
    capacity: state.capacity,
    fallback: state.fallback,
    rangeDays: state.rangeDays,
    overrides: state.overrides,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  a.href = url
  a.download = `影刀容量配置-${stamp}.json`
  a.click()
  URL.revokeObjectURL(url)
  toast('配置已导出')
}

async function importConfig(file) {
  try {
    const text = await file.text()
    const data = JSON.parse(text)
    if (!data || typeof data !== 'object') throw new Error('文件内容不是对象')
    if (Number.isFinite(data.capacity)) state.capacity = clamp(Math.round(data.capacity), 1, 12)
    if (Number.isFinite(data.fallback)) state.fallback = clamp(Math.round(data.fallback), 1, 600)
    if ([7, 14].includes(data.rangeDays)) state.rangeDays = data.rangeDays
    if (data.overrides && typeof data.overrides === 'object') {
      state.overrides = { ...state.overrides, ...data.overrides }
    }
    savePrefs()
    renderAll()
    toast('配置已导入')
  } catch (err) {
    toast(`导入失败：${err.message}`, 'err')
  }
}

/* ------------------------------------------------------------------ */
/* Tooltip                                                             */
/* ------------------------------------------------------------------ */

function initTooltip() {
  const tip = $('#tooltip')
  app.addEventListener('pointerover', (event) => {
    const target = event.target.closest?.('[data-tip]')
    if (!target) return
    tip.textContent = target.dataset.tip
    tip.hidden = false
    const rect = target.getBoundingClientRect()
    const y = rect.top > 90 ? rect.top - 10 : rect.bottom + 10
    tip.style.left = '0px'
    tip.style.top = `${Math.max(8, y)}px`
    const width = tip.offsetWidth
    tip.style.left = `${clamp(event.clientX - width / 2, 8, window.innerWidth - width - 8)}px`
    tip.style.transform = rect.top > 90 ? 'translateY(-100%)' : 'none'
  })
  app.addEventListener('pointerout', (event) => {
    const target = event.target.closest?.('[data-tip]')
    if (!target) return
    if (event.relatedTarget && target.contains(event.relatedTarget)) return
    tip.hidden = true
  })
  const hideTip = () => { tip.hidden = true }
  window.addEventListener('scroll', hideTip, { passive: true })
  cleanupFns.push(() => window.removeEventListener('scroll', hideTip))
}

/* ------------------------------------------------------------------ */
/* 从执行记录估算                                                       */
/* ------------------------------------------------------------------ */

function syncTargets() {
  return state.tasks.filter(task => task.kind === 'scheduled' && !String(task.id).startsWith('demo-'))
}

function openSyncConfirm() {
  if (!state.api.token) {
    openConnectModal()
    return
  }
  if (state.source !== 'live') {
    toast('请先「连接影刀」或刷新，加载真实计划后再同步')
    return
  }
  const targets = syncTargets()
  if (!targets.length) {
    toast('没有可同步的计划')
    return
  }
  const { root, close } = openModal(`
    <div class="modal-head">
      <div>
        <h3>从执行记录估算时长</h3>
        <p>最近 30 天 · 每个计划最近 40 次完成记录</p>
      </div>
      <button type="button" class="modal-close" data-close aria-label="关闭">×</button>
    </div>
    <div class="modal-body">
      <div class="notice info">将读取 ${targets.length} 个计划的执行记录（约 ${targets.length} 次请求），只更新本机时长样本，不会修改影刀上的计划。</div>
      <p class="hint">只统计「完成」且运行时长大于 0 的记录；条件任务中不足 30 秒的记录按心跳检查忽略。同步后可在任务行里切换中位数 / 平均值。</p>
    </div>
    <div class="modal-foot">
      <button type="button" class="btn" data-close>取消</button>
      <button type="button" class="btn btn-primary" data-start>开始估算</button>
    </div>
  `)
  root.querySelector('[data-start]').addEventListener('click', () => {
    close()
    void syncDurations(targets)
  })
}

async function syncDurations(targets) {
  const button = $('#btnSyncRecords')
  const original = button ? button.textContent : ''
  if (button) {
    button.disabled = true
    button.textContent = `读取 0/${targets.length}…`
  }
  const to = Date.now()
  const from = to - 30 * 86400000
  const queue = [...targets]
  let done = 0
  let updated = 0
  let records = 0
  let empty = 0
  let failed = 0
  let fatal = null

  const worker = async () => {
    while (queue.length > 0 && !fatal) {
      const task = queue.shift()
      try {
        const samples = await fetchTaskSamples(task.id, from, to)
        const conditional = state.overrides[task.id]?.conditional
        const effective = conditional ? samples.filter(value => value >= 0.5) : samples
        if (effective.length > 0) {
          const middle = C.median(effective)
          const mean = effective.reduce((sum, value) => sum + value, 0) / effective.length
          state.overrides[task.id] = {
            ...(state.overrides[task.id] ?? {}),
            samples: samples.map(value => Math.round(value * 1000) / 1000),
            stats: { median: middle, mean, n: effective.length, syncedAt: Date.now() },
          }
          updated += 1
          records += effective.length
        } else {
          empty += 1
        }
      } catch (error) {
        failed += 1
        if (/401|403|未认证|token|权限/i.test(String(error?.message || error))) fatal = error
      }
      done += 1
      if (button) button.textContent = `读取 ${done}/${targets.length}…`
    }
  }

  await Promise.all([worker(), worker(), worker()])
  savePrefs()
  renderAll()
  if (button) {
    button.disabled = false
    button.textContent = original
  }
  if (fatal) {
    toast(explainError(fatal), 'err')
  } else {
    toast(`已用 ${records} 条执行记录更新 ${updated} 个任务${empty ? `，${empty} 个暂无记录` : ''}${failed ? `，${failed} 个失败` : ''}`)
  }
}

/* ------------------------------------------------------------------ */
/* 刷新                                                                */
/* ------------------------------------------------------------------ */

async function refresh() {
  if (!state.api.token) {
    openConnectModal()
    return
  }
  const button = $('#btnRefresh')
  button.disabled = true
  button.textContent = '同步中…'
  try {
    const schedules = await fetchAllSchedules()
    applyLive(schedules)
    toast(`已刷新 ${schedules.length} 个计划`)
  } catch (err) {
    toast(explainError(err), 'err')
  } finally {
    button.disabled = false
    button.textContent = '刷新'
  }
}

/* ------------------------------------------------------------------ */
/* 事件绑定                                                            */
/* ------------------------------------------------------------------ */

function bindEvents() {
  $('#rangeGroup').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-days]')
    if (!button) return
    state.rangeDays = Number(button.dataset.days)
    state.dayIndex = clamp(state.dayIndex, 0, state.rangeDays - 1)
    savePrefs()
    renderAll()
  })

  $('#capMinus').addEventListener('click', () => {
    state.capacity = clamp(state.capacity - 1, 1, 12)
    savePrefs()
    renderAll()
  })
  $('#capPlus').addEventListener('click', () => {
    state.capacity = clamp(state.capacity + 1, 1, 12)
    savePrefs()
    renderAll()
  })
  $('#fallbackInput').addEventListener('change', (event) => {
    const value = Number(event.target.value)
    if (Number.isFinite(value) && value > 0) {
      state.fallback = clamp(Math.round(value), 1, 600)
      savePrefs()
      renderAll()
    }
  })

  const onSearch = debounce((value) => {
    state.search = value
    renderTable()
  }, 120)
  $('#taskSearch').addEventListener('input', event => onSearch(event.target.value))

  $('#taskFilter').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-filter]')
    if (!button) return
    state.filter = button.dataset.filter
    $$('#taskFilter button').forEach(item => item.classList.toggle('is-active', item === button))
    savePrefs()
    renderTable()
  })

  $('#typeFilter').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-type]')
    if (!button) return
    state.typeFilter = button.dataset.type
    $$('#typeFilter button').forEach(item => item.classList.toggle('is-active', item === button))
    savePrefs()
    renderTable()
  })

  $('.task-table thead').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-sort]')
    if (!button) return
    const key = button.dataset.sort
    if (key === state.sortKey) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc'
    } else {
      state.sortKey = key
      state.sortDir = key === 'name' || key === 'group' || key === 'status' ? 'asc' : 'desc'
    }
    savePrefs()
    renderTable()
  })

  $('#dayTabs').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-day]')
    if (tab) selectDay(tab.dataset.day)
  })

  $('#heatmap').addEventListener('click', (event) => {
    const cell = event.target.closest('[data-day]')
    if (cell) selectDay(cell.dataset.day)
  })
  $('#heatmap').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const cell = event.target.closest('[data-day]')
    if (cell) {
      event.preventDefault()
      selectDay(cell.dataset.day)
    }
  })

  $('#dailyList').addEventListener('click', (event) => {
    const row = event.target.closest('[data-day]')
    if (row) selectDay(row.dataset.day)
  })

  $('#overloadList').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-task]')
    if (chip) {
      toggleHighlight(chip.dataset.task)
      return
    }
    const jump = event.target.closest('[data-goto-day]')
    if (jump) selectDay(jump.dataset.gotoDay)
  })

  $('#taskRows').addEventListener('click', (event) => {
    const durationButton = event.target.closest('[data-dur]')
    if (durationButton) {
      event.stopPropagation()
      const task = state.tasks.find(item => item.id === durationButton.dataset.dur)
      if (task) openDurationModal(task)
      return
    }
    const row = event.target.closest('tr[data-task]')
    if (row) toggleHighlight(row.dataset.task)
  })

  $('#laneHost').addEventListener('click', (event) => {
    const block = event.target.closest('[data-task]')
    if (block) toggleHighlight(block.dataset.task)
  })

  $('#btnConnect').addEventListener('click', openConnectModal)
  $('#btnRefresh').addEventListener('click', refresh)
  $('#btnSyncRecords').addEventListener('click', openSyncConfirm)
  $('#btnBulkDuration').addEventListener('click', openBulkModal)
  $('#btnExport').addEventListener('click', exportConfig)
  $('#btnImport').addEventListener('click', () => $('#fileInput').click())
  $('#fileInput').addEventListener('change', (event) => {
    const file = event.target.files?.[0]
    if (file) importConfig(file)
    event.target.value = ''
  })

  app.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (closeCurrentModal) closeCurrentModal()
      if (state.highlight) toggleHighlight(state.highlight)
    }
  })

  const onResize = debounce(() => {
    renderChart()
    renderLanes()
  }, 140)
  if (window.ResizeObserver) {
    resizeObserver = new ResizeObserver(onResize)
    resizeObserver.observe($('.timeline-card'))
  } else {
    window.addEventListener('resize', onResize)
    cleanupFns.push(() => window.removeEventListener('resize', onResize))
  }
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  loadPrefs()
  bindEvents()
  initTooltip()
  // 只在打开面板时读本地缓存；接口请求留给「刷新」或「连接影刀」。
  if (!applyCached()) applyDemo()
}

export function mountCapacity(host) {
  host.innerHTML = SHELL
  const root = host.querySelector('.ydc-root')
  if (!root) throw new Error('capacity: shell missing')
  app = root
  void boot()
  return {
    destroy() {
      if (closeCurrentModal) closeCurrentModal()
      if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null }
      for (const dispose of cleanupFns.splice(0)) { try { dispose() } catch { /* ignore */ } }
      if (app) app.innerHTML = ''
      app = null
    },
  }
}
