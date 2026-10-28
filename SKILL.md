---
name: dsh-plugin-starlight-protocol
description: DeepSeek Harness 旗舰级综合外观系统 (星轨协议 2077)。集成深空动态宇宙天体引擎、赛博朋克 2077 HUD 终端主题、开机冷启动认证序列及左上角战术侧边栏折叠总控。
---

# 星轨协议 2077 (Starlight Protocol)

本工程是 DeepSeek Harness (DSH) 的旗舰级综合外观插件与 AI 交互控制套件。

## 核心系统

1. **全域深空动态天体引擎 (Deep Space Horizon)**:
   - 360° 无缝流动星幕、正交 3D 星座连线、光环行星与流星。
   - 阻尼 3D 视差，右下角 `SPD` 巡航/动力/星际穿越三档航速调控。
2. **赛博朋克 2077 HUD 终端 (Cyberpunk 2077 Tactical Theme)**:
   - 夜之城全息高对比色彩矩阵、CRT 扫描线、Relic 瞬态故障彩蛋。
   - 机械打字音效合成器、右下角 `SND` 音效开关与 `DECK` 控制抽屉。
3. **开机冷启动认证序列 (Startup Sequence)**:
   - 黑幕鉴权、过曝白屏过场、特工档案卡展示、神经网络声效念白。
4. **左上角战术侧边栏折叠按钮 (Tactical Sidebar Toggle)**:
   - 解决 Windows 无边框环境下原生侧边栏收起后按钮丢失的问题。
   - 恒定高优先级切角微光按钮，双态矢量图标，同步原生快捷键 `Ctrl+B`。
5. **模块矩阵总控面板 (Master Module Matrix)**:
   - 统一注册在 DSH「设置 - 星轨协议」中，支持对各子系统独立启闭并持久化。

## 服务与 API

- **配置文件**: `~/.dsh/dsh-starlight.json`
- **HTTP 接口**:
  - `GET /dsh-starlight/config` 获取当前模块配置
  - `POST /dsh-starlight/config` 更新模块配置
