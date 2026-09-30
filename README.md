# PR QA Lab

An open-source experiment for **testing what a pull request actually changed in a running web application**. It reads a diff, uses AI to propose a small browser test plan, runs only supported browser actions, and saves the steps, screenshots, video, Playwright traces, and a JSON report. You can inspect a live local view while it runs.

This is a developer tool, **not a hosted service**. There is no login, subscription, hosted GitHub App, or automatic PR check yet.

## Quick demo (no AI key)

Node 20+ is required. In two terminals:

```bash
npm install
npx playwright install chromium
npm run demo
```

If you already have a compatible Chromium binary, set `QA_CHROMIUM_PATH` to its absolute path instead of downloading Playwright's browser.
Set `QA_RECORD_VIDEO=0` if the Playwright FFmpeg binary is unavailable; screenshots and traces will still be saved.

```bash
npm run qa -- --url http://127.0.0.1:3000 --plan examples/demo-plan.json --live
```

Open `http://127.0.0.1:4177` while it runs. The run saves `reports/latest/report.json`, one screenshot per completed step, a video, and a trace. To inspect a deliberate failure, replace `demo-plan.json` with `demo-failure.json`. The exit code is `0` if every test passes, `1` for a failing test, and `2` for setup or planning errors.

## Generate tests from a diff

Set `OPENAI_API_KEY` in your shell (never commit it). The planner sends the selected diff, the optional brief, and a small map of the preview's initial page to the OpenAI Responses API. Review `reports/latest/plan.json` before using a generated plan as a merge gate.

```bash
export OPENAI_API_KEY=your_key
npm run qa -- --url https://your-preview.example --base origin/main --head HEAD --brief "Cart discount change" --live
```

You can also supply `--diff changes.patch`, `--model MODEL`, `--port 4177`, or `--output reports/my-run`. For a repeatable run without a model call, use `--plan reports/latest/plan.json`. The planner uses [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) to return data in a fixed schema; the runner validates the plan again before executing it.

Supported actions: `navigate`, `click`, `fill`, `expectVisible`, `expectText`, and `expectUrl`. Locators use `role:button|Add to cart`, `role:link|Products`, `text:Welcome`, `label:Email`, `placeholder:Search`, or `css:#cart`. The AI cannot send arbitrary JavaScript or shell commands to the runner.

## GitHub integration

[`examples/github-workflow.yml`](examples/github-workflow.yml) is a starting point for a **manual** GitHub Actions run after a PR preview is ready. Copy it into the consuming repository, replace `YOUR_ORG/pr-qa-lab` and pin a reviewed commit SHA. It uploads the evidence even when QA fails. This recipe deliberately does not claim to auto-discover a Vercel preview URL or publish a GitHub check. Those are next milestones.

The workflow checks out the application only to calculate the diff. Dependencies are installed from a separate, pinned tool checkout. GitHub-hosted runners and repository settings still need review before testing untrusted fork PRs. Do not supply production credentials to a test run.

## Scope and next milestones

1. GitHub App or Action that waits for a ready preview deployment and links the report to its PR.
2. Saved, reviewed test journeys so the agent can select existing coverage and propose new cases.
3. Retry and baseline comparison to reduce false alarms.
4. Isolated code execution for repositories without a preview, only after the preview flow is reliable.

The current runner is a research prototype. It requires an accessible web preview, tests one origin, does not authenticate to the application, and can be wrong about what a PR should do. The live viewer binds to `127.0.0.1`; reports and traces can contain application data, so handle them as private build artifacts.

## Development

```bash
npm test
```

License: MIT.
