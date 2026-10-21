/** 容量地图的侧边栏图标。 */
import { IconGaugeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * 渲染仪表盘图标；可访问名称由侧边栏条目提供。
 * @param props - 侧边栏图标 share。
 * @returns 仪表盘图形。
 */
export function CapacityIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <IconGaugeOutlineRegular size={size} />
}
