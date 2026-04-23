# Skill Translation v1 — Consensus Plan

## Status: APPROVED (Planner → Architect → Critic)

## ADR
- **Decision**: 使用 raw fetch 调用 Anthropic API 实现翻译
- **Drivers**: 零依赖哲学、provider 兼容性、项目一致性
- **Alternatives**: Anthropic SDK（类型安全但增加依赖）
- **Why chosen**: 项目是零框架风格，SDK 只用一个 API，raw fetch 30 行即可
- **Consequences**: 需手动处理错误类型；未来如需流式输出需自行实现
- **Follow-ups**: v2 可考虑翻译缓存、双向同步

## Steps

### Step 1: 扩展 SkilaConfig
- File: `src/config/config.ts`
- Add: translateTargetLang?, translateBaseUrl?, translateModel?

### Step 2: 新建 translate.ts
- File: `src/web/api/translate.ts`
- Handlers: handleTranslateSkill, handleGetTranslateSettings, handlePutTranslateSettings
- Raw fetch to ANTHROPIC_BASE_URL/v1/messages
- 60s AbortController timeout
- Error handling: network error / 4xx-5xx / timeout → meaningful error messages

### Step 3: 注册路由
- File: `src/web/server.ts`
- POST /api/skills/:name/translate (token required, JSON body)
- GET /api/settings/translate
- PUT /api/settings/translate (token required, JSON body)

### Step 4: 前端翻译按钮+分栏
- File: `src/web/index.html`
- Translate button with debounce
- Split panel: left original (read-only CM), right translated (read-only CM)
- Loading state, error display
- Does NOT affect editor dirty state

### Step 5: 前端 Settings
- File: `src/web/index.html`
- Target language selector (default zh)
- Custom API key input (password field)
- Custom base URL input
- Save button → PUT /api/settings/translate

### Step 6: Tests
- File: `tests/web/translate.test.ts`
- Mock fetch, test handler logic
