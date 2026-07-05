"""
scrape_telegram.py

Fetches new posts from a *public* Telegram channel using the unauthenticated
preview endpoint (t.me/s/<channel>). No bot token or login needed — this only
works because the channel is public. Paginate backwards with ?before=<id>.

Usage:
    python scrape_telegram.py --channel Buddhism_Events --state state.json --out raw_posts.jsonl
"""

import argparse
import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE = "https://t.me/s/{channel}"
HEADERS = {"User-Agent": "Mozilla/5.0 (DharmaOnlineBot/1.0; +https://example.com/bot)"}


def fetch_page(channel: str, before: int | None = None) -> str:
    url = BASE.format(channel=channel)
    params = {"before": before} if before else {}
    resp = requests.get(url, params=params, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    return resp.text


def parse_posts(html: str) -> list[dict]:
    """Parse message blocks out of a t.me/s/<channel> page.

    NOTE: Telegram's embed HTML is undocumented and can change. If this
    stops finding posts, open the page in a browser, view source, and
    update the selectors below (search for 'tgme_widget_message').
    """
    soup = BeautifulSoup(html, "html.parser")
    posts = []

    for wrap in soup.select("div.tgme_widget_message_wrap"):
        msg_div = wrap.select_one("div.tgme_widget_message[data-post]")
        if not msg_div:
            continue

        data_post = msg_div.get("data-post", "")  # e.g. "Buddhism_Events/12415"
        try:
            msg_id = int(data_post.split("/")[-1])
        except ValueError:
            continue

        text_div = msg_div.select_one("div.tgme_widget_message_text")
        text = text_div.get_text("\n", strip=True) if text_div else ""

        time_el = msg_div.select_one("a.tgme_widget_message_date time")
        timestamp = time_el.get("datetime") if time_el else None

        # Forwarded-from indicates a repost, often not a fresh event announcement
        fwd_el = msg_div.select_one(".tgme_widget_message_forwarded_from_name")
        forwarded_from = fwd_el.get_text(strip=True) if fwd_el else None

        # Any external links mentioned in the text (registration pages etc.)
        links = [a.get("href") for a in (text_div.select("a") if text_div else []) if a.get("href")]

        # Link preview card, if Telegram rendered one (title/description/url)
        preview = msg_div.select_one("a.tgme_widget_message_link_preview")
        preview_data = None
        if preview:
            title_el = preview.select_one(".link_preview_title")
            desc_el = preview.select_one(".link_preview_description")
            preview_data = {
                "url": preview.get("href"),
                "title": title_el.get_text(strip=True) if title_el else None,
                "description": desc_el.get_text(strip=True) if desc_el else None,
            }

        views_el = msg_div.select_one("span.tgme_widget_message_views")
        views = views_el.get_text(strip=True) if views_el else None

        posts.append({
            "message_id": msg_id,
            "url": f"https://t.me/{data_post}",
            "posted_at": timestamp,
            "text": text,
            "forwarded_from": forwarded_from,
            "links": links,
            "link_preview": preview_data,
            "views": views,
        })

    return posts


def load_state(path: Path) -> dict:
    if path.exists():
        return json.loads(path.read_text())
    return {"last_seen_id": 0}


def save_state(path: Path, state: dict) -> None:
    path.write_text(json.dumps(state, indent=2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--channel", default="Buddhism_Events")
    ap.add_argument("--state", default="state.json")
    ap.add_argument("--out", default="raw_posts.jsonl")
    ap.add_argument("--max-pages", type=int, default=5, help="safety cap when backfilling")
    args = ap.parse_args()

    state_path = Path(args.state)
    state = load_state(state_path)
    last_seen = state["last_seen_id"]

    all_new = []
    before = None
    for _ in range(args.max_pages):
        html = fetch_page(args.channel, before=before)
        posts = parse_posts(html)
        if not posts:
            break

        new_on_page = [p for p in posts if p["message_id"] > last_seen]
        all_new.extend(new_on_page)

        oldest_id = min(p["message_id"] for p in posts)
        if len(new_on_page) < len(posts):
            # hit posts we've already seen — stop paginating further back
            break

        before = oldest_id
        time.sleep(1)  # be polite

    if all_new:
        max_id = max(p["message_id"] for p in all_new)
        with open(args.out, "a", encoding="utf-8") as f:
            for post in sorted(all_new, key=lambda p: p["message_id"]):
                f.write(json.dumps(post, ensure_ascii=False) + "\n")
        state["last_seen_id"] = max(max_id, last_seen)
        save_state(state_path, state)
        print(f"Wrote {len(all_new)} new posts. last_seen_id -> {state['last_seen_id']}")
    else:
        print("No new posts.")


if __name__ == "__main__":
    main()
