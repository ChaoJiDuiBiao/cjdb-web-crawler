import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const usage = `用法：npm run release -- <版本号> --notes '多行发布说明'

示例：
npm run release -- 2.0.2 --notes '- 新增微信交流入口
- 移除内嵌使用文档'

请先提交待发布代码，并切换到 origin 对应仓库的默认分支。
脚本将更新版本、构建 ZIP、提交、推送并发布 GitHub Release。`

export function parseArgs(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return null
  const [version, flag, notes] = args
  if (args.length !== 3 || flag !== '--notes' || !notes?.trim())
    throw new Error(usage)
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
      version.split('.').some(part => Number(part) > 65535))
    throw new Error('版本号必须是 X.Y.Z，每段为 0–65535 的整数。')
  return { version, notes }
}

function execute(command, args, cwd, live = false) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: live ? 'inherit' : 'pipe',
    // Pass arguments directly: release notes are text, never shell code.
    shell: false,
  })
  if (result.error || result.status !== 0)
    throw new Error(`${command} ${args[0] || ''} 失败：${result.error?.message || result.stderr?.trim() || result.status}`)
  return result.stdout?.trim() || ''
}

export function release({ version, notes }, {
  root = dirname(dirname(fileURLToPath(import.meta.url))),
  run = execute,
} = {}) {
  const cmd = (name, args, live = false) => run(name, args, root, live)
  const git = (...args) => cmd('git', args)
  const pkgPath = join(root, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const current = pkg.version.split('.').map(Number)
  const next = version.split('.').map(Number)
  const difference = next.findIndex((value, i) => value !== current[i])
  if (difference === -1 || next[difference] < current[difference])
    throw new Error(`新版本必须高于当前版本 ${pkg.version}。`)
  if (git('status', '--porcelain'))
    throw new Error('存在未提交修改。请先单独提交待发布代码，并处理本机配置；脚本不会自动提交这些文件。')

  // Resolve the publishing repository from origin, not the user's gh default.
  const origin = git('remote', 'get-url', 'origin')
  const match = origin.match(/^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?$/)
  if (!match) throw new Error('origin 必须是 github.com 仓库地址。')
  const repo = `${match[1]}/${match[2]}`
  cmd('gh', ['auth', 'status', '--hostname', 'github.com'])
  const branch = cmd('gh', ['api', `repos/${repo}`, '--jq', '.default_branch'])
  if (git('branch', '--show-current') !== branch)
    throw new Error(`请切换到默认分支 ${branch} 再发布。`)
  git('fetch', 'origin', branch)
  git('merge-base', '--is-ancestor', `origin/${branch}`, 'HEAD')
  const tag = `v${version}`
  if (git('tag', '--list', tag) || git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`))
    throw new Error(`${tag} 标签已存在，不覆盖已有版本。`)
  const releases = JSON.parse(cmd('gh', ['api', `repos/${repo}/releases?per_page=100`, '--paginate', '--slurp']))
  if (releases.flat().some(item => item.tag_name === tag))
    throw new Error(`${tag} Release 已存在，请先检查之前的发布结果。`)

  // Inspect every page, not just GitHub's manually chosen "latest" release.
  const publishedVersions = releases.flat()
    .filter(item => !item.draft)
    .map(item => item.tag_name.match(/^v?(\d+\.\d+\.\d+)(?:[-+].+)?$/)?.[1])
    .filter(Boolean)
    .map(value => ({ value, parts: value.split('.').map(Number) }))
    .sort((a, b) => b.parts[0] - a.parts[0] || b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2])
  const highest = publishedVersions[0]
  if (highest) {
    const diff = next.findIndex((value, i) => value !== highest.parts[i])
    if (diff === -1 || next[diff] < highest.parts[diff])
      throw new Error(`新版本 ${version} 必须高于已发布的最高版本 ${highest.value}，允许跳号。`)
  }

  const files = ['package.json', 'package-lock.json', 'README.md', 'docs/development/README.md']
  const originals = new Map(files.map(file => [file, readFileSync(join(root, file), 'utf8')]))
  let committed = false
  let phase = '更新版本和构建'
  try {
    for (const file of files) {
      let text = originals.get(file)
      if (file.endsWith('.json')) {
        const data = JSON.parse(text)
        data.version = version
        if (file === 'package-lock.json') data.packages[''].version = version
        text = JSON.stringify(data, null, 2) + '\n'
      } else {
        text = text.replaceAll(`v${pkg.version}`, `v${version}`)
      }
      writeFileSync(join(root, file), text)
    }
    cmd('npm', ['run', 'zip'], true)
    const manifest = JSON.parse(readFileSync(join(root, `output/抄级对标数据采集器-v${version}/manifest.json`), 'utf8'))
    if (manifest.version !== version) throw new Error('构建产物版本与发布版本不一致。')
    const zip = join(root, `output/${pkg.name.replace(/[^a-zA-Z0-9]/g, '')}-${version}-chrome.zip`)
    if (!statSync(zip).size) throw new Error('ZIP 安装包为空。')
    // Build hooks must not silently add unrelated changes to the release commit.
    const changed = git('diff', '--name-only').split('\n').filter(Boolean)
    if (changed.some(file => !files.includes(file)) || git('ls-files', '--others', '--exclude-standard'))
      throw new Error('构建期间出现额外文件修改，请检查后再发布。')
    git('add', '--', ...files)
    phase = '创建版本提交'
    git('commit', '-m', `chore: release ${tag}`, '--', ...files)
    committed = true
    const sha = git('rev-parse', 'HEAD')
    phase = '创建并推送标签和代码'
    git('tag', '-a', tag, '-m', `Release ${version}`)
    // Atomic push prevents publishing a tag without its corresponding branch update.
    git('push', '--atomic', 'origin', `HEAD:refs/heads/${branch}`, `refs/tags/${tag}`)
    phase = '上传安装包并创建草稿 Release'
    cmd('gh', ['release', 'create', tag, zip, '--repo', repo, '--verify-tag', '--draft',
      '--title', `抄级对标 ${tag}`, '--notes', notes], true)
    const result = JSON.parse(cmd('gh', ['release', 'view', tag, '--repo', repo, '--json', 'assets']))
    if (!result.assets.some(asset => asset.name === zip.split('/').pop() && asset.size === statSync(zip).size))
      throw new Error('Release 安装包未完整上传，已保留草稿。')
    phase = '公开 Release'
    cmd('gh', ['release', 'edit', tag, '--repo', repo, '--draft=false', '--latest'], true)
    console.log(`发布完成：${sha}\nhttps://github.com/${repo}/releases/tag/${tag}`)
  } catch (error) {
    if (!committed) {
      for (const [file, text] of originals) writeFileSync(join(root, file), text)
      // The working tree was clean before this run; unstage only version files.
      git('reset', '--', ...files)
      throw new Error(`${phase}失败，已恢复版本文件：${error.message}`)
    }
    throw new Error(`${phase}失败：${error.message}\n已保留版本提交和可能存在的标签/草稿，请检查 git status、git ls-remote origin 和 gh release view ${tag} --repo ${repo}，再从失败步骤继续。脚本不会重置提交或覆盖已有版本。`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options) release(options)
    else console.log(usage)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
