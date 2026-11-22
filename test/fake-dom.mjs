/**
 * 极简假 DOM：只实现 client.js 实际用到的那一小撮 API。
 *
 * 支持的能力（多一个都没有）：
 *   - createElement / createElementNS、appendChild / insertBefore / removeChild / remove
 *   - setAttribute / getAttribute / removeAttribute / hasAttribute、id、textContent
 *   - children / firstElementChild / parentNode / isConnected
 *   - querySelector（选择器只支持：标签名、[attr]、[attr="value"]，以及空格分隔的后代组合）
 *   - addEventListener / removeEventListener / dispatchEvent
 *   - document.head / body / documentElement / activeElement / getElementById
 *
 * 目的不是"模拟浏览器"，而是让引擎的注入 / 折叠 / 自愈 / 还原逻辑能在 Node 里被断言。
 */

/** 一个元素节点。 */
class El {
  /** @param {string} tagName 标签名。 */
  constructor(tagName) {
    /** @type {string} 大写标签名。 */
    this.tagName = tagName.toUpperCase();
    /** @type {string} 小写本地名。 */
    this.localName = tagName.toLowerCase();
    /** @type {number} 元素节点类型；真实 DOM 里元素都是 1，插件靠它做鸭子类型判定。 */
    this.nodeType = 1;
    /** @type {Map<string, string>} 属性表。 */
    this.attributes = new Map();
    /** @type {El[]} 子元素。 */
    this.childNodes = [];
    /** @type {El | null} 父节点。 */
    this.parentNode = null;
    /** @type {Record<string, string>} 内联样式（只是普通对象）。 */
    this.style = {};
    /** @type {string} 输入框当前值（只有 input 有意义）。 */
    this.value = '';
    /** @type {Map<string, Set<Function>>} 监听器。 */
    this.listeners = new Map();
  }

  /** @returns {El[]} 子元素列表。 */
  get children() { return this.childNodes.filter(node => node instanceof El); }

  /** @returns {El | null} 父元素（文档节点没有父元素）。 */
  get parentElement() {
    return this.parentNode instanceof El ? this.parentNode : null;
  }

  /** @returns {El | null} 第一个子元素。 */
  get firstElementChild() { return this.children[0] ?? null; }

  /** @returns {El | null} 下一个兄弟节点。 */
  get nextSibling() {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    return idx >= 0 && idx < this.parentNode.childNodes.length - 1 ? this.parentNode.childNodes[idx + 1] : null;
  }

  /** @returns {El | string | null} 第一个子节点（含文本节点）。 */
  get firstChild() { return this.childNodes[0] ?? null; }

  /** @returns {El | string | null} 最后一个子节点（含文本节点）。 */
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }

  /** @returns {boolean} 是否挂在文档上。 */
  get isConnected() {
    let node = this;
    while (node.parentNode !== null) node = node.parentNode;
    return node === this.ownerDocument?.documentElement || node === this.ownerDocument;
  }

  /** @returns {string} id（从属性表取）。 */
  get id() { return this.getAttribute('id') ?? ''; }

  /** @param {string} value id。 */
  set id(value) { this.setAttribute('id', value); }

  /** @returns {string} 递归文本。 */
  get textContent() {
    return this.childNodes.map(node => (node instanceof El ? node.textContent : String(node))).join('');
  }

  /** @param {string} value 文本：替换为单个文本子节点。 */
  set textContent(value) {
    this.childNodes = [];
    if (value !== '') this.childNodes.push(String(value));
  }

  /**
   * 设置属性。
   * @param {string} name 属性名。
   * @param {string} value 值。
   * @returns {void}
   */
  setAttribute(name, value) { this.attributes.set(String(name).toLowerCase(), String(value)); }

  /**
   * 读取属性。
   * @param {string} name 属性名。
   * @returns {string | null} 值。
   */
  getAttribute(name) {
    const key = String(name).toLowerCase();
    return this.attributes.has(key) ? this.attributes.get(key) : null;
  }

  /**
   * 删除属性。
   * @param {string} name 属性名。
   * @returns {void}
   */
  removeAttribute(name) { this.attributes.delete(String(name).toLowerCase()); }

  /**
   * 是否带某属性。
   * @param {string} name 属性名。
   * @returns {boolean} 结果。
   */
  hasAttribute(name) { return this.attributes.has(String(name).toLowerCase()); }

  /**
   * 克隆节点。
   * @param {boolean} deep 是否深拷贝。
   * @returns {El} 克隆节点。
   */
  cloneNode(deep = false) {
    const clone = new El(this.tagName);
    for (const [k, v] of this.attributes.entries()) {
      clone.attributes.set(k, v);
    }
    clone.style = { ...this.style };
    clone.value = this.value;
    if (deep) {
      for (const child of this.childNodes) {
        if (child instanceof El) {
          clone.appendChild(child.cloneNode(true));
        } else {
          clone.childNodes.push(String(child));
        }
      }
    }
    return clone;
  }

  /**
   * 追加子节点。
   * @param {El} child 子节点。
   * @returns {El} 子节点。
   */
  appendChild(child) {
    if (child.parentNode !== null) child.parentNode.removeChild(child);
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.childNodes.push(child);
    return child;
  }

  /**
   * 在参考节点前插入（null = 追加到末尾）。
   * @param {El} child 子节点。
   * @param {El | null} reference 参考节点。
   * @returns {El} 子节点。
   */
  insertBefore(child, reference) {
    if (child === this || child === reference) return child;
    if (reference === null || reference === undefined) return this.appendChild(child);
    if (child.parentNode !== null) child.parentNode.removeChild(child);
    const index = this.childNodes.indexOf(reference);
    if (index < 0) return this.appendChild(child);
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.childNodes.splice(index, 0, child);
    return child;
  }

  /**
   * 移除子节点。
   * @param {El} child 子节点。
   * @returns {El} 子节点。
   */
  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  /** 从父节点上摘掉自己。 */
  remove() { this.parentNode?.removeChild(this); }

  /**
   * 滚动指定距离。
   * @param {{top?: number} | number} opts 偏移量。
   * @returns {void}
   */
  scrollBy(opts) {
    if (typeof opts === 'object' && opts !== null) {
      this.scrollTop = (this.scrollTop || 0) + (opts.top || 0);
    } else if (typeof opts === 'number') {
      this.scrollTop = (this.scrollTop || 0) + opts;
    }
  }

  /**
   * 找第一个匹配的后代。
   * @param {string} selector 选择器。
   * @returns {El | null} 匹配元素。
   */
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }

  /**
   * 找全部匹配的后代（含顺序）。
   * @param {string} selector 选择器。
   * @returns {El[]} 匹配元素。
   */
  querySelectorAll(selector) {
    if (selector.includes(',')) {
      const out = [];
      const seen = new Set();
      for (const sel of selector.split(',')) {
        const trimmed = sel.trim();
        if (!trimmed) continue;
        for (const el of this.querySelectorAll(trimmed)) {
          if (!seen.has(el)) {
            seen.add(el);
            out.push(el);
          }
        }
      }
      return out;
    }
    const parts = selector.trim().split(/\s+/).map(parsePart);
    const out = [];
    const visit = (node, depth) => {
      for (const child of node.childNodes) {
        if (!(child instanceof El)) continue;
        if (matchesChain(child, parts, depth)) out.push(child);
        visit(child, depth + 1);
      }
    };
    visit(this, 0);
    return out;
  }

  /**
   * 注册监听器。
   * @param {string} type 事件名。
   * @param {Function} listener 回调。
   * @param {boolean | {capture?: boolean}} [options] 选项。
   * @returns {void}
   */
  addEventListener(type, listener, options) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, { capture: new Set(), bubble: new Set() });
    }
    const capture = options === true || (typeof options === 'object' && options !== null && options.capture === true);
    const bucket = this.listeners.get(type);
    (capture ? bucket.capture : bucket.bubble).add(listener);
  }

  /**
   * 移除监听器。
   * @param {string} type 事件名。
   * @param {Function} listener 回调。
   * @param {boolean | {capture?: boolean}} [options] 选项。
   * @returns {void}
   */
  removeEventListener(type, listener, options) {
    const bucket = this.listeners.get(type);
    if (!bucket) return;
    if (options === undefined) {
      bucket.capture.delete(listener);
      bucket.bubble.delete(listener);
      return;
    }
    const capture = options === true || (typeof options === 'object' && options !== null && options.capture === true);
    (capture ? bucket.capture : bucket.bubble).delete(listener);
  }

  /**
   * 从当前元素向上查找最近匹配的祖先（含自身）。
   * 仅支持 [attr]、[attr="value"] 和标签名选择器。
   * @param {string} selector 选择器。
   * @returns {El | null} 结果。
   */
  closest(selector) {
    const parts = selector.trim().split(/\s+/).map(parsePart);
    // closest 只判最后一个片段（简化实现，测试场景用不到后代组合）
    const part = parts[parts.length - 1];
    let node = this;
    while (node !== null) {
      if (node instanceof El && matchesPart(node, part)) return node;
      node = node.parentNode;
    }
    return null;
  }

  /**
   * 是否包含目标节点。
   * @param {El | null} node 目标节点。
   * @returns {boolean} 是否包含。
   */
  contains(node) {
    let cur = node;
    while (cur !== null) {
      if (cur === this) return true;
      cur = cur.parentNode;
    }
    return false;
  }

  /**
   * 派发事件（先捕获后冒泡，支持 stopPropagation）。
   * @param {{type: string, target?: El, stopPropagation?: Function}} event 事件对象。
   * @returns {void}
   */
  dispatchEvent(event) {
    if (event.target === undefined) event.target = this;
    let stopped = false;
    const origStop = event.stopPropagation;
    event.stopPropagation = () => {
      stopped = true;
      if (typeof origStop === 'function') origStop.call(event);
    };
    const path = [];
    let node = this;
    while (node !== null) {
      path.push(node);
      node = node.parentNode;
    }
    for (let i = path.length - 1; i >= 0 && !stopped; i -= 1) {
      const bucket = path[i].listeners.get(event.type);
      if (!bucket) continue;
      for (const listener of [...bucket.capture]) {
        listener(event);
        if (stopped) break;
      }
    }
    for (let i = 0; i < path.length && !stopped; i += 1) {
      const bucket = path[i].listeners.get(event.type);
      if (!bucket) continue;
      for (const listener of [...bucket.bubble]) {
        listener(event);
        if (stopped) break;
      }
    }
  }

  /**
   * 触发点击。
   * @returns {void}
   */
  click() {
    this.dispatchEvent({ type: 'click', target: this });
  }

  /**
   * 该元素的监听器总数（用于断言清理干净）。
   * @returns {number} 数量。
   */
  listenerCount() {
    let total = 0;
    for (const bucket of this.listeners.values()) {
      total += bucket.capture.size + bucket.bubble.size;
    }
    return total;
  }
}

/**
 * 解析一个选择器片段。
 * @param {string} part 片段。
 * @returns {{tag: string | null, attrs: Array<[string, string | null, string]>}} 解析结果。
 */
function parsePart(part) {
  const attrs = [];
  let tag = null;
  let remaining = part;
  const tagMatch = /^([a-zA-Z][\w-]*)/.exec(remaining);
  if (tagMatch) {
    tag = tagMatch[1].toLowerCase();
    remaining = remaining.slice(tagMatch[0].length);
  }
  const classPattern = /\.([a-zA-Z0-9_-]+)/g;
  let cm = classPattern.exec(remaining);
  while (cm !== null) {
    attrs.push(['class', cm[1], '=']);
    cm = classPattern.exec(remaining);
  }
  const attrPattern = /\[([\w-]+)(?:([*^$]?=)(["']?)(.*?)\3)?\]/g;
  let match = attrPattern.exec(remaining);
  while (match !== null) {
    attrs.push([match[1].toLowerCase(), match[4] === undefined ? null : match[4], match[2] || '']);
    match = attrPattern.exec(remaining);
  }
  return { tag, attrs };
}

/**
 * 单个片段是否匹配。
 * @param {El} node 元素。
 * @param {{tag: string | null, attrs: Array<[string, string | null, string]>}} part 片段。
 * @returns {boolean} 结果。
 */
function matchesPart(node, part) {
  if (part.tag !== null && node.localName !== part.tag) return false;
  if (part.tag === null && part.attrs.length === 0) return false;
  for (const [name, value, op] of part.attrs) {
    if (name === 'class') {
      const cls = node.className || node.getAttribute('class') || '';
      if (op === '*=') {
        if (!cls.includes(value)) return false;
      } else if (op === '^=') {
        if (!cls.startsWith(value)) return false;
      } else if (op === '$=') {
        if (!cls.endsWith(value)) return false;
      } else {
        const classes = cls.trim().split(/\s+/);
        if (!classes.includes(value)) return false;
      }
    } else {
      if (!node.hasAttribute(name)) return false;
      if (value !== null) {
        const actual = node.getAttribute(name);
        if (op === '*=') {
          if (!actual || !actual.includes(value)) return false;
        } else if (op === '^=') {
          if (!actual || !actual.startsWith(value)) return false;
        } else if (op === '$=') {
          if (!actual || !actual.endsWith(value)) return false;
        } else {
          if (actual !== value) return false;
        }
      }
    }
  }
  return true;
}

/**
 * 后代链是否匹配（最后一个片段落在 node 上，前面的由祖先依次向上满足）。
 * @param {El} node 候选元素。
 * @param {Array<{tag: string | null, attrs: Array<[string, string | null]>}>} parts 片段序列。
 * @param {number} depth 无关参数（保留签名对称）。
 * @returns {boolean} 结果。
 */
function matchesChain(node, parts, depth) {
  void depth;
  if (!matchesPart(node, parts[parts.length - 1])) return false;
  let index = parts.length - 2;
  let current = node.parentNode;
  while (index >= 0) {
    let found = false;
    while (current !== null) {
      if (current instanceof El && matchesPart(current, parts[index])) { found = true; break; }
      current = current.parentNode;
    }
    if (!found) return false;
    current = current.parentNode;
    index -= 1;
  }
  return true;
}

/** 极简文档。 */
class Doc {
  constructor() {
    this.documentElement = new El('html');
    this.head = this.documentElement.appendChild(new El('head'));
    this.body = this.documentElement.appendChild(new El('body'));
    this.documentElement.ownerDocument = this;
    this.head.ownerDocument = this;
    this.body.ownerDocument = this;
    this.activeElement = null;
    this.listeners = new Map();
  }

  /**
   * 建元素。
   * @param {string} tagName 标签名。
   * @returns {El} 元素。
   */
  createElement(tagName) {
    const element = new El(tagName);
    element.ownerDocument = this;
    return element;
  }

  /**
   * 建命名空间元素（本测试不需要区分命名空间）。
   * @param {string} _namespace 命名空间。
   * @param {string} tagName 标签名。
   * @returns {El} 元素。
   */
  createElementNS(_namespace, tagName) {
    const element = new El(tagName);
    element.ownerDocument = this;
    return element;
  }

  /**
   * 查第一个匹配。
   * @param {string} selector 选择器。
   * @returns {El | null} 元素。
   */
  querySelector(selector) { return this.documentElement.querySelector(selector); }

  /**
   * 查全部匹配。
   * @param {string} selector 选择器。
   * @returns {El[]} 元素。
   */
  querySelectorAll(selector) { return this.documentElement.querySelectorAll(selector); }

  /**
   * 按 id 查（用于断言样式元素被卸载）。
   * @param {string} id 元素 id。
   * @returns {El | null} 元素。
   */
  getElementById(id) {
    const stack = [this.documentElement];
    while (stack.length > 0) {
      const node = stack.pop();
      for (const child of node.childNodes) {
        if (!(child instanceof El)) continue;
        if (child.getAttribute('id') === id) return child;
        stack.push(child);
      }
    }
    return null;
  }

  /**
   * 注册文档级监听器。
   * @param {string} type 事件名。
   * @param {Function} listener 回调。
   * @param {boolean | {capture?: boolean}} [options] 选项。
   * @returns {void}
   */
  addEventListener(type, listener, options) { this.documentElement.addEventListener(type, listener, options); }

  /**
   * 移除文档级监听器。
   * @param {string} type 事件名。
   * @param {Function} listener 回调。
   * @param {boolean | {capture?: boolean}} [options] 选项。
   * @returns {void}
   */
  removeEventListener(type, listener, options) { this.documentElement.removeEventListener(type, listener, options); }

  /**
   * 文档级监听器总数（断言清理干净）。
   * @returns {number} 数量。
   */
  listenerCount() { return this.documentElement.listenerCount(); }
}

/**
 * 建一套沙箱环境。
 * @returns {{window: any, document: Doc, flushRaf: () => void, triggerObservers: () => void, storage: Map<string,string>, dom: (parts: any) => any}} 环境。
 */
export function createSandbox() {
  const document = new Doc();
  const storage = new Map();
  const rafQueue = [];
  const observers = [];
  const windowListeners = new Map();

  const window = {
    document,
    localStorage: {
      /**
       * 读。
       * @param {string} key 键。
       * @returns {string | null} 值。
       */
      getItem: key => (storage.has(key) ? storage.get(key) : null),
      /**
       * 写。
       * @param {string} key 键。
       * @param {string} value 值。
       * @returns {void}
       */
      setItem: (key, value) => { storage.set(key, String(value)); },
      /**
       * 删。
       * @param {string} key 键。
       * @returns {void}
       */
      removeItem: key => { storage.delete(key); },
    },
    /**
     * 排队一次帧回调。
     * @param {Function} callback 回调。
     * @returns {number} 帧 id。
     */
    requestAnimationFrame(callback) {
      rafQueue.push(callback);
      return rafQueue.length;
    },
    /**
     * 取消帧回调（本假实现直接忽略）。
     * @returns {void}
     */
    cancelAnimationFrame() {},
    /**
     * 注册窗口级监听器。
     * @param {string} type 事件名。
     * @param {Function} listener 回调。
     * @returns {void}
     */
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type).add(listener);
    },
    /**
     * 移除窗口级监听器。
     * @param {string} type 事件名。
     * @param {Function} listener 回调。
     * @returns {void}
     */
    removeEventListener(type, listener) { windowListeners.get(type)?.delete(listener); },
  };

  /** 假 MutationObserver：只在测试显式触发时回调。 */
  class MutationObserver {
    /** @param {Function} callback 回调。 */
    constructor(callback) {
      this.callback = callback;
      this.active = false;
      observers.push(this);
    }

    /** @param {any} target 观察目标（忽略）。 */
    observe(target) { void target; this.active = true; }

    /** 停止观察。 */
    disconnect() { this.active = false; }
  }

  /**
   * 冲刷 rAF 队列（引擎用它合并重排）。
   * @returns {void}
   */
  const flushRaf = () => {
    while (rafQueue.length > 0) {
      const queue = rafQueue.splice(0, rafQueue.length);
      for (const callback of queue) callback(0);
    }
  };

  /**
   * 触发所有活跃观察器（模拟宿主的 React 重渲染）。
   * @param {Array<any>} [mutations] 变动记录。
   * @returns {void}
   */
  const triggerObservers = (mutations = []) => {
    for (const observer of observers) if (observer.active) observer.callback(mutations, observer);
  };

  /**
   * 组装一个侧栏 DOM 结构（形状对齐宿主真实结构）。
   * @param {{panels?: boolean, workspaces?: boolean, input?: boolean}} [options] 结构开关。
   * @returns {{nav: El, scrollport: El, header: El, root: El, input: El | null}} 结构元素。
   */
  const dom = (options = {}) => {
    const { panels = true, workspaces = true, input = true } = options;
    const sidebar = document.body.appendChild(new El('div'));
    const scrollport = sidebar.appendChild(new El('div'));
    scrollport.setAttribute('data-sidebar-scrollport', '');
    let nav = null;
    if (panels) {
      nav = scrollport.appendChild(new El('nav'));
      for (const label of ['插件', '插件市场', '上下文洞察', '自动化任务', 'GitHub', '热榜']) {
        const row = nav.appendChild(new El('div'));
        const button = row.appendChild(new El('button'));
        const title = button.appendChild(new El('span'));
        title.textContent = label;
        const unpin = row.appendChild(new El('button'));
        unpin.setAttribute('aria-label', '取消固定 ' + label);
      }
      const moreRow = nav.appendChild(new El('div'));
      const moreBtn = moreRow.appendChild(new El('button'));
      moreBtn.setAttribute('aria-haspopup', 'menu');
      moreBtn.setAttribute('aria-label', '更多');
      const moreTitle = moreBtn.appendChild(new El('span'));
      moreTitle.textContent = '更多';
    }
    const root = scrollport.appendChild(new El('div'));
    let header = null;
    let inputEl = null;
    if (workspaces) {
      header = root.appendChild(new El('div'));
      header.setAttribute('data-sidebar-workspace-header', '');
      const label = header.appendChild(new El('span'));
      label.textContent = '工作区';
      if (input) {
        inputEl = header.appendChild(new El('input'));
      }
    }
    const listArea = root.appendChild(new El('div'));
    listArea.setAttribute('data-sidebar-list-area', '');
    return { nav, scrollport, header, root, input: inputEl, listArea };
  };

  return { window, document, storage, flushRaf, triggerObservers, dom, MutationObserver, windowListeners, rafQueue };
}
