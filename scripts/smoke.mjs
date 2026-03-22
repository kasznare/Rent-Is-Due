import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const url = process.env.SMOKE_URL ?? 'http://127.0.0.1:43123/'

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
})

const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
})

try {
  await page.goto(url, { waitUntil: 'networkidle' })

  await page.getByRole('heading', { name: 'GEN Z MONOPOLY' }).waitFor()
  const closeGuide = page.getByRole('button', { name: 'Close guide' })
  if (await closeGuide.isVisible().catch(() => false)) {
    await closeGuide.click()
  }
  await page.getByRole('button', { name: 'Start match' }).click()

  await page
    .getByRole('heading', { name: 'Rent is due. The clock never stops.' })
    .waitFor()

  const elapsedLocator = page
    .locator('.pillbox')
    .filter({ hasText: 'Elapsed' })
    .locator('strong')

  const before = await elapsedLocator.textContent()
  await page.waitForTimeout(1300)
  const after = await elapsedLocator.textContent()

  assert.notEqual(after, before, 'elapsed timer should advance while running')

  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Resume' }).waitFor()

  const pausedAt = await elapsedLocator.textContent()
  await page.waitForTimeout(1300)
  const pausedAfter = await elapsedLocator.textContent()

  assert.equal(pausedAfter, pausedAt, 'elapsed timer should stop while paused')

  console.log('Smoke test passed')
} finally {
  await browser.close()
}
