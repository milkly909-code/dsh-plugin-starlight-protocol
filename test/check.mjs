/**
 * 离线集成验证：在假 DOM 上跑 client.js 的真实引擎代码。
 *
 * 覆盖：
 *   1. 面板项收敛与过滤（仅展示插件、插件市场、上下文洞察 + 更多，其余自动隐藏并 unpin）
 *   2. 工作区折叠箭头注入与整行标题折叠交互
 *   3. 状态写入 localStorage 并在新引擎里读回
 *   4. 宿主重渲染后自愈
 *   5. 折叠时搜索框聚焦 / 有输入 → 临时展开（窥视）
 *   6. 顶部面板锁定与列表独立平滑滚动（彻底解决无法滑动与顿挫）
 *   7. 「更多」菜单内标签自由拖拽调整位置与排序记忆
 *   8. dispose 后节点、样式、属性、监听器全部还原
 *   9. 归一化函数对脏数据的鲁棒性
 */
import assert from 'node:assert/strict';
import { createSandbox } from './fake-dom.mjs';

/* ------------------------------------------------------------------ *
 * 载入 client.js：用假 DOM 顶替全局，取出 __test__ 面。
 * ------------------------------------------------------------------ */
const sandbox = createSandbox();
const g = globalThis;
const saved = {};
for (const key of ['window', 'document', 'MutationObserver', 'localStorage']) {
  saved[key] = g[key];
}
g.window = sandbox.window;
g.document = sandbox.document;
g.MutationObserver = sandbox.MutationObserver;
g.localStorage = sandbox.window.localStorage;

/** 捕获 __ModuleLoader__ 注册的模块定义。 */
let loaded = null;
g.window.__ModuleLoader__ = {
  /**
   * 记录模块定义。
   * @param {{id: string, factory: Function}} definition 模块定义。
   * @returns {void}
   */
  load(definition) { loaded = definition; },
};

const clientUrl = new URL('../lib/client.js', import.meta.url);
await import(clientUrl.href);

assert.ok(loaded !== null, '客户端模块应通过 __ModuleLoader__.load 注册');
assert.equal(loaded.id, 'dsh-plugin-starlight-protocol', 'client bundle 模块 id 与包名一致');

/**
 * 最小 React stub：内嵌的星轨协议子系统在模块求值阶段需要 react.createElement
 * （用于构建设置面板组件），但侧栏分组的断言全部不触碰 React 渲染，
 * 因此这里只需可调用、可承载 JSX 工厂即可。
 */
const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useEffect: () => {},
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useMemo: (factory) => factory(),
  useCallback: (fn) => fn,
  Fragment: 'Fragment',
};

const mod = loaded.factory((id) => {
  if (id === 'react') return reactStub;
  throw new Error('未预期的运行时模块：' + id);
});
const T = mod.__test__;

/**
 * 计数断言。
 * @param {number} actual 实际。
 * @param {number} expected 期望。
 * @param {string} message 说明。
 * @returns {void}
 */
function eq(actual, expected, message) {
  assert.equal(actual, expected, message);
}

let passed = 0;
/**
 * 跑一条断言并计数。
 * @param {string} name 断言名。
 * @param {Function} run 断言体。
 * @returns {void}
 */
function check(name, run) {
  run();
  passed += 1;
  console.log('  ok  ' + name);
}

/**
 * 清空文档与存储，回到干净状态。
 * @returns {void}
 */
function reset() {
  sandbox.document.body.childNodes = [];
  sandbox.storage.clear();
  T.writeState({ panels: T.OPEN, workspaces: T.OPEN });
  T.writeMoreOrder([]);
  sandbox.storage.clear();
  sandbox.document.activeElement = null;
}

/**
 * 启动一个引擎。
 * @param {string} [locale] 语言。
 * @returns {{dispose: Function, engine: any}} 引擎与清理函数。
 */
function boot(locale = 'zh') {
  const engine = T.createEngine(() => key => (T.DICT[locale] ?? T.DICT.en)[key] ?? key);
  const dispose = engine.start();
  return { engine, dispose };
}

console.log('\n[1] 面板收纳与注入位置');
reset();
{
  const { nav, header } = sandbox.dom();
  const { dispose } = boot();
  check('不添加面板折叠分组头', () => {
    assert.ok(nav !== null, 'nav 必须存在');
    eq(nav.querySelector('[data-dsh-sg-label]'), null, '不应有自建面板折叠头');
  });
  check('仅外露展示插件、插件市场、上下文洞察与更多', () => {
    const visibleRows = nav.children.filter(child => !child.hasAttribute(T.HIDDEN_ATTR));
    eq(visibleRows.length, 4, '应正好有 4 行（插件、插件市场、上下文洞察、更多）');
    const texts = visibleRows.map(row => (row.querySelector('button')?.textContent || row.textContent).trim());
    eq(texts.includes('插件'), true, '应包含「插件」');
    eq(texts.includes('插件市场'), true, '应包含「插件市场」');
    eq(texts.includes('上下文洞察'), true, '应包含「上下文洞察」');
    eq(texts.includes('更多'), true, '应包含「更多」');
  });
  check('其余项自动标记隐藏并触发 unpin', () => {
    const hiddenRows = nav.children.filter(child => child.hasAttribute(T.HIDDEN_ATTR));
    eq(hiddenRows.length, 3, '自动化任务、GitHub、热榜共 3 项被标记隐藏');
  });
  check('工作区箭头插在段头首位', () => {
    eq(header.firstElementChild.hasAttribute(T.TOGGLE_ATTR), true, '段头首位应为折叠箭头');
  });
  check('箭头排在「工作区」文字之前', () => {
    const first = header.firstElementChild;
    const second = header.children[1];
    eq(first.hasAttribute(T.TOGGLE_ATTR), true, '第 1 个是箭头');
    eq(second.textContent, '工作区', '第 2 个是宿主自己的段名');
  });
  dispose();
}

console.log('\n[2] 工作区折叠 / 展开交互');
reset();
{
  const { header, root } = sandbox.dom();
  const { dispose } = boot();
  const toggle = header.firstElementChild;
  check('默认工作区展开', () => {
    eq(root.getAttribute(T.WS_ATTR), T.OPEN, '工作区默认展开');
    eq(toggle.getAttribute('aria-expanded'), 'true', 'aria 应为展开');
  });
  check('点击工作区箭头 → 折叠', () => {
    toggle.dispatchEvent({ type: 'click' });
    eq(root.getAttribute(T.WS_ATTR), T.COLLAPSED, '工作区应变折叠');
    eq(toggle.getAttribute('aria-expanded'), 'false', 'aria 同步');
  });
  check('工作区折叠后可访问名带宿主自己的段名', () => {
    eq(toggle.getAttribute('aria-label'), '展开工作区 工作区', '应复用宿主的「工作区」文案');
  });
  check('再次点击工作区箭头 → 展开', () => {
    toggle.dispatchEvent({ type: 'click' });
    eq(root.getAttribute(T.WS_ATTR), T.OPEN, '恢复展开');
    eq(toggle.getAttribute('aria-expanded'), 'true', 'aria 恢复展开');
  });
  check('点击段头搜索框或交互控件不误触发折叠', () => {
    if (header.querySelector('input')) {
      const inputEl = header.querySelector('input');
      sandbox.document.documentElement.dispatchEvent({ type: 'click', target: inputEl });
      eq(root.getAttribute(T.WS_ATTR), T.OPEN, '点击搜索框应保持展开');
    }
  });
  check('点击工作区标题文字（非按钮）→ 折叠', () => {
    const textLabel = header.children[1];
    const event = { type: 'click', target: textLabel };
    sandbox.document.documentElement.dispatchEvent(event);
    eq(root.getAttribute(T.WS_ATTR), T.COLLAPSED, '点击标题文字也应触发折叠');
  });
  /* 恢复展开，再测点击 wsToggle 本身不被双重触发 */
  header.firstElementChild.dispatchEvent({ type: 'click' });
  check('点击 wsToggle 按钮不被标题委托重复计数', () => {
    const btn = header.firstElementChild;
    btn.dispatchEvent({ type: 'click', target: btn });
    eq(root.getAttribute(T.WS_ATTR), T.COLLAPSED, 'wsToggle 点击一次刚好折叠一次');
  });
  dispose();
}

console.log('\n[3] 状态持久化');
reset();
{
  const first = sandbox.dom();
  const bootA = boot();
  first.header.firstElementChild.dispatchEvent({ type: 'click' });
  const stored = sandbox.storage.get(T.STORAGE_KEY);
  check('折叠后写入 localStorage', () => {
    assert.ok(typeof stored === 'string' && stored.length > 0, '应写入存储键');
    const parsed = JSON.parse(stored);
    eq(parsed.workspaces, T.COLLAPSED, '记录工作区折叠');
  });
  bootA.dispose();

  // 模拟刷新：清空 DOM，保留 storage，重新启动
  sandbox.document.body.childNodes = [];
  const second = sandbox.dom();
  const bootB = boot();
  check('新引擎读回折叠状态', () => {
    eq(second.root.getAttribute(T.WS_ATTR), T.COLLAPSED, '工作区应仍折叠');
    eq(second.header.firstElementChild.getAttribute('aria-expanded'), 'false', 'aria 也应为折叠');
  });
  bootB.dispose();
}

console.log('\n[4] 脏数据鲁棒性');
check('null / 数组 / 字符串 / 缺字段 全部回落默认展开', () => {
  for (const raw of [null, undefined, 'nonsense', 42, [], {}, { workspaces: 'weird' }]) {
    const state = T.normalizeState(raw);
    eq(state.workspaces, T.OPEN, 'workspaces 回落 open：' + JSON.stringify(raw));
  }
});
check('兼容布尔写法', () => {
  eq(T.normalizeState({ workspaces: false }).workspaces, T.COLLAPSED, 'false → collapsed');
  eq(T.normalizeState({ workspaces: true }).workspaces, T.OPEN, 'true → open');
});
check('存储里是坏 JSON 时不抛异常', () => {
  reset();
  const env = sandbox.dom();
  sandbox.storage.set(T.STORAGE_KEY, '{not json');
  const { dispose } = boot();
  eq(env.root.getAttribute(T.WS_ATTR), T.OPEN, '应回落默认展开而不是崩溃');
  dispose();
});
check('localStorage 抛异常时降级为内存态', () => {
  reset();
  sandbox.dom();
  const original = sandbox.window.localStorage.setItem;
  sandbox.window.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  const { dispose } = boot();
  const toggle = sandbox.document.querySelector('[' + T.TOGGLE_ATTR + ']');
  toggle.dispatchEvent({ type: 'click' });
  eq(sandbox.document.querySelector('[data-dsh-sg-ws]').getAttribute(T.WS_ATTR), T.COLLAPSED, '写入失败也要在内存里生效');
  sandbox.window.localStorage.setItem = original;
  dispose();
});

console.log('\n[5] 自愈');
reset();
{
  const { nav, header } = sandbox.dom();
  const { dispose } = boot();
  check('宿主重渲染移除箭头后自动补回', () => {
    header.removeChild(header.firstElementChild);
    sandbox.triggerObservers();
    sandbox.flushRaf();
    eq(header.firstElementChild.hasAttribute(T.TOGGLE_ATTR), true, '箭头应被补回首位');
  });
  check('宿主动态添加非白名单面板项时自动收纳', () => {
    const newRow = nav.appendChild(sandbox.document.createElement('div'));
    const btn = newRow.appendChild(sandbox.document.createElement('button'));
    btn.textContent = '测试新插件';
    const unpin = newRow.appendChild(sandbox.document.createElement('button'));
    unpin.setAttribute('aria-label', '取消固定 测试新插件');
    sandbox.triggerObservers();
    sandbox.flushRaf();
    eq(newRow.hasAttribute(T.HIDDEN_ATTR), true, '新项应自动标记隐藏并移入更多');
  });
  check('注入是幂等的（不会堆叠多个箭头）', () => {
    for (let i = 0; i < 5; i += 1) {
      sandbox.triggerObservers();
      sandbox.flushRaf();
    }
    eq(header.querySelectorAll('[' + T.TOGGLE_ATTR + ']').length, 1, '只应有 1 个箭头');
  });
  check('历史残留或多次热重载导致的多个箭头自动去重恢复为 1 个', () => {
    // 模拟热重载异常遗留了 7 个重复箭头
    for (let i = 0; i < 7; i += 1) {
      const extra = header.appendChild(sandbox.document.createElement('button'));
      extra.setAttribute(T.TOGGLE_ATTR, '');
    }
    eq(header.querySelectorAll('[' + T.TOGGLE_ATTR + ']').length, 8, '模拟构造 8 个箭头场景');
    sandbox.triggerObservers();
    sandbox.flushRaf();
    eq(header.querySelectorAll('[' + T.TOGGLE_ATTR + ']').length, 1, '自愈清理后必须严格仅剩 1 个箭头');
  });
  check('隐藏面板项的 unpin 操作具备幂等性（不重复触发 unpin 点击）', () => {
    let unpinClicks = 0;
    const testRow = nav.appendChild(sandbox.document.createElement('div'));
    const btn = testRow.appendChild(sandbox.document.createElement('button'));
    btn.textContent = '测试幂等项';
    const unpin = testRow.appendChild(sandbox.document.createElement('button'));
    unpin.setAttribute('aria-label', '取消固定 测试幂等项');
    unpin.addEventListener('click', () => { unpinClicks += 1; });
    sandbox.triggerObservers();
    sandbox.flushRaf();
    eq(unpinClicks, 1, '初次收纳应触发 1 次 unpin');
    // 后续反复触发重排调度
    sandbox.triggerObservers();
    sandbox.flushRaf();
    sandbox.triggerObservers();
    sandbox.flushRaf();
    eq(unpinClicks, 1, '后续重排严禁重复触发 unpin 点击');
  });
  check('会话树/listArea 内部的变更不触发重排（彻底杜绝打字抖动闪动）', () => {
    const listArea = sandbox.document.querySelector('[data-sidebar-list-area]');
    assert.ok(listArea !== null, 'listArea 必须存在');
    const sessionItem = listArea.appendChild(sandbox.document.createElement('div'));
    sessionItem.className = 'sessionItem';
    // 确保队列初始清空
    sandbox.flushRaf();
    eq(sandbox.rafQueue.length, 0, '初始调度队列为空');
    // 模拟会话树中发生打字更新（例如草稿输入、活跃项重绘）
    sandbox.triggerObservers([{ type: 'childList', target: sessionItem }]);
    eq(sandbox.rafQueue.length, 0, '会话列表内部变更严禁触发任何重排调度');
  });
  dispose();
}

console.log('\n[6] 折叠态的搜索窥视');
reset();
{
  const { header, root, input } = sandbox.dom();
  const { dispose } = boot();
  header.firstElementChild.dispatchEvent({ type: 'click' });
  eq(root.getAttribute(T.WS_ATTR), T.COLLAPSED, '前置：工作区已折叠');
  check('搜索框聚焦时临时展开列表', () => {
    sandbox.document.activeElement = input;
    input.dispatchEvent({ type: 'focusin' });
    eq(root.getAttribute(T.WS_ATTR), T.OPEN, '聚焦应触发窥视展开');
  });
  check('焦点离开且输入为空 → 自动收回折叠', () => {
    sandbox.document.activeElement = null;
    input.value = '';
    input.dispatchEvent({ type: 'focusout' });
    eq(root.getAttribute(T.WS_ATTR), T.COLLAPSED, '应回到折叠');
  });
  check('有输入时即使没有焦点也保持展开', () => {
    input.value = 'abc';
    input.dispatchEvent({ type: 'input' });
    eq(root.getAttribute(T.WS_ATTR), T.OPEN, '有查询词时应展开');
    input.value = '';
    input.dispatchEvent({ type: 'input' });
    eq(root.getAttribute(T.WS_ATTR), T.COLLAPSED, '清空后回到折叠');
  });
  check('窥视不改写持久化状态', () => {
    const parsed = JSON.parse(sandbox.storage.get(T.STORAGE_KEY));
    eq(parsed.workspaces, T.COLLAPSED, '存储里仍应是用户选择的折叠');
  });
  check('外部聊天框打字不触发工作区状态变更（彻底杜绝打字抖动）', () => {
    // 模拟在页面主输入区（如聊天框）输入文本
    const chatInput = sandbox.document.body.appendChild(sandbox.document.createElement('textarea'));
    chatInput.value = 'hello deepseek';
    chatInput.dispatchEvent({ type: 'input' });
    eq(root.getAttribute(T.WS_ATTR), T.COLLAPSED, '外部打字严禁改变工作区折叠态');
  });
  dispose();
}

console.log('\n[7] 卸载还原');
reset();
{
  const built = sandbox.dom();
  const { nav, header, root, scrollport } = built;
  const panelRowsBefore = nav.children.length;
  const headerChildrenBefore = header.children.length;
  const docListenersBefore = sandbox.document.listenerCount();
  const { dispose } = boot();
  assert.ok(sandbox.document.getElementById(T.STYLE_ID) !== null, '启动后应有样式元素');
  dispose();
  check('箭头节点移除', () => {
    eq(header.querySelectorAll('[' + T.TOGGLE_ATTR + ']').length, 0, '箭头应被移除');
  });
  check('面板项隐藏标记还原', () => {
    eq(nav.querySelectorAll('[' + T.HIDDEN_ATTR + ']').length, 0, '面板隐藏标记应清除');
    eq(nav.children.length, panelRowsBefore, '面板行总数不变');
  });
  check('宿主原有段头原样保留', () => {
    eq(header.children.length, headerChildrenBefore, '段头子节点数量回到注入前');
    eq(header.children[0].textContent, '工作区', '宿主段名回到首位');
  });
  check('状态属性被清除', () => {
    eq(root.hasAttribute(T.WS_ATTR), false, '根上的折叠属性应移除');
  });
  check('样式元素被移除', () => {
    eq(sandbox.document.getElementById(T.STYLE_ID), null, '不应残留 <style>');
  });
  check('文档级监听器回到基线', () => {
    eq(sandbox.document.listenerCount(), docListenersBefore, '不应残留事件监听器');
  });
  check('滚动视口与列表容器未被改动', () => {
    eq(scrollport.hasAttribute('data-sidebar-scrollport'), true, '宿主标记必须保留');
    eq(sandbox.document.querySelector('[data-sidebar-list-area]') !== null, true, '列表容器必须保留');
  });
}

console.log('\n[8] 顶部固定与平滑滚动样式断言');
check('CSS 阻断宿主滚动状态锁，保证会话列表为唯一滚动容器', () => {
  eq(T.CSS.includes('container-type:normal !important'), true, '必须取消 container-type 阻止 scroll-state 锁');
  eq(T.CSS.includes('overflow:hidden !important'), true, '外层 scrollport 必须 overflow:hidden 固定顶部面板');
});
check('CSS 赋予会话列表独立原生硬件加速丝滑滚动属性', () => {
  eq(T.CSS.includes('scroll-behavior:auto !important'), true, '列表交由原生 GPU 合成线程滚动');
  eq(T.CSS.includes('overflow-y:auto !important'), true, '列表必须为独立滚动容器');
  eq(T.CSS.includes('overscroll-behavior-y:contain !important'), true, '隔离滚动边界防外泄');
  eq(T.CSS.includes('will-change:scroll-position'), true, '开启硬件加速滚动');
});
check('CSS 保持原生 Grid 架构并杜绝破坏性 contain 截断', () => {
  eq(T.CSS.includes('grid-template-rows:8px max-content 2px minmax(0, 1fr) !important'), true, '将第 4 行自适应网格高度');
  eq(T.CSS.includes('[data-slot="sidebar.workspaces"]{'), true, '保留宿主 SlotOutlet 的 display:contents 语义');
  eq(T.CSS.includes('[data-slot="sidebar.workspaces"] > div'), true, '穿透 SlotOutlet 约束工作区浏览器根节点高度');
  eq(T.CSS.includes('max-height:100% !important'), true, '覆写宿主 100cqh 防止工作区撑爆 scrollport');
  eq(T.CSS.includes('contain:layout paint'), false, '绝不可对列表施加 contain:paint 截断悬浮菜单');
  eq(T.CSS.includes('transform:translateZ'), false, '绝不可对列表施加 transform 创建层叠上下文');
});

reset();
{
  const built = sandbox.dom();
  const { nav, header, scrollport, listArea } = built;
  const scrollportListenersBefore = scrollport.listenerCount();
  const listAreaListenersBefore = listArea.listenerCount();
  let hostHandoffCalls = 0;
  const simulatedHostHandoff = () => { hostHandoffCalls += 1; };
  // 模拟宿主 React 在插件加载前在 scrollport 上绑定的冒泡阶段 scroll-handoff 监听器
  scrollport.addEventListener('wheel', simulatedHostHandoff, { passive: false });

  const { dispose } = boot();

  check('光标在顶部面板滚轮时先于宿主 scroll-handoff 接管并转发至会话列表', () => {
    eq(listArea.scrollTop || 0, 0, '初始列表 scrollTop 应为 0');
    // 模拟鼠标滚轮 1 档（deltaMode=1, deltaY=3），落在 nav 上
    nav.dispatchEvent({ type: 'wheel', deltaY: 3, deltaMode: 1 });
    eq(listArea.scrollTop, 108, '滚轮增量应转换为 108px 并作用在 listArea 上');
    eq(scrollport.scrollTop || 0, 0, '外层 scrollport 必须保持 0 不位移');
    eq(hostHandoffCalls, 0, '顶部固定区滚轮严禁穿透给宿主 scroll-handoff');
  });

  check('光标在工作区段头滚轮时精确平滑转发至会话列表', () => {
    header.dispatchEvent({ type: 'wheel', deltaY: -1, deltaMode: 1 });
    eq(listArea.scrollTop, 72, '向上滚动 1 行应精准减少 36px');
    eq(scrollport.scrollTop || 0, 0, '外层 scrollport 必须保持 0 不位移');
    eq(hostHandoffCalls, 0, '段头滚轮严禁穿透给宿主 scroll-handoff');
  });

  check('光标在列表内滚动时不调用 preventDefault 且阻断向宿主 scroll-handoff 冒泡', () => {
    const row = listArea.appendChild(sandbox.document.createElement('div'));
    let prevented = false;
    row.dispatchEvent({
      type: 'wheel',
      deltaY: 100,
      deltaMode: 0,
      preventDefault() { prevented = true; },
    });
    eq(prevented, false, '列表内滚动必须放行浏览器原生默认滚动');
    eq(hostHandoffCalls, 0, '列表内滚轮不得冒泡触发宿主 scroll-handoff 抢占');
  });

  check('外层 scrollport 发生意外滚动时自动复位为 0', () => {
    scrollport.scrollTop = 48;
    scrollport.dispatchEvent({ type: 'scroll' });
    eq(scrollport.scrollTop, 0, '外层 scrollport 必须自动归零锁死顶部面板');
  });

  dispose();
  scrollport.removeEventListener('wheel', simulatedHostHandoff, { passive: false });

  check('卸载后滚动视口与列表监听器全部归零还原', () => {
    eq(scrollport.listenerCount(), scrollportListenersBefore, 'scrollport 监听器应还原');
    eq(listArea.listenerCount(), listAreaListenersBefore, 'listArea 监听器应还原');
  });
}

console.log('\n[9] 「更多」菜单拖拽与自由重排序');
reset();
{
  const built = sandbox.dom();
  const { dispose } = boot();
  // 模拟打开更多菜单：在 body 中创建一个带有更多菜单项的弹窗
  const menu = sandbox.document.body.appendChild(sandbox.document.createElement('div'));
  menu.setAttribute('role', 'menu');

  const createMenuItem = (title) => {
    const item = menu.appendChild(sandbox.document.createElement('div'));
    item.className = 'sidebarEntry';
    const btn = item.appendChild(sandbox.document.createElement('button'));
    const titleSpan = btn.appendChild(sandbox.document.createElement('span'));
    titleSpan.className = 'entryTitle';
    titleSpan.textContent = title;
    const pin = item.appendChild(sandbox.document.createElement('span'));
    pin.className = 'pinAnchor';
    return item;
  };

  const itemA = createMenuItem('自动化任务');
  const itemB = createMenuItem('GitHub');
  const itemC = createMenuItem('热榜');

  sandbox.triggerObservers();
  sandbox.flushRaf();

  check('更多菜单项被装配 draggable 与抓取光标', () => {
    eq(itemA.hasAttribute(T.DRAGGABLE_ATTR), true, '项 A 应为可拖拽');
    eq(itemB.hasAttribute(T.DRAGGABLE_ATTR), true, '项 B 应为可拖拽');
    eq(itemC.hasAttribute(T.DRAGGABLE_ATTR), true, '项 C 应为可拖拽');
  });

  check('模拟拖拽热榜到首位并持久化顺序', () => {
    // 模拟热榜拖拽到项 A 之上
    itemC.dispatchEvent({ type: 'dragstart' });
    itemA.dispatchEvent({ type: 'dragover', clientY: 5 });
    itemA.dispatchEvent({ type: 'drop', clientY: 5 });
    itemC.dispatchEvent({ type: 'dragend' });

    const savedOrder = T.readMoreOrder();
    eq(savedOrder[0], '热榜', '热榜应成为第 1 项');
    eq(menu.children[0], itemC, 'DOM 中热榜已被移到首位');
  });

  check('真实宿主嵌套结构下的条目识别与重排', () => {
    // 模拟 DSH 真实的嵌套层级：menu -> viewport -> sidebarEntry
    const hostMenu = sandbox.document.body.appendChild(sandbox.document.createElement('div'));
    hostMenu.setAttribute('role', 'menu');
    hostMenu.className = 'surface moreMenu';
    const mat = hostMenu.appendChild(sandbox.document.createElement('div'));
    mat.className = 'material';
    const vp = hostMenu.appendChild(sandbox.document.createElement('div'));
    vp.className = 'viewport';
    vp.setAttribute('role', 'presentation');

    const createNestedItem = (title) => {
      const it = vp.appendChild(sandbox.document.createElement('div'));
      it.className = 'sidebarEntry';
      const b = it.appendChild(sandbox.document.createElement('button'));
      const s = b.appendChild(sandbox.document.createElement('span'));
      s.className = 'entryTitle';
      s.textContent = title;
      const p = it.appendChild(sandbox.document.createElement('span'));
      p.className = 'pinAnchor';
      return it;
    };

    const nA = createNestedItem('任务A');
    const nB = createNestedItem('任务B');

    sandbox.triggerObservers();
    sandbox.flushRaf();

    eq(nA.hasAttribute(T.DRAGGABLE_ATTR), true, '嵌套条目 A 应被装配 draggable');
    eq(nB.hasAttribute(T.DRAGGABLE_ATTR), true, '嵌套条目 B 应被装配 draggable');

    // 拖拽 B 到 A 之上
    nB.dispatchEvent({ type: 'dragstart' });
    nA.dispatchEvent({ type: 'dragover', clientY: 2 });
    nA.dispatchEvent({ type: 'drop', clientY: 2 });
    nB.dispatchEvent({ type: 'dragend' });

    eq(vp.children[0], nB, 'DOM 中任务B已被移到首位');
    const order = T.readMoreOrder();
    eq(order[0], '任务B', '持久化中任务B为首位');
  });

  dispose();
}

console.log('\n[10] 多语言');
reset();
{
  const { header } = sandbox.dom();
  const { dispose } = boot('en');
  check('英文环境使用英文文案', () => {
    const toggle = header.firstElementChild;
    eq(toggle.getAttribute('aria-label'), 'Collapse workspaces 工作区', '英文展开文案');
  });
  dispose();
}

console.log('\n[11] 样式只用主题令牌');
check('CSS 不含写死的颜色值', () => {
  const hardcoded = T.CSS.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) ?? [];
  eq(hardcoded.length, 0, '不应出现写死颜色，实际：' + hardcoded.join(','));
});
check('CSS 引用了主题令牌', () => {
  for (const token of ['--dsw-alias-label-secondary', '--dsw-alias-interactive-bg-hover', '--dsw-radius-sm']) {
    eq(T.CSS.includes(token), true, '应使用 ' + token);
  }
});
check('CSS 尊重减少动态效果偏好', () => {
  eq(T.CSS.includes('prefers-reduced-motion'), true, '应包含 prefers-reduced-motion');
});


/* ------------------------------------------------------------------ *
 * 收尾：还原全局，输出结论
 * ------------------------------------------------------------------ */
for (const key of Object.keys(saved)) {
  if (saved[key] === undefined) delete g[key];
  else g[key] = saved[key];
}

console.log('\n通过 ' + passed + ' 项断言。\n');
