import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs, release } from './release.mjs'

function fixture(t, override = () => undefined) {
  const root = mkdtempSync(join(tmpdir(), 'cjdb-release-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'docs/development'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'cjdb_crawler', version: '2.0.1' }))
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ version: '2.0.1', packages: { '': { version: '2.0.1' } } }))
  writeFileSync(join(root, 'README.md'), 'v2.0.1')
  writeFileSync(join(root, 'docs/development/README.md'), 'v2.0.1')
  const calls = []
  const run = (name, args) => {
    calls.push([name, ...args])
    const result = override(name, args)
    if (result !== undefined) return result
    if (name === 'git') {
      if (args[0] === 'remote') return 'git@github.com:ChaoJiDuiBiao/cjdb-web-crawler.git'
      if (args[0] === 'branch') return 'main'
      if (args[0] === 'rev-parse') return 'abc123'
      return ''
    }
    if (name === 'gh') {
      if (args[0] === 'api') return args[1].includes('/releases') ? '[[]]' : 'main'
      if (args[0] === 'release' && args[1] === 'view')
        return JSON.stringify({ assets: [{ name: 'cjdbcrawler-2.0.2-chrome.zip', size: 3 }] })
      return ''
    }
    if (name === 'npm') {
      mkdirSync(join(root, 'output/抄级对标数据采集器-v2.0.2'), { recursive: true })
      writeFileSync(join(root, 'output/抄级对标数据采集器-v2.0.2/manifest.json'), '{"version":"2.0.2"}')
      writeFileSync(join(root, 'output/cjdbcrawler-2.0.2-chrome.zip'), 'zip')
      return ''
    }
    throw new Error('Unexpected command')
  }
  return { root, run, calls }
}

const notes = '- 微信入口\n- 文本含 $HOME、`echo` 和 "引号"'
const options = { version: '2.0.2', notes }

test('解析多行说明且拒绝说明文件、空说明与无效版本', () => {
  assert.deepEqual(parseArgs(['2.0.2', '--notes', notes]), options)
  for (const args of [['2.0.2'], ['2.0.2', '--notes-file', 'x.md'], ['2.0.2', '--notes', ' '], ['2.0.2-beta', '--notes', notes]])
    assert.throws(() => parseArgs(args))
})

test('版本、原子推送和草稿发布顺序正确，说明作为一个原样参数传递', t => {
  const f = fixture(t)
  release(options, f)
  assert.equal(JSON.parse(readFileSync(join(f.root, 'package-lock.json'))).packages[''].version, '2.0.2')
  assert.equal(readFileSync(join(f.root, 'README.md'), 'utf8'), 'v2.0.2')
  const create = f.calls.find(c => c[0] === 'gh' && c[1] === 'release' && c[2] === 'create')
  assert.equal(create[create.indexOf('--notes') + 1], notes)
  assert.equal(create[create.indexOf('--repo') + 1], 'ChaoJiDuiBiao/cjdb-web-crawler')
  assert.ok(create.includes('--draft'))
  const index = first => f.calls.findIndex(first)
  assert.ok(index(c => c[0] === 'npm') < index(c => c[1] === 'commit'))
  assert.ok(index(c => c[1] === 'push' && c.includes('--atomic')) < f.calls.indexOf(create))
  assert.ok(index(c => c[2] === 'view') < index(c => c[2] === 'edit'))
})

test('工作区有修改时不构建、不发布', t => {
  const f = fixture(t, (name, args) => name === 'git' && args[0] === 'status' ? ' M local.json' : undefined)
  assert.throws(() => release(options, f), /未提交修改/)
  assert.ok(f.calls.every(c => c[0] === 'git'))
})

test('构建失败恢复文件，不提交或推送', t => {
  const f = fixture(t, name => { if (name === 'npm') throw new Error('build failed') })
  assert.throws(() => release(options, f), /已恢复版本文件/)
  assert.equal(JSON.parse(readFileSync(join(f.root, 'package.json'))).version, '2.0.1')
  assert.equal(readFileSync(join(f.root, 'README.md'), 'utf8'), 'v2.0.1')
  assert.ok(!f.calls.some(c => ['commit', 'push'].includes(c[1])))
})

test('推送失败保留版本提交，停止上传', t => {
  const f = fixture(t, (name, args) => { if (name === 'git' && args[0] === 'push') throw new Error('rejected') })
  assert.throws(() => release(options, f), /已保留版本提交/)
  assert.equal(JSON.parse(readFileSync(join(f.root, 'package.json'))).version, '2.0.2')
  assert.ok(!f.calls.some(c => c[0] === 'gh' && c[1] === 'release'))
})

test('附件校验失败保留草稿，不公开 Release', t => {
  const f = fixture(t, (name, args) => name === 'gh' && args[0] === 'release' && args[1] === 'view' ? '{"assets":[]}' : undefined)
  assert.throws(() => release(options, f), /安装包未完整上传/)
  assert.ok(!f.calls.some(c => c[0] === 'gh' && c[2] === 'edit'))
})

for (const version of ['2.9.9', '2.10.0']) {
  test(`拒绝低于或等于已发布最高版本：${version}，跨页取最高且按数字比较`, t => {
    const f = fixture(t, (name, args) => name === 'gh' && args[0] === 'api' && args[1].includes('/releases')
      ? JSON.stringify([[{ tag_name: 'v2.9.0', draft: false }], [{ tag_name: '2.10.0', draft: false }]]) : undefined)
    assert.throws(() => release({ version, notes }, f), /最高版本 2\.10\.0/)
    assert.ok(!f.calls.some(c => c[0] === 'npm' || c[1] === 'push'))
    assert.equal(JSON.parse(readFileSync(join(f.root, 'package.json'))).version, '2.0.1')
  })
}

test('允许从已发布 2.9.0 跳到 3.0.0，忽略更高草稿', t => {
  const f = fixture(t, (name, args) => {
    if (name === 'gh' && args[0] === 'api' && args[1].includes('/releases'))
      return JSON.stringify([[{ tag_name: 'v2.9.0', draft: false }, { tag_name: 'v4.0.0', draft: true }]])
    // Reaching the build proves preflight passed; stop before any simulated publishing.
    if (name === 'npm') throw new Error('模拟已进入构建')
  })
  assert.throws(() => release({ version: '3.0.0', notes }, f), /模拟已进入构建/)
  assert.ok(f.calls.some(c => c[0] === 'npm'))
})
