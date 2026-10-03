# Changelog

MedHOT 版本号规则（主.次.补丁）：

- **主版本**：信源包换代（M1 → M2 → M3），数据或模式可能不兼容
- **次版本**：新增后台能力，向后兼容
- **补丁**：修 bug，不改数据与行为

好记的口诀：**主版本看信源规模，次版本看后台功能，补丁看修 bug。**
当前最新 = v3（80 信源）= CI 全绿。

## v3.0.0 — 2026-10-03

提交 `88d6d59`。第三个医疗信源包，80 信源，CI 全绿。

**信源（74 → 80）**
- 新增 M3 六个源：梅斯医学·临床资讯、人民网·健康、米内网·医药资讯、智东西、雷峰网、量子位
- 修正梅斯医学的 `publishedAtRegex`，兼容 `2026-10-03` 与 `2026/10/3` 两种日期写法
- 全部 80 源通过 `assertSupportedConfig` 校验

**修复（这份 changelog 之前的 CI 修复一并归档于此）**
- LLM pool 槽位在异常路径泄漏：`release()` 未置于 `finally`，任何连接/超时/429/5xx 抛出都会永久占用 per-endpoint 与全局槽位，最终队列冻结
- 超时与取消混为一谈：`AbortError`（停机取消）曾被当作可重试超时，导致 worker 停机时反而重发请求。现在只有 `TimeoutError` 算超时
- 停机期间的重试：pool failover 在 provider 层重试，绕过了分析各阶段开头的停机检查。现在 `shutdownSignal` 已中止即不再重试，失败如实记录，交由下一个进程接手
- 测试 fixture 与医疗包脱节：stub 仍按 `宽召回的AI相关性预筛` 匹配 prefilter，改名后所有调用落入兜底分支；返回值仍是 `model_release` / `ai-models` 等医疗 schema 不认的值；identity guard 断言用的 OpenAI/Alibaba 不在医疗 `IDENTITY_LEXICON` 里。已全部对齐医疗 taxonomy
- 精选阈值断言滞后于 M2 的产品改动（T1 60→50、floor 50→45）
- CI 的 sources 数量断言与实际脱节（74 → 80）

**工具**
- `scripts/m2-validate.mjs`、`scripts/m3-validate-all.mjs`：信源配置校验，纳入版本管理

**忽略规则**
- `.m2cache/`、`cf-worker/`（含 Cloudflare API token）、一次性探测脚本加入 `.gitignore`

## v2.2.0 — 2026-10-02

提交 `e5d786a`。

- LLM API Pool：槽位在失败路径的释放修复，新增回归测试（共 10 个）
- 后台端点支持一键「拉取模型」与「测速全部端点」
- 管理页 `/admin/llm-pool`：端点增删改查、健康状态、单端点测试

## v2.1.0 — 2026-10-02

提交 `8566f38`。

- 新增后台管理的 LLM API Pool 页面（CRUD、并发、掩码显示 Key）

## v2.0.0 — 2026-10-02

提交 `ec8f2bc`。第二个医疗信源包。

- 信源 60 → 74
- 精选阈值放宽：T1 60→50、floor 50→45
- 引入动态 LLM API Pool：Round Robin、单 API 与全局并发限制、429/超时/5xx 自动切换、60 秒 cooldown、最多重试 2 次
- API Key 只来自环境变量，加密存库，前端只见掩码

## v1.0.0 — 2026-10-01

提交 `8bae6a9`。首个医疗信源包（M1）。
