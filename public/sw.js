// Minimal service worker — just enough to make the app "installable"
// (a requirement for wrapping it as an Android app). Doesn't do offline
// caching yet; that can be added later if you want offline support.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", () => self.clients.claim());
self.addEventListener("fetch", () => {});
