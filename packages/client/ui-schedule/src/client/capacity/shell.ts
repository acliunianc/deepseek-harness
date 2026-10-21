/** 容量地图页面的静态骨架（挂载在 Shadow DOM 中）。 */
export const SHELL = `
<div class="ydc-root">
  <div class="wrap">
    <header class="ydc-head">
      <div>
        <h1>机器人容量地图</h1>
        <p>把影刀计划展开成时间轴：先看重叠，再决定加机器人还是错峰。</p>
      </div>
      <div class="ydc-head-actions">
        <span class="source-pill" id="sourcePill" data-state="demo"><span class="dot"></span>演示数据</span>
        <span class="sync-time" id="syncTime">未连接</span>
        <button class="btn btn-ghost" id="btnRefresh" type="button">刷新</button>
        <button class="btn btn-primary" id="btnConnect" type="button">连接影刀</button>
      </div>
    </header>

    <section class="toolbar card" aria-label="统计设置">
      <div class="tool-group">
        <span class="tool-label">统计区间</span>
        <div class="segmented" id="rangeGroup" role="group" aria-label="统计区间">
          <button type="button" data-days="7" class="is-active">7 天</button>
          <button type="button" data-days="14">14 天</button>
        </div>
      </div>
      <div class="tool-group">
        <span class="tool-label">可用机器人</span>
        <div class="stepper">
          <button type="button" id="capMinus" aria-label="减少机器人">−</button>
          <output id="capValue">3</output>
          <button type="button" id="capPlus" aria-label="增加机器人">+</button>
        </div>
      </div>
      <div class="tool-group">
        <span class="tool-label">未校准任务按</span>
        <label class="num-field">
          <input id="fallbackInput" type="number" min="1" max="600" step="1" value="15" inputmode="numeric" />
          <span>分钟估算</span>
        </label>
      </div>
      <div class="tool-group tool-group-right">
        <label class="search-field">
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.4"></circle><path d="M13.2 13.2 17 17"></path></svg>
          <input id="taskSearch" type="search" placeholder="搜索任务名称…" autocomplete="off" />
        </label>
      </div>
    </section>

    <section class="kpis" id="kpis" aria-label="关键指标"></section>

    <section class="grid-main">
      <article class="card timeline-card">
        <header class="card-head">
          <div>
            <h2>当日负荷</h2>
            <p class="card-sub" id="timelineMeta">—</p>
          </div>
          <span class="peak-flag" id="peakFlag" hidden></span>
        </header>
        <div class="day-tabs" id="dayTabs" role="tablist" aria-label="选择日期"></div>
        <div class="chart-wrap"><div id="concHost" class="conc-host"></div></div>
        <div class="lanes" id="laneHost"></div>
        <footer class="chart-foot">
          <span class="key"><i class="swatch swatch-solid"></i>实际占用 · 模拟分配</span>
          <span class="key"><i class="swatch swatch-ghost"></i>计划开始 · 被推迟时显示虚线</span>
          <span class="key"><i class="swatch swatch-over"></i>超过机器人数量</span>
          <span class="key"><i class="swatch swatch-check"></i>心跳检查（秒级）</span>
        </footer>
      </article>

      <aside class="card overload-card" id="overloadCard">
        <header class="card-head">
          <div>
            <h2>超载时段</h2>
            <p class="card-sub" id="overloadMeta">—</p>
          </div>
          <span class="badge" id="overloadCount">0</span>
        </header>
        <div class="overload-list" id="overloadList"></div>
      </aside>
    </section>

    <section class="card insights-card" aria-label="容量建议">
      <div class="insights-block" id="overloadFoot"></div>
      <div class="insights-block robot-usage" id="robotUsage"></div>
    </section>

    <section class="grid-secondary">
      <article class="card heat-card">
        <header class="card-head">
          <div>
            <h2>并发热力图</h2>
            <p class="card-sub">每格为该小时的峰值并发，红色斜纹表示超过机器人数量<span class="mobile-only">（左右滑动）</span></p>
          </div>
          <div class="heat-scale" aria-hidden="true">
            <span>少</span><i class="h0"></i><i class="h1"></i><i class="h2"></i><i class="h3"></i><i class="h4"></i><i class="h5"></i><span>多</span>
          </div>
        </header>
        <div class="heatmap" id="heatmap"></div>
      </article>

      <article class="card daily-card">
        <header class="card-head">
          <div>
            <h2>每日概览</h2>
            <p class="card-sub">峰值并发 / 超载时长 / 计划实例</p>
          </div>
        </header>
        <div class="daily-list" id="dailyList"></div>
      </article>
    </section>

    <section class="card tasks-card">
      <header class="card-head">
        <div>
          <h2>计划与执行时长</h2>
          <p class="card-sub" id="taskMeta">—</p>
        </div>
        <div class="card-actions">
          <button class="btn btn-ghost btn-sm" id="btnSyncRecords" type="button" title="读取最近 30 天每个计划最近 40 次完成记录，自动计算中位数与平均值">从执行记录估算</button>
          <button class="btn btn-ghost btn-sm" id="btnBulkDuration" type="button">批量录入时长</button>
          <button class="btn btn-ghost btn-sm" id="btnExport" type="button">导出配置</button>
          <button class="btn btn-ghost btn-sm" id="btnImport" type="button">导入配置</button>
          <input type="file" id="fileInput" accept="application/json,.json" hidden />
        </div>
      </header>
      <div class="table-tools">
        <div class="filter-rows">
          <div class="filter-row">
            <span class="filter-label">类型</span>
            <div class="chips" id="typeFilter" role="tablist" aria-label="按执行类型筛选">
              <button type="button" data-type="all" class="is-active">全部</button>
              <button type="button" data-type="period">计划执行</button>
              <button type="button" data-type="timer">定时执行</button>
              <button type="button" data-type="manual">手动执行</button>
              <button type="button" data-type="disabled">已停用</button>
            </div>
          </div>
          <div class="filter-row">
            <span class="filter-label">范围</span>
            <div class="chips" id="taskFilter" role="tablist" aria-label="按运行范围筛选">
              <button type="button" data-filter="all" class="is-active">全部</button>
              <button type="button" data-filter="executed">本区间有执行</button>
              <button type="button" data-filter="scheduled">参与排期</button>
              <button type="button" data-filter="alert">超载相关</button>
              <button type="button" data-filter="conditional">条件任务</button>
              <button type="button" data-filter="hourly">每小时触发</button>
              <button type="button" data-filter="estimate">待校准</button>
            </div>
          </div>
        </div>
        <span class="table-hint">点表头排序</span>
      </div>
      <div class="table-wrap">
        <table class="task-table">
          <thead>
            <tr>
              <th aria-sort="none"><button type="button" class="th-sort" data-sort="name">任务<span class="sort-mark"></span></button></th>
              <th aria-sort="none"><button type="button" class="th-sort" data-sort="group">机器人组<span class="sort-mark"></span></button></th>
              <th class="ta-r" aria-sort="none"><button type="button" class="th-sort" data-sort="duration">执行时长<span class="sort-mark"></span></button></th>
              <th class="ta-r" aria-sort="none"><button type="button" class="th-sort" data-sort="instances">实例<span class="sort-mark"></span></button></th>
              <th class="ta-r" aria-sort="none"><button type="button" class="th-sort" data-sort="load">总占用<span class="sort-mark"></span></button></th>
              <th aria-sort="none"><button type="button" class="th-sort" data-sort="status">状态<span class="sort-mark"></span></button></th>
            </tr>
          </thead>
          <tbody id="taskRows"></tbody>
        </table>
      </div>
      <p class="footnote">
        时长口径：优先取「执行记录的中位数或平均值」，其次「手动填写」，两者都没有时按未校准值估算。
        右上角「从执行记录估算」可自动填入样本，也可以手动录入或批量粘贴。
        条件任务的心跳检查按秒计，不参与并发峰值与超载判断。
      </p>
    </section>

    <footer class="page-foot">
      <span>时区 Asia/Shanghai (+08:00) · 支持 cron / 每天 / 每周 / 每小时 / 单次 / 手动</span>
      <span>Token 只保存在本机浏览器，不写入服务端文件</span>
    </footer>
  </div>

  <div id="tooltip" class="tooltip" role="tooltip" hidden></div>
  <div id="modalRoot"></div>
  <div id="toastRoot" class="toast-root" aria-live="polite"></div>
</div>
`
