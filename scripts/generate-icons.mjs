import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

// Export the collection button's actual artwork so extension icons stay in sync.
const root = new URL('../', import.meta.url)
const component = await readFile(new URL('components/BrandMark.vue', root), 'utf8')
const svg = component.match(/<svg\b[\s\S]*?<\/svg>/)?.[0]
if (!svg) throw new Error('BrandMark.vue must contain an SVG')

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`)
    await page.screenshot({
      path: fileURLToPath(new URL(`public/icon/${size}.png`, root)),
      omitBackground: true,
    })
    console.log(`Exported ${size} × ${size}`)
  }
} finally {
  await browser.close()
}
