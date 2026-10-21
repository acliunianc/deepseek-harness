/** 影刀计划容量地图：把计划展开成时间轴，显示任务重叠、机器人占用与缺口。 */
import { useEffect, useRef } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { mountCapacity } from './app.ts'
import cssText from './capacity.css?inline'

/**
 * 在主栏中挂载容量地图。页面自身是一个隔离的 DOM 视图（Shadow DOM），
 * 所以 DSH 的主题与全局样式不会影响图表的排版，页面的样式也不会外泄。
 * @param _props - 主面板标准 props（页面不消费宿主数据）。
 * @returns 铺满主栏的宿主节点。
 */
export function CapacityPage(_props: PropsRuntime<'main'>) {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const shadow = host.attachShadow({ mode: 'open' })
    const mounted = mountCapacity(shadow)
    const style = document.createElement('style')
    style.textContent = cssText
    shadow.prepend(style)
    return () => { mounted.destroy() }
  }, [])

  return <div ref={hostRef} style={{ height: '100%', minHeight: 0 }} />
}
