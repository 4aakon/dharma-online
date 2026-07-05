# Dharma Online — deploy instructions

## 1. Upload this whole folder to your existing GitHub repo (dharma-online)
Keep the same repo you already have with the workflow files — just add these
project files alongside `scrape_telegram.py` etc. (they don't conflict).

## 2. Deploy to Vercel (free)
1. Go to vercel.com, sign in with GitHub.
2. Click "Add New" -> "Project" -> pick your `dharma-online` repo.
3. Leave settings as default (Vercel auto-detects Vite) -> Deploy.
4. You'll get a live URL like `dharma-online-yourname.vercel.app`.

## 3. Wrap it as an Android app
1. Go to https://www.pwabuilder.com
2. Paste your live Vercel URL, click "Start".
3. It will check your manifest/service worker (already included here) and
   let you download an Android package (a "Trusted Web Activity").
4. That package can be uploaded to the Google Play Console to publish as
   a real Android app (Google charges a one-time $25 developer fee).

## Notes
- Replace public/icon-192.png and public/icon-512.png with real artwork
  whenever you have a proper logo — the current ones are placeholders.
- EVENTS_URL in src/App.jsx already points at your live events.jsonl file.
