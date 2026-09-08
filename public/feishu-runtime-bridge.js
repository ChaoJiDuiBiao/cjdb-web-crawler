(function () {
  var SCRIPT_ID = 'cjdb-feishu-runtime-bridge'
  var REQUEST = 'CJDB_FEISHU_RUNTIME_REQUEST'
  var RESPONSE = 'CJDB_FEISHU_RUNTIME_RESPONSE'

  if (window.__CJDB_FeishuRuntimeBridgeInstalled__) return
  window.__CJDB_FeishuRuntimeBridgeInstalled__ = true

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms) })
  }

  function getPageMain() {
    return window.PageMain || window.pageMain || null
  }

  function getRootBlock() {
    var pageMain = getPageMain()
    var blockManager = pageMain && (pageMain.blockManager || pageMain.editor && pageMain.editor.blockManager)
    return blockManager && (blockManager.rootBlockModel || blockManager.root || null)
  }

  function getBlockChildren(block) {
    if (!block) return []
    if (Array.isArray(block.children)) return block.children
    if (Array.isArray(block.childBlockModels)) return block.childBlockModels
    if (Array.isArray(block.blocks)) return block.blocks
    return []
  }

  function getBlockType(block) {
    return String(
      block && (
        block.type ||
        block.blockType ||
        block.snapshot && block.snapshot.type ||
        block.snapshotType ||
        ''
      )
    )
  }

  function getOps(block) {
    var ops = block && block.zoneState && block.zoneState.content && block.zoneState.content.ops
    if (!Array.isArray(ops)) return []
    return ops
      .filter(function (op) {
        return op && typeof op.insert === 'string'
      })
      .map(function (op) {
        return {
          insert: op.insert,
          attributes: op.attributes || {}
        }
      })
  }

  function getAllText(block) {
    return String(
      block && (
        block.zoneState && block.zoneState.allText ||
        block.allText ||
        block.text ||
        ''
      )
    )
  }

  function serializeBlock(block, seen, depth) {
    if (!block || depth > 2000) return null

    var recordId = String(
      block.recordId ||
      block.id ||
      block.snapshot && (block.snapshot.recordId || block.snapshot.block_id) ||
      ''
    )

    if (recordId && seen.has(recordId)) return null
    if (recordId) seen.add(recordId)

    var snapshot = block.snapshot || {}
    var serialized = {
      id: String(block.id || snapshot.id || ''),
      recordId: recordId,
      type: getBlockType(block),
      allText: getAllText(block),
      ops: getOps(block),
      seq: snapshot.seq || block.seq || '',
      seqLevel: snapshot.seq_level || block.seqLevel || 0,
      done: !!(snapshot.done || block.done),
      language: snapshot.language || snapshot.lang || block.language || '',
      url: snapshot.url || snapshot.link || block.url || '',
      title: snapshot.title || snapshot.file_name || snapshot.caption || block.title || '',
      imageToken: snapshot.token || snapshot.image_token || '',
      fileToken: snapshot.file_token || snapshot.token || '',
      children: []
    }

    var children = getBlockChildren(block)
    for (var i = 0; i < children.length; i++) {
      var child = serializeBlock(children[i], seen, depth + 1)
      if (child) serialized.children.push(child)
    }

    return serialized
  }

  function inspectTree(root) {
    var total = 0
    var pending = 0

    function walk(node) {
      if (!node) return
      total += 1
      var type = getBlockType(node).toLowerCase()
      if (!type || type === 'pending') pending += 1
      var children = getBlockChildren(node)
      for (var i = 0; i < children.length; i++) walk(children[i])
    }

    walk(root)
    return {
      totalBlocks: total,
      pendingCount: pending,
      ready: !!root && pending === 0
    }
  }

  async function ensureLoaded() {
    var container = document.querySelector('#mainBox .bear-web-x-container') || document.scrollingElement
    var originalTop = container && typeof container.scrollTop === 'number' ? container.scrollTop : 0
    var stableReadyCount = 0

    for (var i = 0; i < 12; i++) {
      var root = getRootBlock()
      var state = inspectTree(root)
      if (state.ready && state.totalBlocks > 1) {
        stableReadyCount += 1
        if (stableReadyCount >= 2) break
      } else {
        stableReadyCount = 0
      }

      if (container && typeof container.scrollTo === 'function') {
        container.scrollTo({ top: container.scrollHeight, behavior: 'auto' })
      }
      await sleep(350)
    }

    if (container && typeof container.scrollTo === 'function') {
      container.scrollTo({ top: originalTop, behavior: 'auto' })
    }

    await sleep(120)
  }

  async function collect() {
    await ensureLoaded()

    var root = getRootBlock()
    if (!root) {
      throw new Error('未找到飞书文档 runtime rootBlockModel')
    }

    var debug = inspectTree(root)
    var title = ''

    try {
      title = String(
        root.zoneState && root.zoneState.allText ||
        document.querySelector('h1.page-block-content') && document.querySelector('h1.page-block-content').innerText ||
        document.title ||
        ''
      ).trim()
    } catch (_error) {
      title = document.title || ''
    }

    var serializedRoot = serializeBlock(root, new Set(), 0)
    if (!serializedRoot) {
      throw new Error('序列化飞书文档失败')
    }

    return {
      title: title,
      root: serializedRoot,
      debug: debug
    }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return
    var payload = event.data
    if (!payload || payload.source !== SCRIPT_ID || payload.type !== REQUEST || payload.action !== 'collect') return

    Promise.resolve()
      .then(function () { return collect() })
      .then(function (doc) {
        window.postMessage({
          source: SCRIPT_ID,
          type: RESPONSE,
          id: payload.id,
          ok: true,
          doc: doc
        }, '*')
      })
      .catch(function (error) {
        window.postMessage({
          source: SCRIPT_ID,
          type: RESPONSE,
          id: payload.id,
          ok: false,
          error: error && error.message ? error.message : String(error)
        }, '*')
      })
  })
})()
