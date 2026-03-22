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

  await page.getByRole('button', { name: 'Pause' }).waitFor()

  const blockCount = await page.locator('.block').count()
  assert.equal(blockCount, 16, 'board should render a 4x4 city grid')

  const roundClock = page
    .locator('.hud-card')
    .filter({ hasText: 'Next round' })
    .locator('strong')

  const before = await roundClock.textContent()
  await page.waitForTimeout(1300)
  const after = await roundClock.textContent()

  assert.notEqual(after, before, 'round clock should advance while running')

  await page.getByRole('button', { name: 'Open route' }).click()
  await page.getByText(/blocks left/i).waitFor()

  const east = page.getByRole('button', { name: 'East' })
  const south = page.getByRole('button', { name: 'South' })
  if (await east.isEnabled().catch(() => false)) {
    await east.click()
  } else {
    await south.click()
  }

  await page.getByRole('button', { name: 'Settle here' }).click()
  await page.getByRole('button', { name: 'Market' }).click()
  await page.getByRole('heading', { name: 'Market' }).waitFor()
  await page.getByRole('button', { name: 'Close' }).click()

  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Resume' }).waitFor()

  const pausedAt = await roundClock.textContent()
  await page.waitForTimeout(1300)
  const pausedAfter = await roundClock.textContent()

  assert.equal(pausedAfter, pausedAt, 'round clock should stop while paused')

  console.log('Smoke test passed')
} finally {
  await browser.close()
}
