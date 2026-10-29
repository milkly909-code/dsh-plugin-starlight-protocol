# Starlight Protocol (星轨协议 2077)

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-00f0ff.svg?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-DeepSeek%20Harness-fce300.svg?style=flat-square)](https://github.com/milkly909-code/dsh-plugin-starlight-protocol)

<p align="center">
  <strong>DeepSeek Harness 外观与交互增强套件</strong><br>
  深空动态天体背景 × 赛博朋克 2077 HUD 主题 × 特工冷启动鉴权序列 × 侧栏折叠按钮
</p>

</div>

---

## 📸 界面预览 (Interface Previews)

### 1. 应用主界面 (Application UI)

星轨协议重构了 DeepSeek Harness 视觉系统。在窗口底层注入无缝深空流动天体星幕，界面组件采用高对比度赛博朋克夜之城配色（霓虹青 × 战术金），并修复了无边框环境下侧栏收起后的折叠按钮丢失问题。

#### 侧边栏展开状态 (Full Workspace View)
展示完整侧边栏导航、搜索卡片、中央对话台与右下角 HUD 状态读数：

<div align="center">
  <img src="assets/app-expanded.png" alt="DeepSeek Harness 侧边栏展开状态" width="95%" />
</div>

<br>

#### 侧边栏折叠状态 (Immersive Focused View)
点击左上角战术切角折叠按钮一键隐藏侧栏，进入宽屏沉浸模式：

<div align="center">
  <img src="assets/app-folded.png" alt="DeepSeek Harness 侧边栏折叠状态" width="95%" />
</div>

---

### 2. 开机冷启动序列 (Startup Sequence)

应用启动时自动触发独立的特工鉴权动效，由黑幕序幕平滑过渡至特工身份确认。

| 序幕阶段 (Blackout & Reticle) | 鉴权阶段 (Identity & Authorization) |
| :---: | :---: |
| <img src="assets/startup-intro.png" alt="开机黑幕与瞄准准星" width="100%" /> | <img src="assets/startup-auth.png" alt="特工档案卡片与授权按键" width="100%" /> |
| 官方矢量鲸鱼标识准星瞄准扫描 | 机密特工档案卡、动态进度条与授权按钮 |

---

## ⚡ 核心功能 (Features)

### 🌌 1. 全域深空动态天体引擎 (Deep Space Engine)
* **无缝流动星幕**：整周期正弦银河带算法，自动偏航巡航漂移与鼠标阻尼视差。
* **3D 星座网络**：动态随机生成的星座骨架网络与多阶亮度恒星光斑。
* **三档天体航速 (SPD)**：
  * `0.12x`（巡航档）
  * `0.25x`（动力档）
  * `0.96x`（折跃档）

### ⚡ 2. 赛博朋克 2077 战术 HUD 终端 (HUD Theme)
* **高对比度视觉重构**：霓虹青（`#00f0ff`）× 战术金黄（`#fce300`）× 深空玄黑底层。
* **机能切角轮廓**：组件战术切角（`clip-path`）、CRT 扫描线与边角细节。
* **音频反馈**：HUD 交互音效基于 Web Audio API 合成。
* **彩蛋模式**：内置彩蛋交互。

### 🎛️ 3. 战术侧栏隐藏总控 (Sidebar Controller)
* **侧栏折叠按钮**：在 Windows 无边框环境下提供侧边栏折叠/展开按钮。
* **固定定位**：固定于左上角操作区（`z-index: 10050`），不受窗口拖拽区域拦截。
* **双态联动**：展开态向内折叠 `◀`，折叠态向外展开 `▶`，调度 DSH 官方 `layout.toggleSidebar()` 接口。

### 🚀 4. 特工冷启动鉴权序列 (Startup Screen)
* **特工档案卡**：开机加载特工身份卡片（代号、权限等级与数字流）。
* **交互式接入**：支持回车、空格或鼠标点击「授予访问权限」切入工作台。
* **可配置**：支持在设置中配置身份名称与播报选项。

---

## 📦 安装与启用 (Installation)

### 方式一：DSH 插件管理器一键接入 (推荐)

在命令行中执行：

```bash
dsh plugin --profile desktop add dsh-plugin-starlight-protocol
```

### 方式二：Cordis 配置挂载

在 DeepSeek Harness 的 `cordis.patch.yml` 中追加：

```yaml
- insert:
    - id: dsh-plugin-starlight-protocol
      name: dsh-plugin-starlight-protocol
```

保存后重启 DeepSeek Harness 生效。

---

## ⚙️ 模块设置 (Settings)

安装后，DeepSeek Harness「设置 (Settings)」面板将自动注册专属的 **「星轨协议」** 控制分区：

* **深空天体引擎**：启闭开关
* **赛博朋克 HUD**：启闭开关、强调色与故障色
* **开机动画序列**：启闭控制、播放频次、身份信息与播报选项

设置通过插件自带的配置接口保存，修改后即时生效。

---

## 🛡️ 数据与网络 (Data & Network)

* **本地处理**：不收集、不上传个人文件、工作区路径、代码或聊天内容。
* **网络请求**：界面字体（MiSans）通过 jsDelivr CDN 加载；无网络时回落至系统字体。
  其余样式、矢量图标与动效逻辑均随插件打包，不产生其他外部请求。
* **动效偏好**：遵循系统 `prefers-reduced-motion` 设置。

---

## 📁 项目结构 (Structure)

```
dsh-plugin-starlight-protocol/
├── assets/                  # 官方实机演示截图
│   ├── app-expanded.png     # 侧边栏展开状态实机图
│   ├── app-folded.png       # 侧边栏折叠状态实机图
│   ├── startup-intro.png    # 开机冷启动序幕图
│   └── startup-auth.png     # 特工档案与鉴权交互图
├── cordis.patch.yml         # DSH 核心服务注册编排文件
├── package.json             # 插件元数据与入口配置
├── README.md                # 插件文档
├── SKILL.md                 # 智能体规范定义
├── LICENSE                  # MIT 开源许可
└── lib/
    ├── client.js            # 前端综合 Bundle (深空引擎 + HUD 主题 + 折叠按钮 + 设置面板)
    ├── index.js             # 后端配置服务与 API 路由
    ├── splash.js            # 开机冷启动动效逻辑
    └── splash.css           # 开机界面样式
```

---

## 🙏 致谢与上游开源项目 (Acknowledgements & Upstream)

星轨协议 2077（Starlight Protocol）在以下开源项目基础上做了定制与整合：

- **[dsh-theme-cyberpunk2077](https://github.com/Tommy00748/dsh-theme-cyberpunk2077)** (by [@Tommy00748](https://github.com/Tommy00748)) — 赛博朋克 2077 夜之城 HUD 终端视觉体系与配色基底。
- **[dsh-startup-screen](https://github.com/6shenhonghong9/dsh-startup-screen)** (by [@6shenhonghong9](https://github.com/6shenhonghong9)) — 特工冷启动序列与鉴权动效框架。

深空天体引擎来自本项目作者早期的独立项目 `dsh-space-background`，已并入本仓库，不再单独维护。

本项目在遵循 MIT 开源许可证的前提下，对上述模块进行了重构、视觉统一与配置整合，并补充了侧栏折叠总控（`#starlight-sidebar-toggle`）与统一设置分区。

---

## 📜 开源协议 (License)

本项目基于 [MIT License](LICENSE) 开源发布。第三方版权声明参见 [NOTICE](NOTICE) 文件。
