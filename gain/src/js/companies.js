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

// Public logo URL. Clearbit for cleaner-brand lookups; favicon fallback via
// Google S2 service (used as the <img> `onerror` fallback inline).
export function logoUrl(name, size = 32) {
  const domain = domainForCompany(name);
  if (!domain) return "";
  return `https://logo.clearbit.com/${domain}?size=${size}`;
}
export function faviconFallback(name, size = 32) {
  const domain = domainForCompany(name);
  if (!domain) return "";
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size * 2}`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
}

// Pretty chip HTML with company logo + name. If removable, adds an × button.
export function companyChipHtml(name, removable = false) {
  const logo = logoUrl(name, 32);
  const fallback = faviconFallback(name, 32);
  return `<span class="pcr-chip" data-c="${esc(name)}">
    ${logo ? `<img class="pcr-logo" src="${esc(logo)}" alt="" onerror="this.onerror=null;this.src='${esc(fallback)}';" />` : `<span class="pcr-logo pcr-logo-fallback">${esc(name.slice(0, 1).toUpperCase())}</span>`}
    <span class="pcr-name">${esc(name)}</span>
    ${removable ? `<button class="pcr-x" aria-label="Remove ${esc(name)}">×</button>` : ""}
  </span>`;
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
