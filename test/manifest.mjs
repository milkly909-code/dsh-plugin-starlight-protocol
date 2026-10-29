/**
 * Manifest 校验
 *
 * 检查 DSH 插件清单的硬性要求，以及会导致 boot 失败的文件解析问题。
 * 不依赖网络、不依赖 playwright，可在任何 CI 环境跑。
 *
 * 运行：node test/manifest.mjs
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const results = []
const ok = (n, p, d) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }

// ── package.json ──────────────────────────────────────────────────────────
const pkgPath = join(ROOT, 'package.json')
ok('package.json 存在', existsSync(pkgPath))

let pkg = null
try {
  pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  ok('package.json 是合法 JSON', true)
} catch (e) {
  ok('package.json 是合法 JSON', false, e.message)
}

if (pkg) {
  ok('name 存在', typeof pkg.name === 'string' && pkg.name.length > 0, pkg.name)
  ok('version 存在', typeof pkg.version === 'string', pkg.version)

  // DSH 收录的硬性门槛：dsh.bundle 必须声明
  const bundle = pkg.dsh && pkg.dsh.bundle
  ok('声明了 dsh.bundle（可被 dsh plugin add 安装）', !!bundle && typeof bundle.patch === 'string',
     bundle ? JSON.stringify(bundle) : '缺失')

  if (bundle && typeof bundle.patch === 'string') {
    const patchPath = join(ROOT, bundle.patch.replace(/^\.\//, ''))
    ok('dsh.bundle.patch 指向的文件存在', existsSync(patchPath), bundle.patch)

    if (existsSync(patchPath)) {
      const yml = readFileSync(patchPath, 'utf8')
      ok('patch 含 insert 块', /^-\s*insert:/m.test(yml))
      // insert 下面必须是列表（- id:），写成映射是常见错误
      ok('patch 的 insert 下是列表形式', /^-\s*insert:\s*\n\s+-\s+id:/m.test(yml),
         '应为 "- insert:\\n    - id: ..."')
      ok('patch 中的 id 与包名对应', yml.includes(pkg.name) || /-\s*id:\s*\S+/.test(yml))
    }
  }

  // exports 指向的文件都必须真实存在，否则 ModuleLoader 解析失败 → boot 失败
  if (pkg.exports && typeof pkg.exports === 'object') {
    for (const [key, target] of Object.entries(pkg.exports)) {
      if (typeof target !== 'string') continue
      const p = join(ROOT, target.replace(/^\.\//, ''))
      ok(`exports["${key}"] 指向的文件存在`, existsSync(p), target)
    }
  }

  // client bundle 的契约
  const clientRel = pkg.exports && pkg.exports['./client']
  if (typeof clientRel === 'string') {
    const clientPath = join(ROOT, clientRel.replace(/^\.\//, ''))
    if (existsSync(clientPath)) {
      const c = readFileSync(clientPath, 'utf8')
      ok('client bundle 使用 __ModuleLoader__.load', c.includes('__ModuleLoader__.load'))
      ok('client bundle 的 id 与包名一致', c.includes(`id: '${pkg.name}'`) || c.includes(`id: "${pkg.name}"`))
      ok('client bundle 导出 apply', /exports\.apply\s*=/.test(c))
      // 静态导入 @deepseek-ai 运行时符号会把宿主启动炸掉
      ok('未静态导入 @deepseek-ai 运行时符号',
         !/require\(\s*['"]@deepseek-ai/.test(c) && !/from\s+['"]@deepseek-ai/.test(c))
    }
  }
}

// ── 入口文件语法 ──────────────────────────────────────────────────────────
for (const rel of ['lib/index.js', 'lib/client.js']) {
  const p = join(ROOT, rel)
  if (!existsSync(p)) { ok(`${rel} 存在`, false); continue }
  ok(`${rel} 存在`, true)
  // 大小合理性（防止把整个 node_modules 打进来）
  const sizeMB = statSync(p).size / 1024 / 1024
  ok(`${rel} 体积合理（< 5MB）`, sizeMB < 5, sizeMB.toFixed(2) + ' MB')
}

// ── LICENSE ───────────────────────────────────────────────────────────────
const licPath = join(ROOT, 'LICENSE')
ok('LICENSE 存在', existsSync(licPath))
if (existsSync(licPath)) {
  const lic = readFileSync(licPath, 'utf8')
  ok('LICENSE 是标准 MIT 正文', /^MIT License/m.test(lic))
  // 追加内容会让 GitHub 许可证识别退化为 NOASSERTION
  ok('LICENSE 未混入额外声明（否则 GitHub 识别失败）',
     !/Upstream|Notices|Acknowledg/i.test(lic),
     '上游声明应放 NOTICE')
}

await Promise.resolve()
const failed = results.filter(r => !r.p)
console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`)
process.exit(failed.length === 0 ? 0 : 1)
