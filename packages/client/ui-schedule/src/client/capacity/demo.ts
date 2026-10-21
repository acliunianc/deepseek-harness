/**
 * 演示数据：结构与影刀 /schedule/list 返回一致，用于未配置 Token 时预览。
 * 任务名取自真实计划，时间与时长经过设计，含早高峰超载与跨午夜任务。
 */
import type { DurationOverride, RawSchedule } from './core.ts'

function task(
  id: string,
  name: string,
  cron: RawSchedule['cronInterface'],
  extra: { enabled?: boolean; group?: string; type?: string } = {},
): RawSchedule {
  return {
    uuid: id,
    name,
    type: extra.type ?? 'period',
    enabled: extra.enabled ?? true,
    robotClientShowName: extra.group ?? '所有机器人组',
    robots: [{ robotName: name.replace(/^[^_]+_/, '') }],
    cronInterface: { minimumIntervalSeconds: 60, dayOfWeeks: [], time: '', ...cron },
    nextExecuteTime: '',
  }
}

const cro = (id: string, name: string, expression: string, extra?: { enabled?: boolean; group?: string }) =>
  task(id, name, { type: 'cron', cronExpress: expression }, extra ?? {})

/** 演示用的一次性定时任务：两天后的 14:00。 */
const timerTime = (() => {
  const date = new Date()
  date.setDate(date.getDate() + 2)
  date.setHours(14, 0, 0, 0)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} 14:00:00`
})()

export const DEMO_SCHEDULES: RawSchedule[] = [
  cro('demo-01', '财务_报告库下载（延迟、北美）_数据获取', '0 8 * * *', { group: '高级机器人组' }),
  cro('demo-02', '财务_报告库下载（延迟、欧盟）_数据获取', '0 8 * * *', { group: '高级机器人组' }),
  cro('demo-03', '财务_报告库下载（交易、北美）_数据获取', '0 8 * * *', { group: '高级机器人组' }),
  cro('demo-04', '财务_报告库下载（交易、欧盟）_数据获取', '0 8 * * *', { group: '高级机器人组' }),
  cro('demo-05', '财务_报告库下载（汇总、北美）_数据获取', '0 8 * * *', { group: '高级机器人组' }),
  cro('demo-06', '财务_报告库下载（汇总、欧盟）_数据获取', '0 8 * * *', { group: '高级机器人组' }),
  cro('demo-07', '物流_亚马逊货件超时提醒_业务处理', '15 8,12,17 * * 1-5'),
  cro('demo-08', '财务_亚马逊广告报告下载_数据准备', '0 9 * * *', { group: '高级机器人组' }),
  cro('demo-09', '财务_亚马逊广告报告生成_数据准备', '30 9 * * *', { group: '高级机器人组' }),
  cro('demo-10', '物流_领星订单审核发货_业务操作', '0 9 * * 1-6'),
  cro('demo-11', '物流_物流渠道修改发货地址_业务操作', '45 9 * * 1-5'),
  cro('demo-12', '物流_购买配送改线下渠道_业务操作', '0 10 * * *'),
  cro('demo-13', '财务_亚马逊自动提现（欧盟）_业务操作', '0 10 * * 3', { group: '高级机器人组' }),
  cro('demo-14', '采购_商品SKU上架巡查_数据筛查', '0 11 * * *'),
  cro('demo-15', '运营_GPSR商品合规信息循环点击_业务操作', '0 13 * * *'),
  cro('demo-16', '采购_账期订单代付款_业务操作', '0 14 * * *'),
  cro('demo-17', '客服_查询订单退款状态_数据查询', '0 15 * * *'),
  cro('demo-18', '财务_亚马逊配送报告下载（库存分类账）_数据获取', '0 16 * * *', { group: '高级机器人组' }),
  cro('demo-19', '财务_亚马逊配送报告下载（买家退货）_数据获取', '0 16 * * *', { group: '高级机器人组' }),
  cro('demo-20', '财务_亚马逊配送报告下载（超龄库存）_数据获取', '0 16 * * *', { group: '高级机器人组' }),
  cro('demo-21', '财务_亚马逊配送报告下载（月度仓储费）_数据获取', '0 16 * * *', { group: '高级机器人组' }),
  cro('demo-22', '财务_亚马逊配送报告下载（移除货件详情）_数据获取', '0 17 * * *', { group: '高级机器人组' }),
  cro('demo-23', '客服_亚马逊取消订单_下午六点', '0 18 * * *'),
  cro('demo-24', '客服_亚马逊取消订单_每晚八点', '0 20 * * *'),
  cro('demo-25', '物流_订单标发_业务处理', '0,30 22 * * 0'),
  cro('demo-26', '财务_eBay付款报告&交易报表下载_数据下载', '0 23 * * *'),
  cro('demo-27', '通用_亚马逊订单截图_数据获取', '30 23 * * *'),
  cro('demo-28', '物流_vat税号pdf下载_数据下载', '0 0 8 * *', { group: '高级机器人组' }),
  task('demo-29', 'IT_领星自动同步库存', { type: 'hour', hour: 2, minute: 0 }),
  cro('demo-30', 'IT_维护亚马逊店铺_数据获取', '0 6 * * *'),
  cro('demo-31', 'IT_维护店铺站点信息_数据获取', '30 6 * * *'),
  task('demo-32', '客服_漏退款筛查_数据排查', { type: 'week', dayOfWeeks: [5], hour: 9, minute: 30 }),
  task('demo-33', '空_测试任务', { type: 'manual' }),
  task('demo-34', '财务_亚马逊自动提现（北美）_业务操作', { type: 'day', hour: 10, minute: 15 }, { enabled: false }),
  cro('demo-35', '财务_供应商纳税人资质查询_数据获取', '0 4 * * 1'),
  task('demo-36', 'IT_库存同步_心跳检查', { type: 'hour', hour: 1, minute: 0 }),
  task('demo-37', '财务_月末结账_定时执行', { type: 'timer', time: timerTime }, { type: 'timer' }),
]

/** 演示条件任务的一个“到点”时刻：昨天 08:00，之后每 25 小时实跑一次。 */
const demoAnchor = (() => {
  const date = new Date()
  date.setHours(8, 0, 0, 0)
  if (date.getTime() > Date.now()) date.setDate(date.getDate() - 1)
  return date.getTime()
})()

/** 执行时长样本（分钟）：默认取中位数，部分任务手动指定。 */
export const DEMO_OVERRIDES: Record<string, DurationOverride> = {
  'demo-01': { mode: 'median', samples: [41, 38, 44, 39, 42] },
  'demo-02': { mode: 'median', samples: [36, 39, 34, 37] },
  'demo-03': { mode: 'median', samples: [52, 49, 55, 47] },
  'demo-04': { mode: 'median', samples: [46, 44, 49] },
  'demo-05': { mode: 'median', samples: [33, 30, 35] },
  'demo-06': { mode: 'median', samples: [35, 37, 32] },
  'demo-07': { mode: 'manual', samples: [], manual: 15 },
  'demo-08': { mode: 'median', samples: [26, 24, 28] },
  'demo-09': { mode: 'median', samples: [31, 29, 35, 30] },
  'demo-10': { mode: 'median', samples: [66, 61, 72, 58] },
  'demo-11': { mode: 'median', samples: [33, 31, 36] },
  'demo-12': { mode: 'median', samples: [28, 25, 30] },
  'demo-13': { mode: 'manual', samples: [], manual: 20 },
  'demo-14': { mode: 'median', samples: [35, 38, 33] },
  'demo-15': { mode: 'manual', samples: [], manual: 90 },
  'demo-16': { mode: 'median', samples: [25, 22, 27] },
  'demo-17': { mode: 'median', samples: [30, 28, 33] },
  'demo-18': { mode: 'median', samples: [58, 54, 61] },
  'demo-19': { mode: 'median', samples: [44, 41, 47] },
  'demo-20': { mode: 'median', samples: [39, 36, 41] },
  'demo-21': { mode: 'median', samples: [36, 38, 34] },
  'demo-22': { mode: 'median', samples: [41, 39, 44] },
  'demo-23': { mode: 'median', samples: [42, 45, 40] },
  'demo-24': { mode: 'median', samples: [47, 44, 49] },
  'demo-25': { mode: 'median', samples: [55, 58, 51] },
  'demo-26': { mode: 'median', samples: [65, 70, 62] },
  'demo-27': { mode: 'median', samples: [40, 37, 43] },
  'demo-28': { mode: 'median', samples: [70, 66, 74] },
  'demo-29': { mode: 'manual', samples: [], manual: 12 },
  'demo-30': { mode: 'median', samples: [22, 25, 21] },
  'demo-31': { mode: 'median', samples: [18, 20, 17] },
  'demo-32': { mode: 'median', samples: [40, 37, 42] },
  'demo-35': { mode: 'median', samples: [48, 52, 45] },
  'demo-36': {
    mode: 'median',
    samples: [48, 52, 45],
    conditional: { periodHours: 25, checkSeconds: 5, nextRunAt: demoAnchor },
  },
  'demo-37': { mode: 'median', samples: [24, 27, 22] },
}
