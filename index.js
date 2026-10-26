/** Host half of @local/space-background.
 *
 * 纯客户端插件：星空引擎、面板与全局背景全部运行在 Web 侧
 * （window.__ModuleLoader__.load 加载 client.js），Host 半无需行为——
 * 与 @deepseek-ai/dsh-client-ui-layout 的空 apply 同构。
 *
 * 若未来要把设置写入域存储（跨设备同步），在此扩展
 * ctx.get('storageDomain').open(spec)，Client 侧经 host.call 调用。
 */
export function apply() {}
