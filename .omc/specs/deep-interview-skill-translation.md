# Deep Interview Spec: Skill Translation (v1)

## Metadata
- Interview ID: skill-translation-v1
- Rounds: 8
- Final Ambiguity Score: 13%
- Type: brownfield
- Generated: 2026-04-23
- Threshold: 20%
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.95 | 35% | 0.3325 |
| Constraint Clarity | 0.85 | 25% | 0.2125 |
| Success Criteria | 0.80 | 25% | 0.2000 |
| Context Clarity | 0.80 | 15% | 0.1200 |
| **Total Clarity** | | | **0.8650** |
| **Ambiguity** | | | **13.5%** |

## Goal

在 skila web dashboard 的 skill 详情页增加翻译功能：用户点击"翻译"按钮后，通过 LLM API 将英文 SKILL.md 翻译为目标语言，以左右分栏对照视图展示（左侧英文原文，右侧翻译）。翻译侧只读，编辑仍在英文侧。v1 为单向翻译（英→目标语言），双向同步留给 v2。

## Constraints
- 默认复用环境变量中的 Anthropic API 配置（`ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY`，即 Raven 代理）
- 用户也可在 Settings 页面手动配置自定义的 LLM API key / base URL 作为备选
- v1 不要求翻译结果持久化缓存（每次点击重新翻译），缓存为 v2 功能
- 翻译侧只读，不可编辑
- 目标语言默认中文，可在 Settings 页面切换其他主流语言
- skila 是本地工具，翻译请求走后端 API 路由（非前端直接调用）

## Non-Goals
- ❌ 双向同步（中文编辑→回写英文）— v2
- ❌ 翻译结果本地持久化缓存 — v2
- ❌ 翻译整个 skill 列表页 — 只翻译详情页的 SKILL.md 内容
- ❌ 支持非 Anthropic 的 LLM 提供商（v1 只走 Anthropic SDK 兼容接口）
- ❌ 翻译 scripts/references/assets 等非 SKILL.md 文件

## Acceptance Criteria
- [ ] Skill 详情页新增"翻译"按钮，点击后触发翻译
- [ ] 翻译完成后展示左右分栏对照视图（左英文原文，右翻译内容）
- [ ] 翻译通过后端 API 路由实现（如 `POST /api/skills/:name/translate`）
- [ ] 后端默认使用 `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` 环境变量调用 Claude API
- [ ] Settings 页面可设置目标语言（默认中文，支持日语、韩语、法语、德语、西班牙语等主流语言）
- [ ] Settings 页面可手动配置自定义 API key 和 base URL（当环境变量不可用时）
- [ ] 翻译侧为只读，编辑操作仅在英文原文侧
- [ ] 翻译期间显示 loading 状态
- [ ] 翻译失败时显示错误提示（如 API 不可用、key 无效等）

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| 需要用户配置 API key | Raven 代理已在环境变量中配置 | 默认复用环境变量，Settings 提供手动配置备选 |
| 需要浏览器端翻译 | 后端可直接调用 LLM API | 走后端 API 路由，前端只负责展示 |
| 需要双向同步 | 复杂度极高 | v1 只做单向，v2 再加 |
| 需要翻译缓存 | 增加存储复杂度 | v1 不缓存，v2 再做 |
| 只支持中文 | 用户希望多语言 | Settings 页面支持主流语言切换 |
| CodeMirror 能左右分栏 | CodeMirror 支持多实例并列 | 翻译侧可用只读 CodeMirror 或 rendered markdown |

## Technical Context

### 现有架构（brownfield）
- **Web Server**: `src/web/server.ts` — Node.js `node:http`，路由在 `route()` 函数
- **API 层**: `src/web/api/` — skills.ts, files.ts, versions.ts, lifecycle.ts 等
- **前端**: `src/web/index.html` — 单文件 SPA，使用 CodeMirror 编辑器
- **认证**: HttpOnly cookie token，`validateToken()` 中间件
- **Skills 读取**: `scanInventory()` / `findSkill()` 从 `~/.claude/skills/` 扫描
- **环境变量**: `ANTHROPIC_BASE_URL=http://localhost:7024`, `ANTHROPIC_API_KEY` 已配置

### 新增组件
- `src/web/api/translate.ts` — 翻译 API handler
- `src/web/server.ts` — 新增 `POST /api/skills/:name/translate` 路由
- `src/web/index.html` — 翻译按钮、左右分栏 UI、Settings 页面扩展
- `src/translate/` — LLM 翻译服务层（调用 Anthropic SDK）
- `src/config/` — Settings 持久化（语言偏好、自定义 API 配置）

### API 设计草案
```
POST /api/skills/:name/translate
  Body: { "targetLang": "zh" }
  Response: { "original": "...", "translated": "...", "lang": "zh" }
  Auth: token required
```

```
GET /api/settings/translate
  Response: { "targetLang": "zh", "customApiKey": "***", "customBaseUrl": "..." }

PUT /api/settings/translate
  Body: { "targetLang": "ja", "customApiKey": "...", "customBaseUrl": "..." }
  Auth: token required
```

## Ontology (Key Entities)

| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| SKILL.md | Core domain | name, content, frontmatter, body | belongs to Skill directory |
| Translation | Core domain | originalContent, translatedContent, targetLang | derived from SKILL.md |
| Web Dashboard | Existing system | routes, auth, CodeMirror | hosts Translation UI |
| LLM API | External system | baseUrl, apiKey, model | produces Translation |
| Split View | UI component | leftPane, rightPane, syncScroll | displays Translation |
| Settings | Supporting | targetLang, customApiKey, customBaseUrl | configures LLM API |

## Ontology Convergence

| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 3 | 3 | - | - | N/A |
| 2 | 4 | 1 | 0 | 3 | 75% |
| 3 | 5 | 1 | 0 | 4 | 80% |
| 4 | 6 | 1 | 0 | 5 | 83% |
| 5 | 6 | 0 | 0 | 6 | 100% |
| 6 | 8 | 2 | 0 | 6 | 75% |
| 7 | 8 | 0 | 0 | 8 | 100% |
| 8 | 8 | 0 | 0 | 8 | 100% |

## v2 Roadmap (Future)
- 双向同步：中文侧可编辑 → 保存时 LLM 反向翻译回英文 → 更新 SKILL.md
- 翻译结果本地缓存（如 `.i18n/zh.md`），基于内容 hash 判断是否需要重新翻译
- 段落级对齐与同步滚动
- 翻译质量评分与人工修正

## Interview Transcript
<details>
<summary>Full Q&A (8 rounds)</summary>

### Round 1
**Q:** 你在阅读 SKILL.md 时，主要的困难是什么？
**A:** 整体理解 — 整篇文档是英文的，需要完整的中文翻译版本对照着读
**Ambiguity:** 78% (Goal: 0.4, Constraints: 0.1, Criteria: 0.1, Context: 0.2)

### Round 2
**Q:** 翻译内容应该从哪里来？
**A:** 用户追问：如果用 LLM API 实时翻译则需要用户配置 API key 对吗？
**Ambiguity:** 72% (Goal: 0.4, Constraints: 0.3, Criteria: 0.1, Context: 0.25)

### Round 3
**Q:** 综合考虑质量、成本和便捷性，你更倾向哪种方案？
**A:** 用户追问：在 web 端的操作怎么调用 Claude Code 呢？
**Ambiguity:** 66% (Goal: 0.4, Constraints: 0.45, Criteria: 0.1, Context: 0.4)

### Round 4
**Q:** 翻译内容在 UI 上应该怎么呈现？
**A:** 左右分栏对照（左英文，右翻译，段落对齐同步滚动）
**Ambiguity:** 53% (Goal: 0.7, Constraints: 0.45, Criteria: 0.15, Context: 0.5)

### Round 5
**Q:** 你用的代理是什么形式？
**A:** Raven 代理，细节不清楚。经探查发现 ANTHROPIC_BASE_URL=http://localhost:7024
**Ambiguity:** 44% (Goal: 0.7, Constraints: 0.7, Criteria: 0.15, Context: 0.7)

### Round 6
**Q:** 以下哪些描述符合你期望的翻译功能行为？
**A:** 手动触发翻译 + 翻译结果缓存 + Settings 页面设置语言 + 中文编辑时自动回写英文
**Ambiguity:** 30% (Goal: 0.85, Constraints: 0.7, Criteria: 0.5, Context: 0.7)

### Round 7 (Simplifier Challenge)
**Q:** 你愿意分期做吗？双向同步复杂度高，建议先做单向翻译对照作为 v1
**A:** 先做单向 v1
**Ambiguity:** 22% (Goal: 0.9, Constraints: 0.75, Criteria: 0.7, Context: 0.7)

### Round 8
**Q:** 确认 v1 验收标准是否完整？
**A:** 翻译按钮+分栏 ✅ | 复用 Raven ✅ | 多语言 Settings ✅ | 补充：Settings 页面可手动配置 API key
**Ambiguity:** 13% (Goal: 0.95, Constraints: 0.85, Criteria: 0.8, Context: 0.8)

</details>
