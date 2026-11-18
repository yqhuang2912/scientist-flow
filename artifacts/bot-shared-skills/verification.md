# Bot 绑定共享 Skill 验收

2026-11-18，在 ScientistFlow 聊天页面发送消息，使用项目配置的 OpenRouter 免费模型 `baidu/ernie-5.5-flash-preview:free`。下表取自 Trigger 持久化对话。执行结果核对工具的 `output`，成稿核对助手的可见文本。

- [验收直聊](http://localhost:3000/chats/N9i1vkY9_oasU7j4kS6Ac) 的 Bot 是 Proposal 5ef9a6，ID 为 `7kr8uJcOmEdeJoIZ-fcJs`。
- [验收群聊](http://localhost:3000/chats/erw6ofkmX6yJZyUfMHn6u) 包含 Intake 5ef9a6 和 Proposal 5ef9a6。接待 Bot 的 ID 为 `VQ6JZvJ7M3m7YCb7B5YmZ`，绑定为空。
- 共享 Skill 在 Settings 中的显示名称为 **Proposal outline 5ef9a6**，标识为 `proposal-outline-5ef9a6`，ID 为 `LlkrhCam6i-Ig3BVLvGhU`。正文在两次验收中分别使用随机方案编号，用户消息、目录描述和 Bot 指令都没有提供编号。

| 场景 | 助手消息 ID | read_skill 调用 ID | 执行结果 | 可见回复核对 |
| --- | --- | --- | --- | --- |
| 直聊自动选择 | `R33zZLs1ui24OJMu` | `call_67267270a6844fad84d31072` | Proposal 读取 A | 研究问题、可检验假设、最小验证三个二级标题，包含 A 的方案编号 |
| Settings 编辑后在同一聊天再次发送 | `oujMXGCZa5EHstyP` | `call_9510d00432c5488b9c30f148` | Proposal 读取 B | 包含 B 的方案编号和新增的“判定标准”小节 |
| 解绑全部后按名称请求 | `v7TY7lkFEU1auTNR` | `call_eec033aacdb64fe1bc7a5975` | 拒绝，success 为 false，版本和 Skill ID 为空 | 说明当前无法读取，未出现模板编号 |
| 群聊交接 | `2aceF7UDzTpAApZx` | `call_a65263a22257419280b9875c` | handoff 从 Intake 到 Proposal，随后 Proposal 读取 B | 最终消息归属于 Proposal，包含四个规定标题和 B 的编号 |
| 群聊直接指定 Proposal | `PgFzaM16HmGKH0kT` | `call_2c5b24fba75d4ca58bb4df9c` | Proposal 直接读取 B | 四个规定标题和 B 的编号均出现 |
| 恢复绑定并删除另一个共用 Skill 的测试 Bot 后 | `4Cp12ZAdaVBzy4F4` | `call_30b30f9f614046be9abf1ab7` | Proposal 读取 B | 按四个小节完成公园标识研究提案，包含 B 的编号 |
| 已绑定 Bot 收到普通问候 | `TlGY6FG0dBo60ChI` | 无 | 该轮没有读取或交接 | 回复一句中文问候 |

A 的数据库版本为 `2026-11-18T13:39:27.778Z`，方案编号为 `SF-15d90565`。B 的数据库版本为 `2026-11-18T13:43:54.837Z`，方案编号为 `SF-4385eb31`。验收后 Proposal 继续绑定 B。刷新直聊页面后可展开成功和拒绝记录。

## 表单与数据库

- 创建时勾选两个 Skill，刷新后回显。编辑时移除一个并新增一个，重新打开后与 Neon 一致。搜索、切换预设后取消，数据库保持原值。模拟读取故障时保存被禁用，重试成功后恢复选择。
- 已在 Settings 重命名共享 Skill，两个 Bot 的原有关联 ID 均保留。数据库拒绝删除被引用的 Skill，界面可显示先解绑的提示。
- 对真实 Neon 验证了缺少、非法、过期和重复 ID，并发全量替换，以及同一创建请求重放。创建与替换批处理中最后一次外键写入失败时，之前的写入均回滚。
- 删除专用测试 Bot 前确认其没有关联聊天。删除后核对 Skill 正文、版本和另一 Bot 的关联。无引用 Skill 的删除条件通过在 Neon 事务内先删除、再主动回滚验证，全部 Skill 和对话保留。
- 早期[直聊](http://localhost:3000/chats/c4PsP5n4uMtpvEYYCATki)和[群聊](http://localhost:3000/chats/GO5jfxKw-UpOhGA5zceSW)也保留。早期回复存在成功读取但漏写编号的情况。免费模型也曾返回上游限流，这些尝试均未计入表中的成功验收。

## 改动位置

| 部分 | 文件 |
| --- | --- |
| 绑定关系与保存 | `db/schema.ts`、`queries/skills.ts`、`actions/bot.ts`、`actions/skill.ts`、`lib/skill-constraint.ts` |
| 创建、编辑与 Settings 入口 | `components/bot-dialog.tsx`、`components/bot-skill-picker.tsx`、`components/app-sidebar.tsx` |
| 对话读取与群聊交接 | `trigger/bot.ts`、`trigger/chat.ts`、`lib/bot-skill-turn.ts` |
| 聊天活动记录与测试 | `components/chat-activity.tsx`、`lib/chat-presentation.ts`、`tests/bot-skill-turn.test.ts` |
