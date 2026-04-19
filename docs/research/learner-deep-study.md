# Learner 深度技术研究报告

**研究目标**：拆解 oh-my-claudecode `src/hooks/learner/` 17 个 TS 文件的工程基线，找出可被 skila 超越的具体缺口。
**代码版本**：本地 `oh-my-claudecode/src/hooks/learner/` (2026-04 快照)。
**方法**：逐文件读取 + 引用 `<file>:<line>` 锚点。

---

## 1. 整体架构与数据流

learner 由三层组成：**发现/解析层** (`finder.ts`、`parser.ts`、`loader.ts`、`types.ts`、`constants.ts`)、**匹配/注入层** (`matcher.ts`、`bridge.ts`、`index.ts`、`transliteration-map.ts`)、**检测/抽取层** (`detector.ts`、`detection-hook.ts`、`auto-learner.ts`、`auto-invoke.ts`、`writer.ts`、`validator.ts`、`promotion.ts`、`config.ts`)。`bridge.ts` 是关键 — 它把 TS 实现 esbuild 打包成 `dist/hooks/skill-bridge.cjs`，被独立脚本 `scripts/skill-injector.mjs` 通过 `createRequire` 加载（`bridge.ts:1-22`）。

```
                ┌──────── UserPromptSubmit ────────┐
prompt ────────►│ skill-injector.mjs (Node spawn) │
                └──────────────┬───────────────────┘
                               │ require bridge.cjs
              ┌────────────────▼─────────────────┐
              │ bridge.matchSkillsForInjection() │ <── findSkillFiles()
              │  ├─ getSkillMetadataCache (TTL)  │      ├─ project .omc/skills
              │  ├─ expandTriggers (KO map)      │      ├─ .agents/skills
              │  └─ fuzzyMatchTrigger            │      ├─ ~/.omc/skills
              └────────────────┬─────────────────┘      └─ ~/.claude/skills/omc-learned
                               │ MatchedSkill[]
                       inject into context

assistant turn ──► detector.detectExtractableMoment ──► detection-hook
                          (regex per language)            (cooldown gate)
                                                              │
                                              prompt user → /oh-my-claudecode:learner
                                                              │
                                              writer.writeSkill ──► validator
                                                              │
                                                              ▼
                                              .omc/skills/<slug>.md (frontmatter + body)
```

强项：清晰分层、bridge 让 hot-path（注入）变成无 TS 编译开销的纯 CJS。盲区：**发现-匹配-注入** 与 **检测-抽取-写盘** 是两条几乎不通信的管道；`auto-learner.ts` 中累积的 `PatternDetection` 从未自动落到 `writer.ts`（需用户手动跑 skill）。

---

## 2. 触发与 hook 集成

- **注入侧**：`scripts/skill-injector.mjs` 注释明确写 "Skill Injector Hook (UserPromptSubmit)" (`skill-injector.mjs:3-5`)。每次用户提交 prompt，CC 会 spawn 一个新的 Node 进程，所以 session 去重必须落盘 — `bridge.ts` 走 `.omc/state/skill-sessions.json`，fallback 走 `.omc/state/skill-sessions-fallback.json`（`skill-injector.mjs:42-66`），TTL 1 小时（`bridge.ts:37`）。
- **检测侧**：`detection-hook.ts` 暴露 `processResponseForDetection(assistantMessage, userMessage, sessionId)` (`detection-hook.ts:58-90`)，按设计该在 **assistant 回复后**被调用（最接近 Stop / SubagentStop），但仓库里**未发现实际把它接到任何 hook 的注册代码** — 它存在为 API 但未被调度。
- **auto-learner**：`recordPattern` (`auto-learner.ts:363-431`) 同样是纯函数 API，没有 hook 自己 push 调用；`auto-invoke.ts` 提供 `shouldAutoInvoke` 判断，但调度位也缺。

强项：所有 hook 切面都做了无状态化、文件级 session 持久化。盲区：**检测/auto-learn 模块只是库**，整体抽取闭环依赖用户主动运行 `/oh-my-claudecode:learner`。

---

## 3. 检测/判断机制

`detector.ts` 是**纯规则引擎 + 关键词加权**，没有 LLM judge：

- 五类 `DETECTION_PATTERNS`（problem-solution=80、technique=70、workaround=60、optimization=65、best-practice=75），每类含英/中/韩/日/西 5 语种正则（`detector.ts:24-165`）。
- 取最高 confidence (`detector.ts:209-221`)；命中通用 `TRIGGER_KEYWORDS` 数组每个 +5，封顶 +15（`detector.ts:234-243`）。
- `shouldPromptExtraction` 默认阈值 60 (`detector.ts:257-262`)。

`auto-learner.ts:298-357` 的 `calculateSkillWorthiness` 是更复杂的评分：基线 50 → +file paths (15) +error msgs (15) +高价值关键词最多 +20 +多次出现最多 +30 +长度 +10/+10 → −generic phrase 15 −太短 20 −无 trigger 25。阈值 70 进 `suggestedSkills`（`auto-learner.ts:49`）。

强项：多语种正则、双层评分（pattern 类型 + 内容信号）。盲区：**全是 surface-level 的 regex/keyword**；不理解语义；没有看 tool use（如果对话里没有自然语言"我修复了"，整段全程 grep+edit 也不会触发）；五种语言各靠手写正则维护。

---

## 4. 匹配与去重

两套实现并存：
- `matcher.ts` 是 standalone 版本，三段式：(1) substring exact 100 分 (2) glob/regex 触发器 85/90 (3) Levenshtein 模糊 ≥60 才计入 (`matcher.ts:49-103`)；最终 `confidence = bestScore * 0.7 + avg * 0.3` (`matcher.ts:80-86`)。
- `bridge.ts` 是被打包用的版本：`matchSkillsForInjection` (`bridge.ts:669-722`)。每个 trigger substring +10；只有 frontmatter `matching: fuzzy` 才走 fuzzy（`bridge.ts:689-704`），fuzzy 加分 = `score/10`。Levenshtein 计算有 LRU 缓存（`bridge.ts:54-79`，规模 1000）。

去重机制：
- 触发器层 `transliteration-map.ts:19-28` 只有 6 条韩语映射（"deep dive→딥다이브"等），且只对 hardcoded 几个 skill 有效。
- 写盘前 `writer.ts:135-158` 的 `checkDuplicateTriggers`：lowercase 后 set 比较；overlap ≥ 输入触发器数 50% 即视作 dup。

强项：缓存、O(n) Levenshtein (`bridge.ts:606-634`)、symlink 边界检查 (`bridge.ts:355-366`)。盲区：**没有 embedding/语义匹配**；同义词只能靠人工 transliteration map；Levenshtein 用在多词 prompt 与短 trigger 之间噪声大；中文/日文 substring match 在 trigger 与 prompt 间没有分词。

---

## 5. 写盘与提升流程

- `writer.writeSkill(request, projectRoot, skillName)` (`writer.ts:48-130`)：先 `validateExtractionRequest`，再 `ensureSkillsDir`，生成 metadata (`id = skill-{base36-ts}-{rand4}` `writer.ts:18-22`)，写出 frontmatter + `# Problem` + `# Solution` 两节正文（`writer.ts:88-97`）。**只有 SKILL.md 单文件，没有 scripts/ 没有 references/，没有任何子结构。**
- 文件名 = `sanitizeFilename(skillName)`，存在即拒写（`writer.ts:104-111`）—— **不会覆盖、不会版本化、不会 merge**。
- `validator.ts:13-66` 的硬阈值：problem ≥10 字符 / solution ≥20 字符 / 至少一个 trigger / 总长 ≤ `MAX_SKILL_CONTENT_LENGTH=4000` (`constants.ts:35`)；初始 100 分逐项扣分；通过门槛 `MIN_QUALITY_SCORE=50` (`constants.ts:38`)。
- `promotion.ts` 是独立通道：从 `ralph-progress` 的 `entries[].learnings` 拉取 (`promotion.ts:40-70`)，按 hardcoded 17 个技术关键词列表 (`promotion.ts:27-31`) 抽 trigger，调用 `writeSkill` —— 等价于"给 ralph 学到的东西做一次同样格式的写盘"。

强项：原子的 quality gate、source 字段区分 `extracted/promoted/manual` (`types.ts:23`)。盲区：**没有"草稿→正式"两阶段**；source=extracted 写完即正式；没有 review queue。

---

## 6. 配置与可调性

`config.ts:12-61` 的 `LearnerConfig`：
- `enabled`、`detection.{enabled, promptThreshold=60, promptCooldown=5}`、`quality.{minScore=50, minProblemLength=10, minSolutionLength=20}`、`storage.{maxSkillsPerScope=100, autoPrune=false, pruneDays=90}`。
- 持久到 `~/.claude/omc/learner.json` (`config.ts:63`)。
- `auto-invoke.ts:31-36` 单独配置：`confidenceThreshold=80 / maxAutoInvokes=3 / cooldownMs=30000`，存 `~/.claude/.omc-config.json`（`auto-invoke.ts:42`）。
- `constants.ts:35-44`：`MAX_SKILL_CONTENT_LENGTH=4000`、`MIN_QUALITY_SCORE=50`、`MAX_SKILLS_PER_SESSION=10`、`MAX_RECURSION_DEPTH=10`。

强项：分层 config（feature/quality/storage）+ env `OMC_DEBUG=1`。盲区：**白/黑名单完全缺席**；没有"禁止把 secret/path 写进 skill"的过滤；`autoPrune` 写了 flag 但**没有配套实现**（仓库无 prune 调用）。

---

## 7. 关键弱点 / 没做到的

7.1 **写盘后是否回头改旧 skill？** 不会。`writer.writeSkill` 在 `existsSync(filePath)` 时直接 return error (`writer.ts:104-111`)；**没有 update/merge/append** 路径。`checkDuplicateTriggers` (`writer.ts:135-158`) 只能阻止重复写入，不会更新已有文件。`promotion.ts` 同样调用 `writeSkill`，遵循同规则。结论：**learner 是 append-only 的；旧 skill 一经落盘永远不会被 learner 自身改写**，与用户描述一致。

7.2 **反馈闭环？** 数据结构有，回路缺：`InvocationRecord` 含 `wasSuccessful: boolean | null` 和 `feedbackScore: number | null` (`auto-invoke.ts:14-22`)；`updateInvocationSuccess` (`auto-invoke.ts:134-147`) 是 setter；`getAggregatedStats` 能算 successRate (`auto-invoke.ts:255-319`)。但**没有任何代码把这些数据回写到 skill 的 `quality` 或 `usageCount` 字段**；`loader.ts:115-122` 读取 quality/usageCount 只用作匹配加权，永不更新。

7.3 **版本/迭代/进化？** 完全没有：metadata 无 `version` / `parentId` / `derivedFrom` / `lastImprovedAt`；frontmatter 模板 (`writer.ts:74-84`) 写完不再动；SKILL.md (`skills/learner/SKILL.md:9-15`) 自称 Level 7 self-improving，但实现里**没有任何 expertise-section 自动改写代码**。

7.4 **用户审批 UI？** 半自动：`detector` 只生成"建议提示词" (`detector.ts:267-284`)，需要用户手动键入 `/oh-my-claudecode:learner` 才会触发 `writer`；`auto-invoke.ts` 阈值 80 也只在内存里跑，**没有 UI/diff/preview/confirm**。一旦走到 `writeSkill`，写盘是静默的。

---

## 8. 超越方向 — Skila 的 5 条具体能力

按工程难度从低到高：

### 8.1 Append-and-revise pipeline（追写而非新建）
检测到与已有 skill 相似度 ≥X% 时，进入 **revise 路径**：读旧文件 → diff 新洞察 → LLM 合并 → 写回；保留 `lastImprovedAt`、`revisionCount`、`changelog:` 字段。learner 当前写盘失败的位 (`writer.ts:104-111`) 改为分支入口。难度：低。

### 8.2 反馈回写到 metadata（feedback flywheel）
监听 PostToolUse / Stop hook，把 `auto-invoke.ts:255-319` 已经统计的 successRate **回写**到对应 SKILL.md 的 frontmatter `quality` 与新增 `successRate / lastUsedAt`；连续低分自动降权或 tombstone。需要扩展 frontmatter schema + 一个 hook 注册点。难度：中。

### 8.3 Embedding-index 替代正则触发器
当前 `matcher.ts` + `transliteration-map.ts` 用 substring/Levenshtein/手写音译，对中文/日文勉强、对同义词无能。Skila 在 `loader` 层为每条 skill 计算并缓存一份本地 embedding（如 `bge-small`），匹配时跑 cosine + topK；保留正则做 cheap pre-filter。难度：中。

### 8.4 双层 skill 结构（draft/ + published/）+ promotion gate
打破 learner 的"写盘=正式"。Skila 写到 `.omc/skills/draft/`，要求 N 次成功使用或用户 `/skila approve` 才挪到 `published/`。draft 不参与注入或低权重注入。需扩 `finder.ts` scope 概念 + 新增 promotion 命令。难度：中。

### 8.5 LLM-judge + tool-trace-aware extractor（替代纯 regex detector）
learner 的 `detector.ts` 完全靠语言正则，看不懂 tool use 序列。Skila 加一个轻量 judge：把"对话片段 + 工具调用图（Edit/Bash/Grep 序列）"喂给 sub-agent，输出 (worth_extract, why, draft_skill, dedup_id)。把 `detector.ts` 当 cheap gate，judge 当 quality gate；judge 的输出直接是 SKILL.md 草稿。难度：高（涉及 sub-agent 调度、token 预算控制、与 8.1 的 revise 路径联动）。

---

## Skila 超越路线图（5 条候选能力，按工程难度排序）

1. **Append-and-revise pipeline**（低）— 把"重复=失败"改为"重复=合并"。
2. **Feedback 回写 metadata**（中）— 让 successRate / usage 真正影响 quality。
3. **双层 draft/published + promotion gate**（中）— 阻止 noise skill 立即生效。
4. **Embedding-index 触发器**（中）— 用语义相似度替代正则+Levenshtein+音译表。
5. **LLM-judge + tool-trace-aware extractor**（高）— 把抽取从"看文本"升级到"看会话+工具图"。
