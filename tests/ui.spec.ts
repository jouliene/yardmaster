import { expect, test, type Page } from '@playwright/test';
import { fit, toScreen } from '../src/canvas/camera';

async function world(page: Page, x: number, y: number) {
  const box = (await page.getByTestId('yard-canvas').boundingBox())!;
  const camera = fit([{ x: -180, y: 0 }, { x: 330, y: 72 }], box.width, box.height);
  const p = toScreen({ x, y }, camera);
  return { x: box.x + p.x, y: box.y + p.y };
}
async function clickTrack(page: Page, x: number, y = 0) {
  const p = await world(page, x, y); await page.mouse.click(p.x, p.y);
}
async function drag(page: Page, x1: number, y1: number, x2: number, y2: number) {
  const a = await world(page, x1, y1), b = await world(page, x2, y2);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 2 }); await page.mouse.up();
}
async function expectPosition(page: Page, testId: string, road: string, at: number) {
  await expect(page.getByTestId(testId)).toContainText(`${road} @`);
  const value = Number((await page.getByTestId(testId).textContent())!.match(/@ ([\d.]+)/)![1]);
  expect(Math.abs(value - at)).toBeLessThan(1); // Pointer coordinates have CSS-pixel precision.
}
async function execute(page: Page) {
  await page.getByRole('button', { name: 'Execute movement' }).click();
  await expect(page.getByTestId('status')).toContainText('One action added', { timeout: 15000 });
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'YardMaster' })).toBeVisible();
  await page.getByRole('button', { name: 'Fit Yard', exact: true }).click();
});

test('click clear / points change / reverse / curved entry into R2, undo and redo', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await expect(page.getByTestId('clearance-distance')).toContainText('150.0 m');
  await page.screenshot({ path: 'test-results/yardmaster-initial.png', fullPage: true });
  await clickTrack(page, -91); // Stop 1 m beyond the boundary; mouse coordinates are not exact metres.
  await expect(page.getByTestId('movement-result')).toContainText('READY TO MOVE');
  await expect(page.getByTestId('leading-position')).toContainText('R1 @ 20.0 m');
  await execute(page);
  await expectPosition(page, 'leading-position', 'H', 89);
  await expect(page.getByTestId('points-lock')).toContainText('free');
  await page.getByRole('button', { name: 'Set Reverse', exact: true }).click();
  await clickTrack(page, 220, 36);
  await expect(page.getByTestId('movement-result')).toContainText('READY TO MOVE');
  await execute(page);
  await expectPosition(page, 'leading-position', 'R2', 110);
  await expectPosition(page, 'trailing-position', 'R2', 35);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expectPosition(page, 'leading-position', 'H', 89);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expectPosition(page, 'leading-position', 'R2', 110);
  await page.screenshot({ path: 'test-results/yardmaster-shunt-complete.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('drag uses the same validator, previews until execute, locks points until tail clears', async ({ page }) => {
  await drag(page, 72, 0, -18, 0);
  await expect(page.getByTestId('movement-result')).toContainText('READY TO MOVE');
  await expect(page.getByTestId('movement-result')).toContainText('H @ 150.0 m');
  await expect(page.getByTestId('leading-position')).toContainText('R1 @ 20.0 m');
  await execute(page);
  await expect(page.getByTestId('leading-position')).toContainText('H @ 150.0 m');
  await expect(page.getByTestId('points-lock')).toContainText('Locked by T01');
  await expect(page.getByRole('button', { name: 'Set Reverse', exact: true })).toBeDisabled();
  await expect(page.getByTestId('clearance-distance')).toContainText('60.0 m');
  await page.getByRole('button', { name: 'Preview clear move', exact: true }).click();
  await execute(page);
  await expect(page.getByTestId('points-lock')).toContainText('free');
});

test('click and large drag cannot tunnel through T02; shortfall preset reports 10 m', async ({ page }) => {
  await page.getByLabel('Scenario', { exact: true }).selectOption('blocked');
  await clickTrack(page, -170);
  await expect(page.getByTestId('movement-result')).toContainText('MOVEMENT BLOCKED');
  await expect(page.getByTestId('movement-result')).toContainText('T02');
  await expect(page.getByRole('button', { name: 'Execute movement' })).toBeDisabled();
  await drag(page, 72, 0, -160, 0);
  await expect(page.getByTestId('movement-result')).toContainText('T02');
  await expect(page.getByTestId('leading-position')).toContainText('R1 @ 20.0 m');
  await page.getByLabel('Scenario', { exact: true }).selectOption('short');
  await expect(page.getByTestId('room-result')).toHaveText('10.0 m');
  await page.getByRole('button', { name: 'Preview clear move', exact: true }).click();
  await expect(page.getByTestId('movement-result')).toContainText('MOVEMENT BLOCKED');
  await page.screenshot({ path: 'test-results/yardmaster-shortfall.png', fullPage: true });
});

test('camera actions preserve placement and Reset cancels an active animation', async ({ page }) => {
  const initial = await page.getByTestId('leading-position').textContent();
  const p = await world(page, 60, 0); await page.mouse.move(p.x, p.y); await page.mouse.wheel(0, -400);
  await page.getByRole('button', { name: 'Focus Train', exact: true }).click();
  await page.getByRole('button', { name: 'Focus Manoeuvre', exact: true }).click();
  const box = (await page.getByTestId('yard-canvas').boundingBox())!;
  await page.mouse.move(box.x + 120, box.y + 120); await page.mouse.down(); await page.mouse.move(box.x + 170, box.y + 150); await page.mouse.up();
  await expect(page.getByTestId('leading-position')).toHaveText(initial!);
  await page.getByRole('button', { name: 'Preview clear move', exact: true }).click();
  await page.getByRole('button', { name: 'Execute movement' }).click();
  await expect(page.getByRole('button', { name: 'Set Reverse', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Scenario', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByTestId('leading-position')).toHaveText(initial!);
  await page.waitForTimeout(4500); // Longer than the cancelled move: stale RAF must not commit.
  await expect(page.getByTestId('leading-position')).toHaveText(initial!);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('misaligned points explain rejection; exact entry works without manual cab selection', async ({ page }) => {
  await page.getByRole('button', { name: 'Set Reverse', exact: true }).click();
  await clickTrack(page, -90);
  await expect(page.getByTestId('movement-result')).toContainText('Points P01 are set to the other route');
  await expect(page.getByTestId('leading-position')).toContainText('A · R1 @ 20.0 m');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reverse leading end' })).toHaveCount(0);
  await expect(page.getByTestId('leading-position')).toContainText('A · R1 @ 20.0 m');
  await page.getByText('Enter exact destination', { exact: true }).click();
  await page.getByLabel('Destination track').selectOption('H');
  await page.getByLabel('Destination metres').fill('140');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await execute(page);
  await expect(page.getByTestId('leading-position')).toContainText('H @ 140.0 m');
  await expect(page.getByTestId('clearance-distance')).toContainText('50.0 m');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Redo' })).toBeEnabled();
  await page.getByRole('button', { name: 'Set Reverse', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled();
});


test('drag either way automatically chooses the cab and Undo restores one movement', async ({ page }) => {
  await drag(page, 100, 0, 140, 0);
  await expect(page.getByTestId('movement-result')).toContainText('READY TO MOVE');
  await expect(page.getByTestId('leading-position')).toContainText('B · R1 @ 95.0 m');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel preview' }).click();
  await expect(page.getByTestId('leading-position')).toContainText('A · R1 @ 20.0 m');
  await drag(page, 100, 0, 140, 0);
  await execute(page);
  await expectPosition(page, 'leading-position', 'R1', 135);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('leading-position')).toContainText('A · R1 @ 20.0 m');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('single map clicks toggle points without a popup and each click is one action', async ({ page }) => {
  await clickTrack(page, 285, 72);
  await expect(page.getByTestId('selected-train')).toHaveText('T02');
  await clickTrack(page, 100, 0);
  await expect(page.getByTestId('selected-train')).toHaveText('T01');
  await clickTrack(page, 70, 36);
  await expect(page.getByLabel('Selected points')).toHaveValue('P02');
  await expect(page.getByTestId('points-state')).toHaveText('reverse');
  await expect(page.getByTestId('status')).toContainText('Points P02 set to reverse');
  await expect(page.getByRole('group', { name: 'P02 controls' })).toHaveCount(0);
  await expect(page.getByTestId('movement-result')).toContainText('No movement previewed');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('points-state')).toHaveText('normal');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByTestId('points-state')).toHaveText('reverse');
  await clickTrack(page, 70, 36);
  await expect(page.getByTestId('points-state')).toHaveText('normal');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('points-state')).toHaveText('reverse');
  await page.screenshot({ path: 'test-results/yardmaster-map-points.png', fullPage: true });
});

test('clicking occupied points reports the blocker without changing points or history', async ({ page }) => {
  await drag(page, 72, 0, -18, 0);
  await execute(page);
  await clickTrack(page, 0, 0);
  await expect(page.getByTestId('status')).toContainText('Points P01 remain occupied by T01');
  await expect(page.getByTestId('points-state')).toHaveText('normal');
  await expect(page.getByRole('group', { name: 'P01 controls' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('leading-position')).toContainText('R1 @ 20.0 m');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('one mouse workflow: contextual cursors, background pan, then map selection', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Select / move' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pan', exact: true })).toHaveCount(0);
  const canvas = page.getByTestId('yard-canvas');
  const box = (await canvas.boundingBox())!;
  const train = await world(page, 285, 72), points = await world(page, 70, 36);
  await page.mouse.move(points.x, points.y);
  await expect(canvas).toHaveCSS('cursor', 'pointer');
  await page.mouse.move(train.x, train.y);
  await expect(canvas).toHaveCSS('cursor', 'grab');
  await page.mouse.move(box.x + 100, box.y + 120);
  await expect(canvas).toHaveCSS('cursor', 'grab');
  await page.mouse.down();
  await expect(canvas).toHaveCSS('cursor', 'grabbing');
  await expect(page.getByRole('button', { name: 'Fit Yard', exact: true })).toBeDisabled();
  await page.mouse.wheel(0, -200); // Zoom must not alter an active drag.
  await page.mouse.move(box.x + 200, box.y + 170, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByTestId('movement-result')).toContainText('No movement previewed');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  // Hit the translated geometry to verify the camera actually panned.
  await page.mouse.click(train.x + 100, train.y + 50);
  await expect(page.getByTestId('selected-train')).toHaveText('T02');
  await expect(page.getByTestId('leading-position')).toContainText('R3 @ 200.0 m');
  await page.mouse.click(points.x + 100, points.y + 50);
  await expect(page.getByLabel('Selected points')).toHaveValue('P02');
  await expect(page.getByTestId('points-state')).toHaveText('reverse');
});

test('track drag pans without submitting a destination, next short click previews normally', async ({ page }) => {
  const start = await world(page, -100, 0);
  await page.mouse.move(start.x, start.y);
  await expect(page.getByTestId('yard-canvas')).toHaveCSS('cursor', 'crosshair');
  await page.mouse.down();
  await page.mouse.move(start.x + 70, start.y + 35, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByTestId('movement-result')).toContainText('No movement previewed');
  await expect(page.getByTestId('leading-position')).toContainText('R1 @ 20.0 m');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await page.getByRole('button', { name: 'Fit Yard', exact: true }).click();
  await clickTrack(page, -90);
  await expect(page.getByTestId('movement-result')).toContainText('READY TO MOVE');
});

test('middle-button pan over a train does not select or move it', async ({ page }) => {
  const otherTrain = await world(page, 285, 72), points = await world(page, 70, 36);
  await page.mouse.move(otherTrain.x, otherTrain.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(otherTrain.x - 80, otherTrain.y - 20, { steps: 3 });
  await page.mouse.up({ button: 'middle' });
  await expect(page.getByTestId('selected-train')).toHaveText('T01');
  await expect(page.getByTestId('movement-result')).toContainText('No movement previewed');
  await page.mouse.click(points.x - 80, points.y - 20);
  await expect(page.getByLabel('Selected points')).toHaveValue('P02');
  await expect(page.getByTestId('points-state')).toHaveText('reverse');
});


test('points cannot be switched on the map during animation', async ({ page }) => {
  await page.getByRole('button', { name: 'Preview clear move', exact: true }).click();
  await page.getByRole('button', { name: 'Execute movement' }).click();
  await clickTrack(page, 70, 36);
  await expect(page.getByLabel('Selected points')).toHaveValue('P01');
  await expect(page.getByTestId('status')).toContainText('Moving T01');
  await expect(page.getByTestId('status')).toContainText('One action added', { timeout: 15000 });
  await page.getByLabel('Selected points').selectOption('P02');
  await expect(page.getByTestId('points-state')).toHaveText('normal');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('middle-button gestures on points do not switch them', async ({ page }) => {
  const p = await world(page, 70, 36);
  await page.mouse.click(p.x, p.y, { button: 'middle' });
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await page.mouse.move(p.x, p.y); await page.mouse.down({ button: 'middle' });
  await page.mouse.move(p.x + 60, p.y + 20, { steps: 3 }); await page.mouse.up({ button: 'middle' });
  await page.getByLabel('Selected points').selectOption('P02');
  await expect(page.getByTestId('points-state')).toHaveText('normal');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});
