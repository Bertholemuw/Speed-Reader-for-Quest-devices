<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1Obj1Zx6YGz1phTD_MjDuXExwolbFDnK2

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Take 5 auto-entry

The **Take 5** tab imports a digital issue of the magazine, solves every puzzle
and lodges the prize entries on a weekly schedule. It is backed by a small Node
service that lives in [`take5/`](take5/) — the dashboard is only its front end,
so start the service too:

```bash
cd take5 && npm install && npm run serve   # API on 127.0.0.1:4173
cd take5 && npm run schedule               # the unattended weekly job
```

See [take5/README.md](take5/README.md) for setup, how the solvers work, and the
competition-terms caveat you should read before switching off dry-run mode.
