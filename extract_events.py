"""
extract_events.py

Reads raw_posts.jsonl (from scrape_telegram.py) and uses Claude to turn each
post into zero, one, or more structured event records. Handles the messy
realities we saw in the actual channel:
  - one post can describe multiple events (multi-city tours)
  - some posts are recordings of past talks, not upcoming events
  - online/in-person/hybrid isn't always stated
  - times are written in every human format imaginable

Requires: pip install anthropic --break-system-packages
Set ANTHROPIC_API_KEY in your environment.

Usage:
    python extract_events.py --in raw_posts.jsonl --out events.jsonl
"""

import argparse
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import anthropic

# Haiku is plenty for this extraction task and costs roughly 5x less than Sonnet —
# worth using here to keep this pipeline close to free. Swap to "claude-sonnet-4-6"
# if you ever notice it struggling on a genuinely confusing post.
MODEL = "claude-haiku-4-5-20251001"


def dedup_key(event: dict) -> str:
    """Best-effort key to avoid the same real-world event showing up twice
    (e.g. a channel reposting/boosting the same event later)."""
    teacher = (event.get("teacher") or "").strip().lower()
    title = re.sub(r"[^a-z0-9]+", " ", event["title"].strip().lower())[:40]
    date_part = (event.get("start_utc") or event.get("start_local_text") or "")[:10]
    raw = f"{teacher}|{title}|{date_part}"
    return hashlib.sha1(raw.encode()).hexdigest()


def is_upcoming(event: dict) -> bool:
    start_utc = event.get("start_utc")
    if not start_utc:
        return True  # unknown date — keep it, needs_review will already be true
    try:
        dt = datetime.fromisoformat(start_utc.replace("Z", "+00:00"))
        return dt >= datetime.now(timezone.utc)
    except ValueError:
        return True

SYSTEM_PROMPT = f"""You extract Buddhist dharma event listings from raw Telegram posts for an \
app called Dharma Online. Today's date is {datetime.now(timezone.utc).strftime('%Y-%m-%d')} (UTC).

A single post may describe ZERO, ONE, or MULTIPLE distinct events (e.g. a multi-city \
teaching tour with different dates per city — split these into separate event objects, \
one per date/location).

Mark is_event = false (and return an empty events array) when the post is:
  - a recording or writeup of something that already happened, not a future session
  - not actually an event (a general announcement, a comment, an off-topic link)

For each real event, extract:
  - title: short, human-readable, drop marketing flourish
  - teacher: the named teacher(s)/speaker(s), or null if not stated
  - tradition: Theravada / Zen / Chan / Vajrayana / Tibetan (specify school if named, \
e.g. Nyingma, Kagyu, Gelug, Bön) / Insight / unspecified — best guess, null if truly unclear
  - is_online: "yes" | "no" | "hybrid" | "unknown" — only mark "yes"/"hybrid" if the post \
says so explicitly (webcast, Zoom, livestream, "join online"). Don't assume.
  - platform: "Zoom" | "YouTube" | "Telegram" | "Other" | "unknown"
  - platform_detail: free text if platform is "Other" or details matter (e.g. "Circle.so")
  - start_local_text: the date/time exactly as written in the post (don't normalize yet)
  - timezone_raw: the timezone as written (e.g. "CET", "Paris time", "Eastern Time"), null if absent
  - timezone_iana: your best-guess IANA timezone identifier (e.g. "Europe/Paris"), null if you \
can't determine it confidently
  - start_utc: ISO 8601 UTC datetime IF you can confidently compute it from the above, else null
  - is_recurring: boolean, true for weekly/ongoing series
  - registration_link: the most likely URL for registering/joining, null if none present
  - description_raw: 1-2 sentence factual excerpt from the post (not the full text)
  - ai_summary: one plain-language sentence a newcomer would understand, describing what \
the event actually is and who it's for
  - confidence: "high" | "medium" | "low" — your overall confidence in this extraction
  - needs_review: boolean — true if any important field (date, time, online status, \
platform, registration link) is missing, ambiguous, or only inferable from an external \
link you can't see the contents of

Be conservative. It's better to mark needs_review=true than to invent a date, timezone, \
or online/offline status that isn't actually stated in the text.

IMPORTANT — only flag needs_review=true when a human genuinely must decide something. \
That means ONLY in these two cases:
  1. is_online is "yes" or "hybrid" but there is no registration_link at all — a person \
     can't actually join without one.
  2. There is no usable date/time information whatsoever (start_local_text is null AND \
     start_utc is null) — we can't schedule it.
A vague or unconverted timezone is fine to leave as needs_review=false as long as \
start_local_text captures what was written — the app can display the original text \
verbatim if start_utc is null. Don't flag things just because you're not 100% sure; \
only flag true blockers.

Also: NEVER include an event where is_online is "no" (in-person only) — this app is \
online-only, so leave those out of the events array entirely (they still count toward \
is_event if you want, but don't emit an event object for them)."""

EXTRACT_TOOL = {
    "name": "record_events",
    "description": "Record the structured events extracted from a single source post.",
    "input_schema": {
        "type": "object",
        "properties": {
            "is_event": {"type": "boolean"},
            "events": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "teacher": {"type": ["string", "null"]},
                        "tradition": {"type": ["string", "null"]},
                        "is_online": {"type": "string", "enum": ["yes", "no", "hybrid", "unknown"]},
                        "platform": {"type": "string", "enum": ["Zoom", "YouTube", "Telegram", "Other", "unknown"]},
                        "platform_detail": {"type": ["string", "null"]},
                        "start_local_text": {"type": ["string", "null"]},
                        "timezone_raw": {"type": ["string", "null"]},
                        "timezone_iana": {"type": ["string", "null"]},
                        "start_utc": {"type": ["string", "null"]},
                        "is_recurring": {"type": "boolean"},
                        "registration_link": {"type": ["string", "null"]},
                        "description_raw": {"type": "string"},
                        "ai_summary": {"type": "string"},
                        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                        "needs_review": {"type": "boolean"},
                    },
                    "required": [
                        "title", "is_online", "platform", "is_recurring",
                        "description_raw", "ai_summary", "confidence", "needs_review",
                    ],
                },
            },
        },
        "required": ["is_event", "events"],
    },
}


def extract_one(client: anthropic.Anthropic, post: dict) -> list[dict]:
    user_content = (
        f"Post URL: {post['url']}\n"
        f"Posted at: {post.get('posted_at')}\n"
        f"Forwarded from: {post.get('forwarded_from')}\n"
        f"Link preview: {json.dumps(post.get('link_preview'))}\n"
        f"Links in text: {post.get('links')}\n\n"
        f"Post text:\n{post['text']}"
    )

    resp = client.messages.create(
        model=MODEL,
        max_tokens=2000,
        system=SYSTEM_PROMPT,
        tools=[EXTRACT_TOOL],
        tool_choice={"type": "tool", "name": "record_events"},
        messages=[{"role": "user", "content": user_content}],
    )

    for block in resp.content:
        if block.type == "tool_use" and block.name == "record_events":
            result = block.input
            events = result.get("events", []) if result.get("is_event") else []
            for e in events:
                e["source"] = "telegram"
                e["source_message_url"] = post["url"]
                e["source_message_id"] = post["message_id"]
            return events
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", default="raw_posts.jsonl")
    ap.add_argument("--out", dest="outfile", default="events.jsonl")
    args = ap.parse_args()

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    # Load dedup keys already in the output file so re-runs don't duplicate events
    seen_keys = set()
    outfile_path = Path(args.outfile)
    if outfile_path.exists():
        with open(outfile_path, encoding="utf-8") as existing:
            for line in existing:
                try:
                    seen_keys.add(dedup_key(json.loads(line)))
                except (json.JSONDecodeError, KeyError):
                    continue

    kept, skipped_past, skipped_dupe = 0, 0, 0

    with open(args.infile, encoding="utf-8") as f, open(args.outfile, "a", encoding="utf-8") as out:
        for line in f:
            post = json.loads(line)
            if not post["text"].strip() and not post.get("link_preview"):
                continue  # nothing to extract from (media-only post)

            events = extract_one(client, post)  # already excludes in-person-only events
            for e in events:
                if not is_upcoming(e):
                    skipped_past += 1
                    continue
                key = dedup_key(e)
                if key in seen_keys:
                    skipped_dupe += 1
                    continue
                seen_keys.add(key)
                out.write(json.dumps(e, ensure_ascii=False) + "\n")
                kept += 1
            print(f"{post['url']}: {len(events)} extracted")

    print(f"\nDone. Kept {kept} upcoming/online events. "
          f"Skipped {skipped_past} past, {skipped_dupe} duplicates.")


if __name__ == "__main__":
    main()
