# 共享 HTTP Tool 的真实聊天验收

在 ScientistFlow 页面发出请求，使用现有 Trigger.dev 开发 worker 和项目配置的 OpenRouter 免费模型。测试对象为 Registry desk mwm7wdfq（A）和 Downloads analyst mwm7wdfq（B）。群聊和 B 的单聊保留，可在本机重看。

| 场景 | 助手消息 | 工具调用 | 实际结果 |
| --- | --- | --- | --- |
| A 从两个工具中选择周下载量 | `T75DDnhZx0BjmcnR` | `call_79aadce0935440aba6428eea` | 仅调用 `npm_weekly_comparison`，HTTP 200。两个下载量和差值与下表相同。 |
| A 查询发布标签 | `sxrjdaRHn34yeRB0` | `call_6d869693fc4748da8a7e9671` | 仅调用 `npm_release_tags`，HTTP 200。最终回答中 latest 为 8.20.0，beta 为 8.11.1。 |
| A 在原聊天解绑全部后再查询 | `61KPYmrFWkSdxmPr`、`5JYglHWWPRTbAok6` | 零次 | 数据库绑定为空。第一次回复错误地把历史失败说成当轮尝试。进一步明确当轮权限后，再次询问时答复当轮无法实时查询。两轮均没有新的 HTTP 工具事件。 |
| 群聊 A 交给 B | `n3lmoBhUeXIHR4W4` | 交接 `call_3226dddcc41a4aafb1aff94e`，HTTP `call_5ef6eb7bf6f244aba69b5ee9` | A 无绑定。B 使用自己的 `npm_weekly_comparison`，HTTP 200，3297 ms。最终答复归属 B。 |
| 删除 A 后，B 的单聊 | `aFVRAZwnapRXFd3U` | `call_a8993bfbd3de4f63b41f562c` | B 使用改名后的 `npm_weekly_comparison_weekly` 发出新请求，HTTP 200，2713 ms。 |

[重看群聊交接](http://localhost:3000/chats/Er_SatsjQ8bwwjjIrraZ9) · [重看删除 A 后的单聊](http://localhost:3000/chats/6UpG-DYAIs1KltHchI6aC) · [群聊历史截图](./group-handoff.png)

### 返回字段与最终答案

两次可重看的下载量调用都由 B（`ysaBDi-080bawj4V2Plw3`）执行。每次回执均保存了原始响应字节的 SHA-256。验收另取一次响应，比对摘要完全一致后，再逐字段核对答案。[npm 周下载量接口](https://api.npmjs.org/downloads/point/last-week/ajv,zod)

| 字段 | 值 |
| --- | --- |
| 统计开始 / 结束 | 2026-11-11 / 2026-11-17 |
| ajv.downloads | 539,563,588 |
| zod.downloads | 468,944,550 |
| 回执 SHA-256 | `1a3d3d7fe8025e6e943020fe10385359873137440e320bb26f9d5307a8adcd2e` |
| B 单聊最终结论 | ajv 比 zod 多 **70,619,038 次**。 |

群聊回答中的日期、次数和减法正确。它额外写的“周日到周六”有误，接口只返回日期。上表的 B 单聊直接引用日期范围。重开页面仍能展开工具活动，旧群聊保留原显示名，B 的新单聊显示新名字。

### 绑定与隔离

- 在创建表单给 A 选择两个 Tool 和一个已有 Skill，B 创建时留空。刷新回显正确，在编辑表单为 B 选择下载量 Tool。A 取消编辑保留原绑定，解绑全部再刷新时保留 Skill。
- 重新绑定后，两位 Bot 同时持有同一个 Tool。在 Settings 修改了工具标识和显示名，两位 Bot 重新打开时仍选中同一 ID。删除 A 后，Neon 中两个 Tool 定义及 B 的绑定均保留，Settings 删除仍被 B 引用的 Tool 会提示先解绑。
- A 的直聊按既有 Bot 删除行为一并清理。保留 B、两条工具定义、群聊及 B 的单聊。额外的原子性测试使用独立临时 Bot，结束后已清理。
- 在真实 Neon 上验证同一创建键的并发重试、Tool 集合变化时的冲突、失效 ID，以及在批处理最后一步触发外键失败后，Bot 字段、Skills 与 Tools 一起回滚。
- 真实 HTTPS 验收使用两个无需凭据的只读 npm GET 接口。GitHub 示例接口受出口匿名限流。系统 DNS 在本机返回基准测试网段地址，首次调用失败。本机 worker 已通过被 Git 忽略的 `.env.local` 启用 `SCIENTISTFLOW_TOOL_DNS=google`，经公开 DNS 解析、地址验证和 TLS 连接后复验成功。
- POST、Bearer 来源限制、重定向、取消、超时、字节上限、参数编码、重放和说话者隔离使用受控传输测试。一次 POST 的请求参数摘要在派发前占用，重放同一用户消息时相同操作不会再发送。凭据配置见 `.env.example`。
