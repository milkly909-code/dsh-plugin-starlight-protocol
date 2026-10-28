# 星轨协议 2077 (Starlight Protocol)

[![GitHub License](https://img.shields.io/badge/license-MIT-cyan.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-DeepSeek%20Harness-yellow.svg)](https://github.com/milkly909-code/dsh-plugin-starlight-protocol)

> **DeepSeek Harness 旗舰级综合外观系统 (Starlight Protocol 2077)**  
> 集成冷启动认证序列、赛博朋克 2077 HUD 终端主题、全域通透深空天体引擎以及左上角战术侧边栏折叠总控，提供一站式模块矩阵自主配置与极致沉浸感。

---

## 🌟 核心模块

### 1. 🌌 深空全景动态宇宙天体引擎 (Deep Space Horizon)
- **360° 环绕银河**：无缝正弦银河带算法，自动偏航巡航漂移与鼠标 3D 阻尼视差。
- **正交 3D 星座系统**：动态生成的星座骨架网络与恒星等级光斑。
- **动态天体**：光环行星公转、随机折跃流星轨迹。
- **右下角 SPD 三档航速控制器**：
  - **巡航档 (Cruise)**：`0.12` 航速（平稳护眼，星系缓慢移动）
  - **加速档 (Boost)**：`0.25` 航速（2倍巡航推进）
  - **折跃档 (Warp)**：`0.96` 航速（8倍超光速折跃，星轨流线光束）

### 2. ⚡ 赛博朋克 2077 战术 HUD 终端 (Cyberpunk 2077 Tactical Theme)
- **夜之城色调矩阵**：霓虹青（`#00f0ff`）、战术金黄（`#fce300`）、深空玄黑底层。
- **战术切角与 HUD 框架**：窗口组件战术切角裁切、CRT 细腻扫描线、细节角标包角。
- **声效与交互反馈**：纯代码 Web Audio API 合成的机械按键打字音效，右下角 `SND` 开关与 `DECK` 控制抽屉。
- **Relic 故障彩蛋**：瞬态画面轻微色散与故障扫描线闪烁。

### 3. 🚀 开机冷启动认证序列 (Startup Sequence)
- **黑幕鉴权流程**：冷启动时触发黑幕认证序列、过曝白光与 CRT 荧光屏展开。
- **特工身份档案**：机密特工身份展示（代号、权限等级与数字流），支持用户自定身份。
- **神经网络播报**：内置真人高质量语音片段（TTS 备选）。

### 4. 🎛️ 左上角战术侧边栏折叠按钮 (Tactical Sidebar Toggle)
- **彻底解决 Windows 原生侧栏收起后按钮丢失的 Bug**。
- **恒定高优先级切角微光按钮**：位于左上角（`top: 6px; left: 10px; z-index: 10050`），不受窗口拖拽区域干扰。
- **双态动态矢量图符**：
  - 展开态：显示向内折叠箭头 `◀` 与实线面板框（提示 `收起侧边栏 (Ctrl+B)`）。
  - 折叠态：显示向外展开箭头 `▶` 与虚线导轨框（提示 `展开侧边栏 (Ctrl+B)`）。
- **多级稳态调度**：直接驱动 DSH 官方 `layout.toggleSidebar()`，自动规避图标与 Logo 重叠。

### 5. 🎚️ 模块矩阵总控面板 (Master Module Matrix)
- 在 DSH「设置」界面左侧栏自动注册专属「星轨协议」配置分区。
- 提供深空背景、主题、开机动画的独立启闭开关，设置保存即时热更新生效。

---

## 📂 项目结构

```
dsh-plugin-starlight-protocol/
├── cordis.patch.yml      # DSH 核心服务注册编排文件
├── package.json          # 插件元数据与 client/server 入口声明
├── README.md             # 工程主文档
├── SKILL.md              # AI Agent 智能体技能标准规范
├── LICENSE               # MIT 开源授权协议
└── lib/
    ├── client.js         # 前端统一综合 Bundle (深空引擎 + 主题 + 折叠总控 + 设置面板)
    ├── index.js          # 后端配置服务与 API 路由
    ├── splash.js         # 冷启动开机认证动效逻辑
    ├── splash.css        # 开机黑幕与认证样式
    └── assets/           # 音频素材与 Relic 彩蛋图片
```

---

## 🛠️ 安装与使用

在 DSH 的配置文件 `cordis.patch.yml` 中注册，或使用命令行安装：

```bash
dsh plugin --profile desktop add dsh-plugin-starlight-protocol
```

或将本仓库目录直接通过 Junction 链接到：
`~/.dsh/profiles/desktop/node_modules/dsh-plugin-starlight-protocol`

启动 DeepSeek Harness 后即可享用星轨协议全套外观体验！
