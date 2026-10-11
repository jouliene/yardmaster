import { expect, test, type Page } from '@playwright/test';

// Corrupt authored data at the module boundary in this browser only. No test
// switches or import UI are added to the application.
async function alterData(page: Page, source: string) {
  await page.route(/\/src\/data\/yard\.ts(?:\?.*)?$/,  async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n${source}\n` });
  });
}
for (const target of ['layout', 'scenario']) test(`invalid initial ${target} shows diagnostics without mounting the canvas`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await alterData(page, target === 'layout' ? 'yard.segments.R1.geometry[0].x = NaN;' : `
    const originalScenario = makeScenario;
    makeScenario = (id) => { const s = originalScenario(id); s.trains[0].sections[0].length = Infinity; return s; };
  `);
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Cannot activate yard');
  await expect(page.getByRole('alert')).toContainText(target === 'layout' ? 'geometry.invalid' : 'section.length');
  await expect(page.getByTestId('yard-canvas')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Execute movement' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('failed preset keeps selection, preview, placements and both history stacks', async ({ page }) => {
  await alterData(page, `
    const originalScenario = makeScenario;
    makeScenario = (id) => { const s = originalScenario(id); if (id === 'blocked') s.trains[0].sections[0].length = NaN; return s; };
  `);
  await page.goto('/');
  await page.getByLabel('Selected points').selectOption('P02');
  await page.getByRole('button', { name: 'Set Reverse', exact: true }).click();
  await page.getByRole('button', { name: 'Set Normal', exact: true }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByText('Enter exact destination', { exact: true }).click();
  await page.getByLabel('Destination metres').fill('140');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = await page.getByTestId('movement-result').textContent();
  const placement = await page.getByTestId('leading-position').textContent();
  const viewport = await page.getByTestId('yard-canvas').boundingBox();
  await page.getByLabel('Scenario', { exact: true }).selectOption('blocked');
  await expect(page.getByRole('alert')).toContainText('Scenario unchanged');
  await expect(page.getByRole('alert')).toContainText('section.length');
  expect(await page.getByTestId('yard-canvas').boundingBox()).toEqual(viewport);
  await page.screenshot({ path: 'test-results/yardmaster-activation-error.png', fullPage: true });
  await expect(page.getByLabel('Scenario', { exact: true })).toHaveValue('shunt');
  await expect(page.getByLabel('Selected points')).toHaveValue('P02');
  await expect(page.getByTestId('points-state')).toHaveText('reverse');
  await expect(page.getByTestId('leading-position')).toHaveText(placement!);
  await expect(page.getByTestId('movement-result')).toHaveText(preview!);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Redo' })).toBeEnabled();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByTestId('points-state')).toHaveText('normal');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('points-state')).toHaveText('reverse');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('failed reset does not cancel an already validated animation', async ({ page }) => {
  await alterData(page, `
    const originalScenario = makeScenario;
    makeScenario = (id) => { const s = originalScenario(id); if (id !== undefined) s.trains[0].sections[0].length = -1; return s; };
  `);
  await page.goto('/');
  await page.getByRole('button', { name: 'Preview clear move', exact: true }).click();
  await page.getByRole('button', { name: 'Execute movement' }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Scenario unchanged');
  await expect(page.getByTestId('status')).toContainText('One action added', { timeout: 15000 });
  await expect(page.getByTestId('leading-position')).toContainText('H @ 90.0 m');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('leading-position')).toContainText('R1 @ 20.0 m');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('empty initial scenario produces a planner diagnostic', async ({ page }) => {
  await alterData(page, `
    const originalScenario = makeScenario;
    makeScenario = (id) => ({ ...originalScenario(id), trains: [] });
  `);
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('activation.no_trains');
  await expect(page.getByTestId('yard-canvas')).toHaveCount(0);
});
