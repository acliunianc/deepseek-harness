/**
 * 影刀计划 → 时间轴 / 并发 / 机器人分配 计算核心。
 * 纯函数，无 DOM 依赖；供容量地图页面使用。
 */

export const MINUTE = 60_000
export const DAY = 86_400_000
export const DEFAULT_DURATION = 15
export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const

/** 解析后的 5 段 cron。 */
export interface CronSpec {
  minutes: Set<number>
  hours: Set<number>
  doms: Set<number>
  months: Set<number>
  dows: Set<number>
  domStar: boolean
  dowStar: boolean
  expression: string
}

/** 接口计划对象的归一化结果。 */
export interface PlanTask {
  id: string
  name: string
  enabled: boolean
  group: string
  robotNames: string[]
  type: string
  rawCron: string
  nextExecuteTime: string
  creator: string
  kind: 'scheduled' | 'manual' | 'disabled' | 'unparsed'
  label: string
  spec: CronSpec | null
}

/** 接口返回的原始计划（只声明用到的字段）。 */
export interface RawSchedule {
  uuid?: string
  name?: string
  type?: string
  enabled?: boolean
  robotClientShowName?: string
  robots?: { robotName?: string; name?: string }[]
  cronInterface?: {
    type?: string
    cronExpress?: string
    time?: string
    hour?: number
    minute?: number
    dayOfWeeks?: number[]
    nextTime?: string
    minimumIntervalSeconds?: number
  }
  nextExecuteTime?: string
  userGrantList?: { userName?: string }[]
}

/** 一次占机（run）或一次心跳检查（check）。 */
export type InstancePhase = 'run' | 'check'

/** 一次执行占用。 */
export interface PlanInstance {
  taskId: string
  start: number
  end: number
  minutes: number
  source: DurationSource
  phase: InstancePhase
}

export type DurationSource = 'median' | 'mean' | 'manual' | 'estimate'

/** 从执行记录算出的统计。 */
export interface DurationStats {
  median: number
  mean: number
  n: number
  syncedAt: number
}

/** 连续并发段。 */
export interface ConcurrencySegment {
  start: number
  end: number
  count: number
  taskIds: string[]
}

/** 机器人分配结果。 */
export interface Assignment {
  taskId: string
  robot: number
  plannedStart: number
  plannedEnd: number
  start: number
  end: number
  delay: number
  phase: InstancePhase
}

/**
 * 条件任务：触发很频繁，但每次只做一次快速检查；只有到点的那次触发才真正执行。
 * `nextRunAt` 是任意一个“到点”时刻，周期按 `periodHours` 向前后推算。
 */
export interface ConditionalPlan {
  /** 每次检查的占机秒数。 */
  checkSeconds: number
  /** 实际执行周期（小时），例如 25。 */
  periodHours: number
  /** 一个已知的到点时刻。 */
  nextRunAt: number
}

/** 用户覆盖的执行时长与条件任务设置。 */
export interface DurationOverride {
  mode?: 'median' | 'mean' | 'manual'
  samples?: number[]
  manual?: number
  conditional?: ConditionalPlan
  /** 最近一次从执行记录同步的统计，仅用于展示。 */
  stats?: DurationStats
}

export function startOfDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function addDays(ms: number, days: number): number {
  const date = new Date(ms)
  date.setDate(date.getDate() + days)
  return date.getTime()
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function hhmm(ms: number): string {
  const date = new Date(ms)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

export function monthDay(ms: number): string {
  const date = new Date(ms)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

export function weekdayLabel(ms: number): string {
  return `周${WEEKDAYS[new Date(ms).getDay()] ?? '日'}`
}

/** "2026-10-08 23:59:59" → 本地时间戳。 */
export function parseDateTime(text: string | undefined): number | null {
  if (!text) return null
  const match = String(text).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (!match) return null
  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  return Number.isNaN(date.getTime()) ? null : date.getTime()
}

function parseCronField(text: string, min: number, max: number, normalize: (value: number) => number = value => value): Set<number> | null {
  const out = new Set<number>()
  for (const rawPart of String(text ?? '').split(',')) {
    const part = rawPart.trim()
    if (!part) continue
    const [rangeText = '', stepText] = part.split('/')
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isInteger(step) || step <= 0) return null

    let low: number
    let high: number
    if (rangeText === '*') {
      low = min
      high = max
    } else if (rangeText.includes('-')) {
      const [startText, endText] = rangeText.split('-')
      low = Number(startText)
      high = Number(endText)
    } else {
      low = Number(rangeText)
      high = stepText === undefined ? low : max
    }
    if (!Number.isInteger(low) || !Number.isInteger(high) || low < min || high > max || low > high) return null
    for (let value = low; value <= high; value += step) out.add(normalize(value))
  }
  return out.size > 0 ? out : null
}

/** 解析 5 段 cron（分 时 日 月 周）；周支持 0-7，7 视作周日。 */
export function parseCron(expression: string): CronSpec | null {
  const parts = String(expression ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length !== 5) return null
  const [minuteText = '', hourText = '', domText = '', monthText = '', dowText = ''] = parts
  const minutes = parseCronField(minuteText, 0, 59)
  const hours = parseCronField(hourText, 0, 23)
  const doms = parseCronField(domText, 1, 31)
  const months = parseCronField(monthText, 1, 12)
  const dows = parseCronField(dowText, 0, 7, value => (value === 7 ? 0 : value))
  if (!minutes || !hours || !doms || !months || !dows) return null
  return {
    minutes,
    hours,
    doms,
    months,
    dows,
    domStar: domText.trim() === '*',
    dowStar: dowText.trim() === '*',
    expression: parts.join(' '),
  }
}

function cronMatchesDay(dayMs: number, spec: CronSpec): boolean {
  const date = new Date(dayMs)
  if (!spec.months.has(date.getMonth() + 1)) return false
  const domOk = spec.doms.has(date.getDate())
  const dowOk = spec.dows.has(date.getDay())
  if (spec.domStar && spec.dowStar) return true
  if (spec.domStar) return dowOk
  if (spec.dowStar) return domOk
  return domOk || dowOk
}

/** 生成 [from, to) 内所有触发时刻（升序）。 */
export function occurrences(spec: CronSpec | null, from: number, to: number): number[] {
  const out: number[] = []
  if (!spec) return out
  const hours = [...spec.hours].sort((left, right) => left - right)
  const minutes = [...spec.minutes].sort((left, right) => left - right)
  for (let day = startOfDay(from); day < to; day = addDays(day, 1)) {
    if (!cronMatchesDay(day, spec)) continue
    for (const hour of hours) {
      for (const minute of minutes) {
        const time = day + hour * 3_600_000 + minute * MINUTE
        if (time >= from && time < to) out.push(time)
      }
    }
  }
  return out
}

function intIn(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value)
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback
}

const ALL_MONTHS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
const ALL_WEEKDAYS = new Set([0, 1, 2, 3, 4, 5, 6])

function dailySpec(hour: number, minute: number): CronSpec {
  return {
    minutes: new Set([minute]),
    hours: new Set([hour]),
    doms: new Set([1]),
    months: new Set(ALL_MONTHS),
    dows: new Set(ALL_WEEKDAYS),
    domStar: true,
    dowStar: true,
    expression: `${minute} ${hour} * * *`,
  }
}

function weeklySpec(dayOfWeeks: number[] | undefined, hour: number, minute: number): CronSpec {
  const days = (Array.isArray(dayOfWeeks) ? dayOfWeeks : [])
    .map(value => Number(value))
    .filter(value => Number.isInteger(value) && value >= 0 && value <= 7)
    .map(value => value % 7)
  const dows = new Set(days.length > 0 ? days : [1])
  return {
    minutes: new Set([minute]),
    hours: new Set([hour]),
    doms: new Set([1]),
    months: new Set(ALL_MONTHS),
    dows,
    domStar: true,
    dowStar: false,
    expression: `${minute} ${hour} * * ${[...dows].join(',')}`,
  }
}

function hoursSet(start: number, step: number): Set<number> {
  const out = new Set<number>()
  for (let hour = start % step; hour < 24; hour += step) out.add(hour)
  return out
}

const DOW_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const

export function cronLabel(spec: CronSpec | null): string {
  if (!spec) return '无法解析'
  const times: string[] = []
  for (const hour of [...spec.hours].sort((left, right) => left - right)) {
    for (const minute of [...spec.minutes].sort((left, right) => left - right)) times.push(`${pad2(hour)}:${pad2(minute)}`)
  }
  if (spec.domStar && spec.dowStar && spec.hours.size === 24) {
    return spec.minutes.size === 1
      ? `每小时 :${pad2([...spec.minutes][0] ?? 0)}`
      : `每小时 ${[...spec.minutes].sort((left, right) => left - right).map(pad2).join('、')} 分`
  }
  let prefix = '每天'
  if (!spec.dowStar) {
    prefix = `每周${[...spec.dows].sort((left, right) => left - right).map(day => DOW_LABELS[day] ?? '日').join('、')}`
  } else if (!spec.domStar) {
    prefix = `每月 ${[...spec.doms].sort((left, right) => left - right).join('、')} 日`
  }
  if (times.length <= 4) return `${prefix} ${times.join(' / ')}`
  return `${prefix} ${times.length} 个时段`
}

/** 接口计划 → 可计算任务。 */
export function normalizeSchedule(raw: RawSchedule): PlanTask {
  const name = String(raw.name ?? '未命名任务').trim()
  const base = {
    id: String(raw.uuid ?? name),
    name,
    enabled: raw.enabled !== false,
    group: String(raw.robotClientShowName ?? ''),
    robotNames: (Array.isArray(raw.robots) ? raw.robots : [])
      .map(robot => robot.robotName ?? robot.name)
      .filter((value): value is string => Boolean(value)),
    type: String(raw.type ?? ''),
    rawCron: String(raw.cronInterface?.cronExpress ?? ''),
    nextExecuteTime: raw.nextExecuteTime ?? raw.cronInterface?.nextTime ?? '',
    creator: raw.userGrantList?.[0]?.userName ?? '',
  }
  if (!base.enabled) return { ...base, kind: 'disabled', label: '已停用', spec: null }

  const cron = raw.cronInterface ?? {}
  const type = String(cron.type || base.type || '').toLowerCase()
  const hour = intIn(cron.hour, 0, 23, 0)
  const minute = intIn(cron.minute, 0, 59, 0)

  if (type === 'manual') return { ...base, kind: 'manual', label: '手动触发', spec: null }

  if (type === 'timer') {
    const at = parseDateTime(cron.time)
    if (at === null) return { ...base, kind: 'unparsed', label: '定时器时间未识别', spec: null }
    const date = new Date(at)
    return {
      ...base,
      kind: 'scheduled',
      label: `仅一次 · ${date.toLocaleString('zh-CN', { hour12: false })}`,
      spec: {
        minutes: new Set([date.getMinutes()]),
        hours: new Set([date.getHours()]),
        doms: new Set([date.getDate()]),
        months: new Set([date.getMonth() + 1]),
        dows: new Set(ALL_WEEKDAYS),
        domStar: false,
        dowStar: true,
        expression: '',
      },
    }
  }

  if (cron.cronExpress) {
    const spec = parseCron(cron.cronExpress)
    if (spec) return { ...base, kind: 'scheduled', label: cronLabel(spec), spec }
  }

  if (type === 'week') {
    const spec = weeklySpec(cron.dayOfWeeks, hour, minute)
    return { ...base, kind: 'scheduled', label: cronLabel(spec), spec }
  }

  if (type === 'hour') {
    const step = intIn(cron.hour, 1, 24, 1)
    const spec: CronSpec = { ...dailySpec(0, minute), hours: hoursSet(0, step), expression: `${minute} */${step} * * *` }
    return {
      ...base,
      kind: 'scheduled',
      label: step === 1 ? `每小时 :${pad2(minute)}` : `每 ${step} 小时 :${pad2(minute)}`,
      spec,
    }
  }

  if (type === 'day' || type === 'daily' || cron.hour !== undefined) {
    const spec = dailySpec(hour, minute)
    return { ...base, kind: 'scheduled', label: cronLabel(spec), spec }
  }

  return { ...base, kind: 'unparsed', label: `未识别的计划类型（${type || '空'}）`, spec: null }
}

export function median(values: number[] | undefined): number | null {
  const numbers = (values ?? []).filter(value => Number.isFinite(value) && value > 0).sort((left, right) => left - right)
  if (numbers.length === 0) return null
  const middle = numbers.length >> 1
  if (numbers.length % 2 === 1) return numbers[middle] ?? null
  const left = numbers[middle - 1]
  const right = numbers[middle]
  return left === undefined || right === undefined ? null : (left + right) / 2
}

const UNIT_MINUTES: Record<string, number> = {
  小时: 60, 时: 60, h: 60, H: 60, 分钟: 1, 分: 1, m: 1, M: 1, 秒: 1 / 60, s: 1 / 60, S: 1 / 60,
}

/** 支持 "12"（分钟）、"3分12秒"、"00:03:12"、"1小时5分"。 */
export function parseDurationText(text: string): number | null {
  const source = String(text ?? '').trim()
  if (!source) return null
  const plain = Number(source)
  if (Number.isFinite(plain)) return plain
  const clock = source.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (clock) {
    const first = Number(clock[1])
    const second = Number(clock[2])
    const third = clock[3] === undefined ? 0 : Number(clock[3])
    return clock[3] === undefined ? first + second / 60 : first * 60 + second + third / 60
  }
  const pattern = /(\d+(?:\.\d+)?)\s*(小时|时|分钟|分|秒|h|H|m|M|s|S)/g
  let total = 0
  let matched = false
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    if (match.index !== last) return null
    total += Number(match[1]) * (UNIT_MINUTES[match[2] ?? ''] ?? 0)
    last = pattern.lastIndex
    matched = true
  }
  if (!matched || last !== source.length) return null
  return total
}

export function resolveDuration(
  task: { id: string },
  overrides: Record<string, DurationOverride>,
  fallback = DEFAULT_DURATION,
): { minutes: number; source: DurationSource; n: number } {
  const override = overrides[task.id]
  const rawSamples = (Array.isArray(override?.samples) ? override.samples : []).filter(value => Number.isFinite(value) && value > 0)
  // 条件任务里不足 30 秒的样本是心跳检查，不能拉低实跑中位数。
  const samples = override?.conditional ? rawSamples.filter(value => value >= 0.5) : rawSamples
  const manual = Number(override?.manual)
  if (override?.mode === 'manual' && Number.isFinite(manual) && manual > 0) {
    return { minutes: manual, source: 'manual', n: samples.length }
  }
  if (samples.length > 0) {
    if (override?.mode === 'mean') {
      const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
      return { minutes: mean, source: 'mean', n: samples.length }
    }
    const middle = median(samples)
    if (middle !== null) return { minutes: middle, source: 'median', n: samples.length }
  }
  if (Number.isFinite(manual) && manual > 0) return { minutes: manual, source: 'manual', n: 0 }
  return { minutes: fallback, source: 'estimate', n: 0 }
}

/**
 * 条件任务真正执行的触发点：把每个“到点”时刻对应到它之后最近的一次触发。
 * 例如每小时触发 + 25 小时周期时，到点时刻每天顺延一小时，实跑落在 08:00、09:00、10:00…
 * @param spec - 触发计划。
 * @param plan - 检查耗时、周期与一个到点时刻。
 * @param from - 区间起点。
 * @param to - 区间终点。
 * @returns 落在 [from, to) 内的实跑触发时间集合。
 */
export function conditionalRunStarts(spec: CronSpec | null, plan: ConditionalPlan, from: number, to: number): Set<number> {
  const starts = new Set<number>()
  if (!spec) return starts
  const period = Math.max(1, plan.periodHours) * 3_600_000
  const lookback = Math.max(period * 2, 48 * 3_600_000)
  const triggers = occurrences(spec, from - lookback, to)
  if (triggers.length === 0) return starts
  const fromK = Math.floor((from - lookback - plan.nextRunAt) / period)
  const toK = Math.ceil((to - plan.nextRunAt) / period)
  for (let k = fromK; k <= toK; k += 1) {
    const due = plan.nextRunAt + k * period
    if (due >= to) break
    if (due < from - lookback) continue
    const trigger = triggers.find(time => time >= due)
    if (trigger !== undefined && trigger >= from && trigger < to) starts.add(trigger)
  }
  return starts
}

/** 展开成占用区间（条件任务包含心跳检查与到点实跑）。 */
export function generateInstances(
  tasks: PlanTask[],
  overrides: Record<string, DurationOverride>,
  from: number,
  to: number,
  fallback = DEFAULT_DURATION,
): PlanInstance[] {
  const out: PlanInstance[] = []
  for (const task of tasks) {
    if (task.kind !== 'scheduled' || !task.spec) continue
    const duration = resolveDuration(task, overrides, fallback)
    if (!(duration.minutes > 0)) continue
    const conditional = overrides[task.id]?.conditional
    const runStarts = conditional ? conditionalRunStarts(task.spec, conditional, from, to) : null
    const checkMinutes = Math.max(1, conditional?.checkSeconds ?? 0) / 60
    for (const start of occurrences(task.spec, from, to)) {
      const isRun = runStarts === null || runStarts.has(start)
      const minutes = isRun ? duration.minutes : checkMinutes
      out.push({
        taskId: task.id,
        start,
        end: start + minutes * MINUTE,
        minutes,
        source: duration.source,
        phase: isRun ? 'run' : 'check',
      })
    }
  }
  out.sort((left, right) => left.start - right.start || left.taskId.localeCompare(right.taskId))
  return out
}

/** 事件扫描：返回连续并发段。 */
export function sweepConcurrency(instances: PlanInstance[]): ConcurrencySegment[] {
  const events: { time: number; delta: number; taskId: string }[] = []
  for (const instance of instances) {
    if (instance.end <= instance.start) continue
    events.push({ time: instance.start, delta: 1, taskId: instance.taskId })
    events.push({ time: instance.end, delta: -1, taskId: instance.taskId })
  }
  events.sort((left, right) => left.time - right.time || left.delta - right.delta)

  const segments: ConcurrencySegment[] = []
  const active = new Map<string, number>()
  let previous: number | null = null
  for (const event of events) {
    if (previous !== null && event.time > previous && active.size > 0) {
      segments.push({ start: previous, end: event.time, count: active.size, taskIds: [...active.keys()] })
    }
    if (event.delta === 1) active.set(event.taskId, (active.get(event.taskId) ?? 0) + 1)
    else {
      const next = (active.get(event.taskId) ?? 1) - 1
      if (next <= 0) active.delete(event.taskId)
      else active.set(event.taskId, next)
    }
    previous = event.time
  }
  return segments
}

export function clipSegments(segments: ConcurrencySegment[], from: number, to: number): ConcurrencySegment[] {
  const out: ConcurrencySegment[] = []
  for (const segment of segments) {
    const start = Math.max(segment.start, from)
    const end = Math.min(segment.end, to)
    if (end > start) out.push({ ...segment, start, end })
  }
  return out
}

/** 超载窗口。 */
export interface OverloadWindow {
  start: number
  end: number
  peak: number
  taskIds: string[]
}

/** 超载窗口（count > capacity），相邻段合并。 */
export function overloadWindows(segments: ConcurrencySegment[], capacity: number): OverloadWindow[] {
  const windows: OverloadWindow[] = []
  for (const segment of segments) {
    if (segment.count <= capacity) continue
    const last = windows[windows.length - 1]
    if (last && last.end === segment.start) {
      last.end = segment.end
      last.peak = Math.max(last.peak, segment.count)
      for (const id of segment.taskIds) if (!last.taskIds.includes(id)) last.taskIds.push(id)
    } else {
      windows.push({ start: segment.start, end: segment.end, peak: segment.count, taskIds: [...segment.taskIds] })
    }
  }
  return windows
}

export function busyMinutes(segments: ConcurrencySegment[], from: number, to: number): number {
  let total = 0
  for (const segment of segments) {
    const start = Math.max(segment.start, from)
    const end = Math.min(segment.end, to)
    if (end > start) total += ((end - start) / MINUTE) * segment.count
  }
  return total
}

/** 贪心分配机器人：优先用刚好空闲的机器人，否则排最早空出来的那台。 */
export function simulate(instances: PlanInstance[], capacity: number): {
  assignments: Assignment[]
  robots: number
  maxDelay: number
  avgDelay: number
  delayedCount: number
  finishAt: number
} {
  const count = Math.max(1, Math.floor(capacity) || 1)
  const robots = Array.from({ length: count }, (_, index) => ({ index, freeAt: Number.NEGATIVE_INFINITY }))
  const assignments: Assignment[] = []
  let maxDelay = 0
  let totalDelay = 0
  let delayedCount = 0

  for (const instance of instances) {
    let best = robots[0]
    if (!best) continue
    for (const robot of robots) {
      if (robot.freeAt <= instance.start && (best.freeAt > instance.start || robot.freeAt > best.freeAt)) best = robot
    }
    for (const robot of robots) {
      if (robot.freeAt > instance.start && robot.freeAt < best.freeAt) best = robot
    }
    const actualStart = Math.max(instance.start, best.freeAt)
    const duration = instance.end - instance.start
    const delay = (actualStart - instance.start) / MINUTE
    if (delay > 0.5) {
      delayedCount += 1
      totalDelay += delay
      maxDelay = Math.max(maxDelay, delay)
    }
    best.freeAt = actualStart + duration
    assignments.push({
      taskId: instance.taskId,
      robot: best.index,
      plannedStart: instance.start,
      plannedEnd: instance.end,
      start: actualStart,
      end: actualStart + duration,
      delay,
      phase: instance.phase,
    })
  }
  return {
    assignments,
    robots: count,
    maxDelay,
    avgDelay: delayedCount ? totalDelay / delayedCount : 0,
    delayedCount,
    finishAt: Math.max(...assignments.map(item => item.end), Number.NEGATIVE_INFINITY),
  }
}

/** 每天 24 小时的峰值并发与超载分钟。 */
export function hourlyProfile(segments: ConcurrencySegment[], dayStart: number, capacity: number): { peak: number; over: number }[] {
  const out: { peak: number; over: number }[] = []
  for (let hour = 0; hour < 24; hour += 1) {
    const from = dayStart + hour * 3_600_000
    const to = from + 3_600_000
    let peak = 0
    let over = 0
    for (const segment of segments) {
      const start = Math.max(segment.start, from)
      const end = Math.min(segment.end, to)
      if (end <= start) continue
      peak = Math.max(peak, segment.count)
      if (segment.count > capacity) over += (end - start) / MINUTE
    }
    out.push({ peak, over })
  }
  return out
}

export function summarize(instances: PlanInstance[], segments: ConcurrencySegment[], capacity: number): {
  instances: number
  peak: number
  gap: number
  overloads: OverloadWindow[]
  overloadedMinutes: number
} {
  const peak = segments.reduce((max, segment) => Math.max(max, segment.count), 0)
  const overloads = overloadWindows(segments, capacity)
  return {
    instances: instances.length,
    peak,
    gap: Math.max(0, peak - capacity),
    overloads,
    overloadedMinutes: overloads.reduce((sum, window) => sum + (window.end - window.start) / MINUTE, 0),
  }
}
