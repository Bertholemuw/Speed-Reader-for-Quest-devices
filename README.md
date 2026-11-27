# RSVP Speed Reader (Meta Quest + Android)

A Spritz-style RSVP speed reader: words flash one at a time with the optimal recognition point highlighted.
Import EPUB/TXT files, paste text, or pull classics from Project Gutenberg. Optional Gemini-powered
summaries and word definitions.

The same React codebase runs as a web app (Meta Quest browser, desktop) and as a native Android app via
[Capacitor](https://capacitorjs.com/).

## Run on the web / Quest

**Prerequisites:** Node.js 22+

1. `npm install`
2. Optional: set `GEMINI_API_KEY` in `.env.local` to enable Summarize/Explain
3. `npm run dev`

## Android app

**Prerequisites:** Node.js 22+, JDK 21, Android SDK (Android Studio installs both).

```bash
npm install
npm run android:build     # builds the web bundle and syncs it into android/
npm run android:open      # opens the project in Android Studio (Run ▶ to install on a device)
# or, without Android Studio:
cd android && ./gradlew assembleDebug   # -> android/app/build/outputs/apk/debug/app-debug.apk
```

Every push also builds a debug APK in GitHub Actions (**Actions → Android APK → Artifacts**). Add a
`GEMINI_API_KEY` repository secret if you want the AI buttons in CI builds.

### Android-specific behaviour

- Fully offline UI: Tailwind and fonts are bundled, no CDN needed.
- Gutenberg downloads use native HTTP, so no CORS proxy is involved.
- Library stored in IndexedDB (no 5 MB localStorage cap); older saved books migrate automatically.
- Hardware back button closes dialogs, then returns to the library, then exits.
- Screen stays awake while words are playing; status bar follows the reading theme.
- Tap the word to play/pause; tap the progress bar to jump.

> **Note on the Gemini key:** it is compiled into the app bundle, so anyone with the APK can extract it.
> Use a restricted key, or leave it unset (the AI buttons are hidden) for builds you share.
