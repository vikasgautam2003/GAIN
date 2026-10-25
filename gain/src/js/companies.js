// Company tags — shared helpers for logo URLs + chip HTML.
// Uses Clearbit Logo API for well-known companies, falls back to Google's
// favicon service (s2) for anything else. Both are free, no API key.

// Known-name → canonical domain. Add as needed; unlisted names fall back to
// "<lowercased-name>.com" which usually works for recognizable brands.
const DOMAIN_MAP = {
  "google": "google.com",
  "alphabet": "abc.xyz",
  "meta": "meta.com",
  "facebook": "meta.com",
  "amazon": "amazon.com",
  "aws": "aws.amazon.com",
  "apple": "apple.com",
  "microsoft": "microsoft.com",
  "ms": "microsoft.com",
  "palantir": "palantir.com",
  "netflix": "netflix.com",
  "uber": "uber.com",
  "stripe": "stripe.com",
  "linear": "linear.app",
  "openai": "openai.com",
  "anthropic": "anthropic.com",
  "tesla": "tesla.com",
  "nvidia": "nvidia.com",
  "airbnb": "airbnb.com",
  "linkedin": "linkedin.com",
  "atlassian": "atlassian.com",
  "oracle": "oracle.com",
  "ibm": "ibm.com",
  "intel": "intel.com",
  "cisco": "cisco.com",
  "cloudflare": "cloudflare.com",
  "notion": "notion.so",
  "figma": "figma.com",
  "slack": "slack.com",
  "github": "github.com",
  "gitlab": "gitlab.com",
  "dropbox": "dropbox.com",
  "snap": "snap.com",
  "snapchat": "snap.com",
  "x": "x.com",
  "twitter": "twitter.com",
  "tiktok": "tiktok.com",
  "bytedance": "bytedance.com",
  "pinterest": "pinterest.com",
  "doordash": "doordash.com",
  "instacart": "instacart.com",
  "zoom": "zoom.us",
  "yelp": "yelp.com",
  "goldmansachs": "goldmansachs.com",
  "goldman": "goldmansachs.com",
  "morganstanley": "morganstanley.com",
  "jpmorgan": "jpmorgan.com",
  "citadel": "citadel.com",
  "twosigma": "twosigma.com",
  "jane street": "janestreet.com",
  "janestreet": "janestreet.com",
  "hrt": "hudsonrivertrading.com",
  "optiver": "optiver.com",
  "db": "db.com",
  "deutschebank": "db.com",
  "squarepoint": "squarepointcap.com",
  "akuna": "akunacapital.com",
  "flipkart": "flipkart.com",
  "swiggy": "swiggy.com",
  "zomato": "zomato.com",
  "paytm": "paytm.com",
  "razorpay": "razorpay.com",
  "freshworks": "freshworks.com",
  "zoho": "zoho.com",
  "walmart": "walmart.com",
  "ebay": "ebay.com",
  "paypal": "paypal.com",
  "shopify": "shopify.com",
  "coinbase": "coinbase.com",
  "roblox": "roblox.com",
  "epic": "epicgames.com",
  "activision": "activision.com",
  "ea": "ea.com",
  "disney": "disney.com",
  "spotify": "spotify.com",
  "soundcloud": "soundcloud.com",
  "mongodb": "mongodb.com",
  "snowflake": "snowflake.com",
  "databricks": "databricks.com",
  "datadog": "datadoghq.com",
  "elastic": "elastic.co",
  "redis": "redis.com",
  "rocketlane": "rocketlane.com",
  // Added for OS / Networking seeding
  "linux": "kernel.org",
  "red hat": "redhat.com",
  "redhat": "redhat.com",
  "arm": "arm.com",
  "juniper": "juniper.net",
  "nginx": "nginx.com",
  "dell": "dell.com",
  "netapp": "netapp.com",
  "discord": "discord.com",
  "slack": "slack.com",
  "auth0": "auth0.com",
  "let's encrypt": "letsencrypt.org",
  "lets encrypt": "letsencrypt.org",
  "aws": "aws.amazon.com",
};

export function domainForCompany(name) {
  if (!name) return "";
  const n = String(name).toLowerCase().trim();
  if (DOMAIN_MAP[n]) return DOMAIN_MAP[n];
  // Try name without spaces too
  const nospace = n.replace(/\s+/g, "");
  if (DOMAIN_MAP[nospace]) return DOMAIN_MAP[nospace];
  // Fallback: <name>.com if it looks like a brand name
  const slug = nospace.replace(/[^a-z0-9-]/g, "");
  return slug ? `${slug}.com` : "";
}

// Public logo URL — Google S2 favicon service (reliable, free, no API key, no
// rate limit at this volume). Clearbit's logo API was deprecated/unreliable in
// 2024, so we switched everything to S2. For a 20-28px display the 64px
// request is sharp enough.
export function logoUrl(name, size = 64) {
  const domain = domainForCompany(name);
  if (!domain) return "";
  // sz hint is a request; Google decides what to actually serve.
  const px = size <= 32 ? 64 : size <= 48 ? 96 : 128;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${px}`;
}
// Kept for callers; same source now (Clearbit was dead).
export function faviconFallback(name, size = 32) {
  return logoUrl(name, size);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
}

// A deterministic hue per company so the letter-avatar fallback has colour.
function hueFor(name) {
  let h = 0;
  const s = String(name || "").toLowerCase();
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

// Pretty chip HTML with company logo + name. The chip is a letter-avatar
// (always drawn in a colored circle) with the <img> stacked on top. If the
// image loads, it covers the letter. If it fails, onerror hides it and the
// letter underneath becomes the fallback automatically — no second network
// request, no broken-image icon.
export function companyChipHtml(name, removable = false) {
  const logo = logoUrl(name, 64);
  const hue = hueFor(name);
  const letter = esc((name || "·").slice(0, 1).toUpperCase());
  return `<span class="pcr-chip" data-c="${esc(name)}">
    <span class="pcr-logo" style="background:hsl(${hue} 65% 48%);" data-letter="${letter}">
      ${logo ? `<img src="${esc(logo)}" alt="" onerror="this.style.display='none'" />` : ""}
    </span>
    <span class="pcr-name">${esc(name)}</span>
    ${removable ? `<button class="pcr-x" aria-label="Remove ${esc(name)}">×</button>` : ""}
  </span>`;
}

// Compact logo-only chip. Same stack-on-letter technique, no fallback request.
export function companyIconHtml(name, px = 22) {
  const logo = logoUrl(name, 64);
  const hue = hueFor(name);
  const letter = esc((name || "·").slice(0, 1).toUpperCase());
  return `<span class="co-ico" title="${esc(name)}" style="width:${px}px;height:${px}px;background:hsl(${hue} 65% 48%);font-size:${Math.max(10, Math.round(px * 0.55))}px;" data-letter="${letter}">
    ${logo ? `<img src="${esc(logo)}" alt="${esc(name)}" onerror="this.style.display='none'" />` : ""}
  </span>`;
}

// A single <style> block that every page can include once to style the
// stacked-icon pattern consistently. Call injectCompanyStyles() on page mount.
export function injectCompanyStyles() {
  if (document.getElementById("company-shared-styles")) return;
  const s = document.createElement("style");
  s.id = "company-shared-styles";
  s.textContent = `
    .co-ico {
      position: relative; display: inline-flex; align-items: center; justify-content: center;
      border-radius: 50%; overflow: hidden; color: #fff; font-weight: 700; letter-spacing: 0;
      flex-shrink: 0; vertical-align: middle; line-height: 1;
    }
    .co-ico::before { content: attr(data-letter); position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center; z-index: 0; }
    .co-ico img { position: relative; z-index: 1; width: 100%; height: 100%; object-fit: contain;
      display: block; background: #fff; padding: 2px; border-radius: inherit; }
    /* pcr-logo (problem-page chip editor) also uses the stacked approach */
    .pcr-logo { position: relative; width: 22px; height: 22px; border-radius: 50%; overflow: hidden;
      color: #fff; font: 700 11px/1 var(--font-sans); display: inline-flex; align-items: center;
      justify-content: center; flex-shrink: 0; }
    .pcr-logo::before { content: attr(data-letter); position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center; z-index: 0; }
    .pcr-logo img { position: relative; z-index: 1; width: 100%; height: 100%; object-fit: contain;
      background: #fff; padding: 2px; border-radius: inherit; display: block; }
  `;
  document.head.appendChild(s);
}

// Parse a comma-separated list from a sheet row's Companies column.
export function parseCompanies(raw) {
  return String(raw || "").split(",").map(s => s.trim()).filter(Boolean);
}

// Given a row object + sheet headers, return the parsed companies list.
export function rowCompanies(row, headers) {
  const col = headers?.find(h => /^compan(y|ies)$/i.test(h));
  return col ? parseCompanies(row[col]) : [];
}
