# Deep Interview Spec: Skila Dashboard Redesign

## Metadata
- Rounds: 7
- Final Ambiguity Score: 13%
- Type: brownfield
- Generated: 2026-04-24
- Threshold: 0.2
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.95 | 0.35 | 0.333 |
| Constraint Clarity | 0.85 | 0.25 | 0.213 |
| Success Criteria | 0.80 | 0.25 | 0.200 |
| Context Clarity | 0.80 | 0.15 | 0.120 |
| **Total Clarity** | | | **0.865** |
| **Ambiguity** | | | **0.135** |

## Goal
重做 skila Web Dashboard Tab 的内容和视觉效果，从当前的 4 个简单数字卡片 + 2 个列表升级为完整的数据仪表盘，采用 csv-dashboard-generator 的设计系统，展示使用量、健康状态、趋势和详细数据。

## Constraints
- 仅修改 Dashboard Tab 内容，不改变 SPA 的 Tab 结构（Dashboard / Skills / Settings）
- 视觉风格完全遵循 csv-dashboard-generator 的设计系统
- 单页纵向布局：KPI 卡片行 → 图表区 → 数据表
- 数据来源：现有 `GET /api/dashboard` + `GET /api/skills` + `GET /api/skills/:name/feedback`
- 成功率基本为 100%，不需要单独大图展示，但失败调用需醒目提示
- ECharts 5.5.1 CDN、Font Awesome 6.5.1 CDN
- 双主题（亮/暗）支持，所有图表随主题切换重新渲染

## Non-Goals
- 不改 Skills Tab 和 Settings Tab
- 不新增 Tab
- 不新增后端 API（尽量复用现有接口，必要时可扩展 `/api/dashboard` 返回数据）
- 不做每小时使用热力图
- 不做版本演进/来源分布图表

## Acceptance Criteria
- [ ] Dashboard Tab 顶部展示 4 张 KPI 卡片，带彩色左边框 + 图标 + countUp 动画 + 骨架屏加载
  - 总使用次数（所有 Skill 调用总和，带 sparkline）
  - 活跃 Skill 数（近 7 天有调用的 Skill 数量）
  - Skill 总数（按状态显示 published/staging/draft/archived/disabled）
  - 最近使用（任意 Skill 最后一次被调用的相对时间）
- [ ] 图表区第 1 行：状态分布环形图（左，flex:1）+ Top Skills 排行横向棒状图（右，flex:2）
- [ ] 图表区第 2 行：调用时间线趋势图（全宽），基于最近 200 条调用记录，成功=绿色、失败=红色，带 DataZoom 滑块 + 滚动平均线
- [ ] 全宽数据表，列：Skill名 / 状态(badge) / 使用次数 / 成功率 / 失败数 / 版本 / 上次使用
  - 可排序（点击列头）
  - 搜索过滤
  - 导出 CSV
  - 分页（15 行/页）
  - 失败数 > 0 的行用红色标识
- [ ] 顶部渐变色条（indigo → emerald → amber → rose）
- [ ] 双主题切换（亮/暗），所有图表随主题重渲染
- [ ] KPI sparkline 在移动端隐藏（≤640px）
- [ ] 响应式：≤1024px KPI 变 2×2，图表纵向堆叠；≤640px KPI 变 1 列
- [ ] 页面无 console 错误
- [ ] 数字动画使用 easeOutCubic 缓动

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| 成功率需要大图展示 | 成功率基本 100%，大图无意义 | 成功率放在数据表列中，失败用红色标识 |
| 需要平均成功率 KPI 卡片 | Contrarian: 为什么不放最显眼位置？ | 用户认为成功率太高无变化，选择「最近一次使用」更有价值 |
| 需要热力图和版本演进图 | 数据可用但优先级不高 | 不纳入本次，保持简洁 |

## Technical Context
- Dashboard SPA 入口：`src/web/index.html`（~1000行单文件 SPA，内联 CSS + JS）
- Dashboard API：`src/web/api/dashboard.ts` → `GET /api/dashboard` 返回 counts/totalUsage/avgSuccessRate/lowSuccess/stagingBacklog
- 反馈数据：`src/web/api/feedback.ts` → `GET /api/skills/:name/feedback` 返回 successRate/usageCount/failureCount/lastUsedAt/invocations
- Skills 列表：`src/web/api/skills.ts` → `GET /api/skills` 返回每个 skill 的 name/status/version/description/revisionCount
- 可能需要扩展 `GET /api/dashboard` 以聚合所有 skill 的 feedback 数据（避免前端 N+1 请求）
- 现有 vendor bundle 包含 CodeMirror + marked，ECharts 需通过 CDN 引入

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| Dashboard | core UI | KPI cards, chart area, data table | 聚合展示 Skill + Feedback 数据 |
| Skill | core domain | name, status, version, revisionCount, lastImprovedAt | has one Feedback |
| Feedback | analytics | successRate, usageCount, failureCount, lastUsedAt | belongs to Skill |
| Invocation | analytics detail | ts, outcome, session | belongs to Feedback |
| KPI Card | UI component | value, label, icon, sparkline, color | displays aggregated metrics |
| FailureAlert | UI concern | — | 数据表中红色标识失败行 |
