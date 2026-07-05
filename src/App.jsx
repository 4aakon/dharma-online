import React, { useState, useMemo, useEffect } from "react";
import { Search, Bell, BellRing, Globe, Video, Youtube, Send, ExternalLink, Sparkles, X, Clock } from "lucide-react";

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap');`;

const TIMEZONES = [
  "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York",
  "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Europe/Berlin",
  "Europe/Moscow", "Asia/Kolkata", "Asia/Kathmandu", "Asia/Bangkok",
  "Asia/Shanghai", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland",
];

const PLATFORM_META = {
  Zoom: { icon: Video, color: "#2D8CBF" },
  YouTube: { icon: Youtube, color: "#C4302B" },
  Telegram: { icon: Send, color: "#3E7C7C" },
  Other: { icon: Video, color: "#8688B8" },
  unknown: { icon: Video, color: "#8688B8" },
};

// Where the automated pipeline publishes real events. Once your GitHub repo is set
// up, replace this with your raw file URL, e.g.:
// "https://raw.githubusercontent.com/<you>/dharma-online/main/events.json"
const EVENTS_URL = "https://raw.githubusercontent.com/4aakon/dharma-online/main/events.jsonl";

// Shown only if EVENTS_URL hasn't been set yet, or the fetch fails — so the app
// never looks broken while you're still setting up the pipeline.
const FALLBACK_EVENTS = [
  {
    id: "fallback-1",
    title: "The Nature of Mind: An Introduction to Dzogchen",
    teacher: "Khenpo Tenzin Norgay",
    platform: "Zoom",
    startUTC: "2026-07-04T14:00:00Z",
    durationMin: 90,
    tradition: "Nyingma",
    aiSummary: "An entry-level talk on resting in awareness, followed by guided sitting and Q&A. No prior study required.",
    rawDescription: "Join us for a teaching on the nature of mind from the Dzogchen tradition. Khenpo-la will cover the view, meditation and conduct, followed by a guided session and open questions.",
    link: "https://zoom.us/j/example1",
    featured: true,
  },
];

// Maps a raw record from events.json (produced by extract_events.py) into the
// shape this UI renders. Keeping this mapping in one place means the pipeline's
// schema and the UI's schema can evolve independently.
function normalizeEvent(raw, index) {
  return {
    id: raw.source_message_id ?? `evt-${index}`,
    title: raw.title,
    teacher: raw.teacher || "Teacher TBA",
    platform: PLATFORM_META[raw.platform] ? raw.platform : "Other",
    startUTC: raw.start_utc || null,
    startLocalText: raw.start_local_text || null,
    durationMin: raw.duration_min || null,
    tradition: raw.tradition || "Unspecified",
    aiSummary: raw.ai_summary,
    rawDescription: raw.description_raw,
    link: raw.registration_link,
    needsReview: !!raw.needs_review,
    featured: index === 0,
  };
}

function fmtInTZ(iso, tz) {
  const d = new Date(iso);
  const dateStr = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(d);
  const timeStr = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
  return { dateStr, timeStr };
}

function tzLabel(tz) {
  const city = tz.split("/").pop().replace(/_/g, " ");
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName")?.value ?? "";
  return `${city} (${offset})`;
}

function hourOfDay(iso, tz) {
  const d = new Date(iso);
  const h = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(d), 10);
  return h;
}

function skyColorForHour(h) {
  if (h >= 5 && h < 8) return "#C97A4A";
  if (h >= 8 && h < 17) return "#C9962C";
  if (h >= 17 && h < 20) return "#8B4A6B";
  return "#2A2E5C";
}

export default function DharmaOnline() {
  const [tz, setTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York");
  const [query, setQuery] = useState("");
  const [notified, setNotified] = useState({});
  const [toast, setToast] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [events, setEvents] = useState(FALLBACK_EVENTS);
  const [loading, setLoading] = useState(true);
  const [usingFallback, setUsingFallback] = useState(true);

  useEffect(() => {
    if (!EVENTS_URL || EVENTS_URL === "PASTE_YOUR_EVENTS_JSON_URL_HERE") {
      setLoading(false);
      return;
    }
    fetch(EVENTS_URL)
      .then((res) => {
        if (!res.ok) throw new Error("fetch failed");
        return res.text(); // events.jsonl is line-delimited JSON, not a single JSON document
      })
      .then((text) => {
        const list = text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => JSON.parse(line));
        const normalized = list
          .filter((e) => !e.needs_review) // don't show unverified events publicly
          .map(normalizeEvent);
        if (normalized.length) {
          setEvents(normalized);
          setUsingFallback(false);
        }
      })
      .catch(() => {
        // keep FALLBACK_EVENTS — app stays usable even if the pipeline hasn't run yet
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const featured = events.find((e) => e.featured);
  const rest = events.filter((e) => !e.featured);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...rest].sort((a, b) => new Date(a.startUTC || 0) - new Date(b.startUTC || 0));
    if (!q) return list;
    return list.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.teacher.toLowerCase().includes(q) ||
        e.platform.toLowerCase().includes(q) ||
        e.tradition.toLowerCase().includes(q)
    );
  }, [query, rest]);

  const toggleNotify = (id, title) => {
    setNotified((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      setToast(next[id] ? `Reminder set — you'll be notified 30 min before "${title}"` : "Reminder removed");
      return next;
    });
  };

  const toggleExpand = (id) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }} className="min-h-screen bg-[#12143A] text-[#EDE6D6] pb-24">
      <style>{FONT_IMPORT}</style>

      {/* Header */}
      <header className="sticky top-0 z-20 backdrop-blur-md bg-[#12143A]/90 border-b border-[#3A3D6B] px-5 pt-6 pb-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 style={{ fontFamily: "'Fraunces', serif" }} className="text-2xl font-semibold tracking-tight text-[#F3EFE3]">
              Dharma Online
            </h1>
            <p className="text-xs text-[#9A9CC4] mt-0.5">Live Buddhist teachings, wherever you are</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#C9962C] to-[#8B4A6B] flex items-center justify-center text-lg">
            ☸
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8688B8]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search teacher, tradition, platform…"
            className="w-full bg-[#1D2054] border border-[#3A3D6B] rounded-full pl-9 pr-4 py-2.5 text-sm placeholder-[#8688B8] outline-none focus:border-[#C9962C] transition-colors"
          />
        </div>

        {/* Timezone selector */}
        <div className="relative">
          <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8688B8]" />
          <select
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            className="w-full appearance-none bg-[#1D2054] border border-[#3A3D6B] rounded-full pl-9 pr-4 py-2 text-xs text-[#C9CBF0] outline-none focus:border-[#C9962C]"
          >
            {TIMEZONES.map((z) => (
              <option key={z} value={z} className="bg-[#1D2054]">
                {tzLabel(z)}
              </option>
            ))}
          </select>
        </div>
      </header>

      <main className="px-5 mt-5 space-y-8">
        {/* Featured */}
        {featured && !query && (
          <section>
            <SectionLabel icon="🔥" text="Featured event" />
            <FeaturedCard
              event={featured}
              tz={tz}
              notified={!!notified[featured.id]}
              onNotify={() => toggleNotify(featured.id, featured.title)}
              expanded={!!expanded[featured.id]}
              onExpand={() => toggleExpand(featured.id)}
            />
          </section>
        )}

        {/* Upcoming */}
        <section>
          <SectionLabel icon="📅" text={query ? `Results for "${query}"` : "Upcoming events"} />
          <div className="space-y-3">
            {filtered.length === 0 && (
              <p className="text-sm text-[#8688B8] py-6 text-center">No events match that search yet — try a different teacher or tradition.</p>
            )}
            {filtered.map((e) => (
              <EventCard
                key={e.id}
                event={e}
                tz={tz}
                notified={!!notified[e.id]}
                onNotify={() => toggleNotify(e.id, e.title)}
                expanded={!!expanded[e.id]}
                onExpand={() => toggleExpand(e.id)}
              />
            ))}
          </div>
        </section>
      </main>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-[#1D2054] border border-[#C9962C]/40 text-[#F3EFE3] text-xs px-4 py-2.5 rounded-full shadow-lg z-30 max-w-[90%] text-center">
          {toast}
        </div>
      )}

      {/* Ad banner */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#0C0E2C] border-t border-[#3A3D6B] px-4 py-2.5 flex items-center justify-between z-20">
        <span className="text-[10px] uppercase tracking-widest text-[#6B6D9E]">Advertisement</span>
        <span className="text-[11px] text-[#8688B8]">AdMob banner · 320×50</span>
      </div>
    </div>
  );
}

function SectionLabel({ icon, text }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-sm">{icon}</span>
      <h2 style={{ fontFamily: "'Fraunces', serif" }} className="text-sm font-semibold text-[#C9CBF0] tracking-wide uppercase">
        {text}
      </h2>
    </div>
  );
}

function DayStrip({ iso, tz }) {
  const h = hourOfDay(iso, tz);
  const color = skyColorForHour(h);
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[10px] text-[#8688B8]">{h >= 5 && h < 17 ? "daytime" : h >= 17 && h < 20 ? "evening" : "night"} where you are</span>
    </div>
  );
}

function PlatformBadge({ platform }) {
  const meta = PLATFORM_META[platform] || PLATFORM_META.Zoom;
  const Icon = meta.icon;
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full"
      style={{ backgroundColor: `${meta.color}22`, color: meta.color }}
    >
      <Icon size={12} /> {platform}
    </span>
  );
}

function FeaturedCard({ event, tz, notified, onNotify, expanded, onExpand }) {
  const { dateStr, timeStr } = fmtInTZ(event.startUTC, tz);
  return (
    <div className="relative rounded-2xl p-5 border border-[#C9962C]/50 bg-gradient-to-br from-[#2A2E5C] to-[#1D2054] overflow-hidden">
      <div className="absolute -right-10 -top-10 w-32 h-32 rounded-full bg-[#C9962C]/10 blur-2xl" />
      <div className="flex items-start justify-between mb-2">
        <PlatformBadge platform={event.platform} />
        <button onClick={onNotify} aria-label="Toggle reminder" className="text-[#C9962C]">
          {notified ? <BellRing size={18} /> : <Bell size={18} className="text-[#8688B8]" />}
        </button>
      </div>
      <h3 style={{ fontFamily: "'Fraunces', serif" }} className="text-lg font-semibold text-[#F3EFE3] leading-snug mb-1">
        {event.title}
      </h3>
      <p className="text-xs text-[#C9CBF0] mb-3">{event.teacher} · {event.tradition}</p>

      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center gap-1.5 text-sm text-[#F3EFE3] font-medium">
          <Clock size={14} className="text-[#C9962C]" />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{dateStr}, {timeStr}</span>
        </div>
      </div>
      <DayStrip iso={event.startUTC} tz={tz} />

      <div className="mt-3 flex items-start gap-1.5">
        <Sparkles size={13} className="text-[#C9962C] mt-0.5 shrink-0" />
        <p className="text-xs text-[#C9CBF0] leading-relaxed">
          {expanded ? event.rawDescription : event.aiSummary}
        </p>
      </div>
      <button onClick={onExpand} className="text-[10px] text-[#8688B8] underline mt-1 ml-5">
        {expanded ? "Show AI summary" : "Show full description"}
      </button>

      <a
        href={event.link}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex items-center gap-1.5 bg-[#C9962C] text-[#12143A] text-sm font-semibold px-4 py-2 rounded-full hover:brightness-110 transition"
      >
        Register / Join <ExternalLink size={13} />
      </a>
    </div>
  );
}

function EventCard({ event, tz, notified, onNotify, expanded, onExpand }) {
  const { dateStr, timeStr } = fmtInTZ(event.startUTC, tz);
  return (
    <div className="rounded-xl p-4 bg-[#1D2054] border border-[#3A3D6B]">
      <div className="flex items-start justify-between mb-1.5">
        <PlatformBadge platform={event.platform} />
        <button onClick={onNotify} aria-label="Toggle reminder">
          {notified ? <BellRing size={16} className="text-[#C9962C]" /> : <Bell size={16} className="text-[#6B6D9E]" />}
        </button>
      </div>
      <h3 className="text-[15px] font-semibold text-[#F3EFE3] leading-snug mb-0.5">{event.title}</h3>
      <p className="text-xs text-[#9A9CC4] mb-2">{event.teacher} · {event.tradition}</p>

      <div className="flex items-center gap-1.5 text-xs text-[#C9CBF0] mb-2" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
        <Clock size={12} className="text-[#C9962C]" />
        {dateStr}, {timeStr}
      </div>

      <div className="flex items-start gap-1.5">
        <Sparkles size={12} className="text-[#C9962C] mt-0.5 shrink-0" />
        <p className="text-xs text-[#8688B8] leading-relaxed">
          {expanded ? event.rawDescription : event.aiSummary}
        </p>
      </div>
      <div className="flex items-center justify-between mt-2">
        <button onClick={onExpand} className="text-[10px] text-[#6B6D9E] underline">
          {expanded ? "AI summary" : "Full description"}
        </button>
        <a
          href={event.link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-[#C9962C] hover:text-[#E0B354]"
        >
          Register <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}
