import { useEffect } from "react";

const SITE = "https://sanopos.com";
const DEFAULT_TITLE = "SanoPOS — The POS that adapts to your industry";

function upsertMeta(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertCanonical(href) {
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/**
 * Runtime SEO for the marketing pages (Google/Bing execute JS).
 * Social scrapers don't — they're served per-route static shells emitted by
 * frontend/scripts/prerender-meta.mjs at build time from the same config.
 */
export default function Seo({ title, description, path, ogImage, jsonLd }) {
  useEffect(() => {
    document.title = title;
    upsertMeta("name", "description", description);
    upsertCanonical(`${SITE}${path}`);
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:url", `${SITE}${path}`);
    if (ogImage) upsertMeta("property", "og:image", `${SITE}${ogImage}`);
    upsertMeta("name", "twitter:title", title);
    upsertMeta("name", "twitter:description", description);
    if (ogImage) upsertMeta("name", "twitter:image", `${SITE}${ogImage}`);

    let script = document.getElementById("mk-jsonld");
    if (jsonLd) {
      if (!script) {
        script = document.createElement("script");
        script.id = "mk-jsonld";
        script.type = "application/ld+json";
        document.head.appendChild(script);
      }
      script.textContent = JSON.stringify(jsonLd);
    } else if (script) {
      script.remove();
    }

    return () => {
      document.title = DEFAULT_TITLE;
      const s = document.getElementById("mk-jsonld");
      if (s) s.remove();
    };
  }, [title, description, path, ogImage, jsonLd]);

  return null;
}
