#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getDiff, generatePlan, validatePlan } from './plan.mjs';
import { inspectPreview, runPlan } from './browser.mjs';
import { startViewer } from './viewer.mjs';

function argsOf(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument ${argv[i]}`);
    const key = argv[i].slice(2);
    if (key === 'live') options.live = true;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) options[key] = argv[++i];
    else throw new Error(`Missing value for --${key}`);
  }
  return options;
}

async function main() {
  const options = argsOf(process.argv.slice(2));
  if (!options.url) throw new Error('Usage: pr-qa --url <preview URL> [--plan plan.json | --diff diff.patch] [--live] [--output reports/run]');
  const origin = new URL(options.url);
  if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('Preview URL must be HTTP(S)');
  const outputDir = path.resolve(options.output || 'reports/latest');
  await mkdir(outputDir, { recursive: true });
  let plan;
  if (options.plan) {
    plan = validatePlan(JSON.parse(await readFile(options.plan, 'utf8')));
  } else {
    const diff = await getDiff({ diffFile: options.diff, base: options.base, head: options.head });
    if (!diff.trim()) throw new Error('No diff found; provide --diff or a valid --base/--head range');
    const pageMap = await inspectPreview(origin.toString());
    plan = await generatePlan({ diff, url: origin.toString(), pageMap, brief: options.brief || '', model: options.model });
  }
  await writeFile(path.join(outputDir, 'plan.json'), JSON.stringify(plan, null, 2));
  console.log(`QA plan: ${plan.tests.map(t => t.name).join(', ')}`);
  const viewer = options.live ? await startViewer(outputDir, Number(options.port || 4177)) : null;
  if (viewer) console.log(`Live viewer: ${viewer.url}`);
  const report = await runPlan({ plan, origin: origin.toString(), outputDir, onEvent: event => {
    viewer?.emit(event);
    if (event.type === 'step') console.log(`${event.status}: ${event.step.action} ${event.step.target}`);
  } });
  viewer?.emit({ type: 'done', passed: report.passed });
  console.log(`Report: ${path.join(outputDir, 'report.json')}`);
  console.log(`${report.results.filter(r => r.status === 'passed').length}/${report.results.length} tests passed`);
  if (viewer) { console.log('Press Ctrl+C to stop the viewer'); await new Promise(resolve => process.on('SIGINT', resolve)); await viewer.close(); }
  if (!report.passed) process.exitCode = 1;
}

main().catch(error => { console.error(error.message); process.exitCode = 2; });
