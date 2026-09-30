import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validatePlan } from './plan.mjs';

const launchOptions = () => ({ headless: true, ...(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {}) });

export function safeUrl(origin, target) {
  const url = new URL(target, origin);
  if (url.origin !== new URL(origin).origin || !/^https?:$/.test(url.protocol)) throw new Error(`Navigation outside preview origin: ${target}`);
  return url.toString();
}

export function locatorFor(page, target) {
  const colon = target.indexOf(':');
  const kind = target.slice(0, colon), value = target.slice(colon + 1);
  if (kind === 'role') {
    const pipe = value.indexOf('|');
    const role = value.slice(0, pipe), name = value.slice(pipe + 1);
    if (pipe < 1 || !['button', 'link', 'textbox', 'heading', 'checkbox', 'option'].includes(role) || !name) throw new Error(`Invalid role locator: ${target}`);
    return page.getByRole(role, { name, exact: true });
  }
  if (kind === 'text') return page.getByText(value, { exact: true });
  if (kind === 'label') return page.getByLabel(value, { exact: true });
  if (kind === 'placeholder') return page.getByPlaceholder(value, { exact: true });
  if (kind === 'css') return page.locator(value);
  throw new Error(`Invalid locator: ${target}`);
}

export async function inspectPreview(origin) {
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage();
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return await page.locator('body').evaluate(body => {
      const nodes = [...body.querySelectorAll('a,button,input,textarea,h1,h2')].slice(0, 80);
      return nodes.map(el => [el.tagName.toLowerCase(), el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent.trim().slice(0, 100), el.getAttribute('href') || ''].join(' | ')).join('\n');
    });
  } finally { await browser.close(); }
}

async function perform(page, step, origin) {
  if (step.action === 'navigate') return page.goto(safeUrl(origin, step.target), { waitUntil: 'domcontentloaded' });
  if (step.action === 'expectUrl') {
    if (!page.url().includes(step.target)) throw new Error(`Expected URL to include ${step.target}, got ${page.url()}`);
    return;
  }
  const locator = locatorFor(page, step.target).first();
  if (step.action === 'click') return locator.click();
  if (step.action === 'fill') return locator.fill(step.value);
  if (step.action === 'expectVisible') return locator.waitFor({ state: 'visible' });
  if (step.action === 'expectText') {
    await locator.waitFor({ state: 'visible' });
    const text = await locator.innerText();
    if (!text.includes(step.value)) throw new Error(`Expected text ${JSON.stringify(step.value)}, got ${JSON.stringify(text.slice(0, 200))}`);
  }
}

export async function runPlan({ plan, origin, outputDir, onEvent = () => {} }) {
  validatePlan(plan);
  await mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch(launchOptions());
  const results = [];
  try {
    for (const [index, test] of plan.tests.entries()) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...(process.env.QA_RECORD_VIDEO === '0' ? {} : { recordVideo: { dir: outputDir } }) });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const consoleErrors = [];
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 500)); });
      page.on('pageerror', error => consoleErrors.push(error.message.slice(0, 500)));
      await context.tracing.start({ screenshots: true, snapshots: true });
      const result = { name: test.name, reason: test.reason, status: 'passed', steps: [], consoleErrors, trace: `trace-${index + 1}.zip`, video: '', screenshot: '' };
      onEvent({ type: 'test', index, name: test.name });
      try {
        await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
        for (const [stepIndex, step] of test.steps.entries()) {
          const entry = { ...step, status: 'running' };
          result.steps.push(entry);
          onEvent({ type: 'step', index, stepIndex, step, status: 'running' });
          try {
            await perform(page, step, origin);
            if (new URL(page.url()).origin !== new URL(origin).origin) throw new Error('Browser left the preview origin');
            entry.status = 'passed';
            const screenshot = `step-${index + 1}-${stepIndex + 1}.png`;
            await page.screenshot({ path: path.join(outputDir, screenshot) });
            entry.screenshot = screenshot;
            onEvent({ type: 'step', index, stepIndex, step, status: 'passed', screenshot });
          } catch (error) {
            entry.status = 'failed'; entry.error = error.message;
            result.status = 'failed'; result.error = error.message;
            result.screenshot = `failure-${index + 1}.png`;
            await page.screenshot({ path: path.join(outputDir, result.screenshot) }).catch(() => {});
            onEvent({ type: 'step', index, stepIndex, step, status: 'failed', error: error.message, screenshot: result.screenshot });
            break;
          }
        }
      } catch (error) {
        result.status = 'failed'; result.error = error.message;
        onEvent({ type: 'error', index, error: error.message });
      } finally {
        await context.tracing.stop({ path: path.join(outputDir, result.trace) });
        await context.close();
        if (page.video()) result.video = path.basename(await page.video().path());
        results.push(result);
        onEvent({ type: 'result', index, status: result.status });
      }
    }
  } finally { await browser.close(); }
  const report = { origin, createdAt: new Date().toISOString(), plan, results, passed: results.every(r => r.status === 'passed') };
  await writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
  return report;
}
