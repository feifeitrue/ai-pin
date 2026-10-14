# ai-ping 演示动画

20 秒循环：普通桌面信号 → 双击 Alt 并拖出选区 → 选区外打开轮盘并发送问号 → 框内为主、全图为参考的示例回答 → 自动完成提醒。

这是明确标注的功能演示动画，不是实时录屏或功能验收证据。聊天面板为简化示意，文字预设、等待时间压缩；不表示截图会在真实界面中以飞行动画传输。信号位置与选区分开，遵循 ai-ping 的实际交互。

画面使用 Canvas 按时间绘制，由无头浏览器逐帧导出，再用 FFmpeg 编码。制作工程独立于应用，不增加应用运行时依赖。自行编排画面和时间轴，未复制其他项目的宣传动画源码。信号图标及声音来自本仓库已有素材，© Riot Games，不适用 MIT；见根目录 LICENSE。

Windows 环境：Node.js、Microsoft Edge。

```text
cd promo
npm ci
npm run render -- D:/path/to/output
```

可用 `BROWSER_PATH` 指定 Chromium/Edge，`FFMPEG_PATH` 指定 FFmpeg。`node render.mjs D:/path/to/output --stills` 只输出检查用关键帧。

输出 `ai-ping-demo.gif`（1008×630 / 15 fps）和 `ai-ping-demo.mp4`（1440×900 / 30 fps，包含信号音效）。原始无声 MP4 与关键帧一并保留。网页预览支持暂停及减少动态效果偏好。

## 单项功能演示

`signals.html` / `signals.js` 提供五个 18 秒独立场景，复用统一画面风格，信号方向、任务内容和声音分别对应实际配置：

| 场景参数 | 信号 | 内容 |
| --- | --- | --- |
| question | 问号 | 框选二分查找，解释原因和前提 |
| allin | 全力进攻 | 自由指向微服务话题，给出观点、理由、条件和反例 |
| needvision | 需要视野 | 框选重试策略，整理并保存笔记 |
| enemyvision | 敌方视野 | 自由指向读写分离，分析并保存记录 |
| assist | 请求协助 | 通俗讲解幂等、举例、对比并澄清误解 |

```text
node render.mjs D:/path/to/question --scene=question
node render.mjs D:/path/to/allin --scene=allin
node render.mjs D:/path/to/needvision --scene=needvision
node render.mjs D:/path/to/enemyvision --scene=enemyvision
node render.mjs D:/path/to/assist --scene=assist
```

插眼演示中的 `note.txt`、`screen.png`、`detail.png`、`result.json` 与真实保存格式一致，编号是明确标注的示例。保存状态与写入完成的示意同步出现，不通过提示画面宣称实际执行了保存。
