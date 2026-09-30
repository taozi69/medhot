// 可选模块开关。医疗版：AI 行业特有的“模型榜”与“Codex 重置监控”关闭；医疗事件（新药获批、
// 公共卫生事件、重大临床数据）的后续报道多，热度信号照常启用。
// 关掉以后：导航里不再出现入口，对应的定时任务不再运行，页面与接口返回 404。

export const FEATURES = {
  /** 模型榜：汇总公开评测，按公开方法计算共识排名（/leaderboard）。医疗版关闭。 */
  leaderboard: false,
  /** Codex 重置监控：盯 OpenAI Codex 负责人在 X 上的额度重置公告。医疗版关闭。 */
  codexResetMonitor: false,
} as const;
