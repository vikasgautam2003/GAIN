// Company tags seed data — curated LeetCode-problem → company mapping, based
// on well-known FAANG/HFT/startup interview question lists. Not exhaustive;
// covers the most frequently-asked ~150 problems. Users can edit from the
// Problem page afterward.
//
// Keys are LC numbers (as strings). Values are arrays of canonical company
// names that map to logos via gain/src/js/companies.js DOMAIN_MAP.

export const LC_COMPANIES = {
  // --- Arrays & Hashing ---
  "1":   ["Amazon", "Google", "Apple", "Microsoft", "Adobe"],
  "217": ["Amazon", "Apple", "Microsoft", "Google"],
  "242": ["Amazon", "Google", "Uber", "Meta", "Palantir"],
  "49":  ["Amazon", "Meta", "Google", "Uber", "Palantir"],
  "347": ["Amazon", "Google", "Meta", "Apple", "Snapchat"],
  "238": ["Amazon", "Meta", "Apple", "Microsoft", "LinkedIn"],
  "36":  ["Amazon", "Meta", "Apple", "Uber"],
  "128": ["Amazon", "Google", "Meta", "Microsoft"],
  "271": ["Google", "Meta", "Uber", "Amazon"],
  "1929":["Amazon"],
  "1480":["Google", "Amazon"],

  // --- Two Pointers ---
  "125": ["Meta", "Amazon", "Microsoft", "Apple"],
  "167": ["Amazon", "Google", "Apple"],
  "15":  ["Amazon", "Meta", "Microsoft", "Google", "Apple"],
  "11":  ["Amazon", "Meta", "Google", "Apple", "Bloomberg"],
  "42":  ["Amazon", "Google", "Meta", "Goldman", "Palantir"],

  // --- Sliding Window ---
  "121": ["Amazon", "Meta", "Google", "Apple", "Bloomberg"],
  "3":   ["Amazon", "Meta", "Google", "Microsoft", "Apple"],
  "424": ["Google", "Amazon", "Meta"],
  "567": ["Microsoft", "Meta", "Amazon"],
  "76":  ["Meta", "Amazon", "Google", "Uber", "LinkedIn"],
  "239": ["Amazon", "Google", "Meta", "Citadel"],

  // --- Stack ---
  "20":  ["Amazon", "Google", "Meta", "Microsoft", "Bloomberg"],
  "155": ["Amazon", "Google", "Bloomberg", "Apple"],
  "150": ["Amazon", "LinkedIn", "Apple"],
  "22":  ["Amazon", "Meta", "Google", "Uber"],
  "739": ["Amazon", "Meta", "Google", "Bloomberg"],
  "853": ["Google"],
  "84":  ["Amazon", "Google", "Microsoft", "Citadel"],

  // --- Binary Search ---
  "704": ["Amazon", "Google", "Microsoft", "Bloomberg"],
  "74":  ["Amazon", "Meta", "Google", "Microsoft"],
  "875": ["Google", "Amazon"],
  "153": ["Amazon", "Meta", "Google", "Microsoft", "Bloomberg"],
  "33":  ["Amazon", "Meta", "Google", "Microsoft", "Apple", "LinkedIn"],
  "981": ["Google", "Amazon"],
  "4":   ["Amazon", "Google", "Meta", "Microsoft", "Apple", "Goldman"],

  // --- Linked List ---
  "206": ["Amazon", "Meta", "Google", "Microsoft", "Apple"],
  "21":  ["Amazon", "Meta", "Google", "Apple", "Microsoft"],
  "143": ["Meta", "Amazon"],
  "19":  ["Amazon", "Meta", "Google"],
  "141": ["Amazon", "Microsoft", "Meta", "Bloomberg"],
  "287": ["Amazon", "Google"],
  "146": ["Amazon", "Meta", "Google", "Microsoft", "Apple", "Uber"],
  "23":  ["Amazon", "Meta", "Google", "Microsoft", "Uber", "LinkedIn"],
  "25":  ["Amazon", "Meta", "Google", "Microsoft"],

  // --- Trees ---
  "226": ["Amazon", "Google", "Meta", "Microsoft"],
  "104": ["Amazon", "Google", "LinkedIn", "Apple"],
  "543": ["Amazon", "Meta", "Google"],
  "110": ["Amazon", "Meta", "Google"],
  "100": ["Amazon", "Google", "Apple"],
  "572": ["Amazon", "Microsoft"],
  "235": ["Amazon", "Meta", "LinkedIn", "Bloomberg"],
  "102": ["Amazon", "Meta", "Google", "LinkedIn", "Bloomberg"],
  "199": ["Amazon", "Meta", "Microsoft"],
  "1448":["Amazon", "Uber"],
  "98":  ["Amazon", "Meta", "Google", "Microsoft", "Bloomberg"],
  "230": ["Amazon", "Meta", "Google", "Bloomberg"],
  "105": ["Amazon", "Meta", "Google", "Bloomberg"],
  "124": ["Amazon", "Meta", "Google", "Microsoft"],
  "297": ["Amazon", "Meta", "Google", "LinkedIn", "Uber"],

  // --- Tries ---
  "208": ["Amazon", "Google", "Microsoft", "Meta"],
  "211": ["Amazon", "Meta", "Google"],
  "212": ["Amazon", "Meta", "Google", "Microsoft"],

  // --- Heap / Priority Queue ---
  "703": ["Amazon", "Google", "Apple"],
  "1046":["Google", "Amazon"],
  "973": ["Amazon", "Meta", "Google"],
  "215": ["Amazon", "Meta", "Google", "LinkedIn", "Apple"],
  "621": ["Meta", "Amazon", "Google", "Uber"],
  "355": ["Twitter", "Amazon", "Meta"],
  "295": ["Amazon", "Meta", "Google"],

  // --- Backtracking ---
  "78":  ["Amazon", "Meta", "Google", "Bloomberg"],
  "39":  ["Amazon", "Meta", "Google", "Uber", "Airbnb"],
  "40":  ["Amazon", "Meta", "Microsoft"],
  "46":  ["Amazon", "Meta", "Google", "LinkedIn", "Microsoft"],
  "90":  ["Amazon", "Meta", "Google"],
  "79":  ["Amazon", "Meta", "Google", "Microsoft", "Bloomberg"],
  "131": ["Amazon", "Meta", "Google", "Bloomberg"],
  "17":  ["Amazon", "Google", "Meta", "Uber"],
  "51":  ["Amazon", "Google", "Meta", "Microsoft"],

  // --- Graphs ---
  "200": ["Amazon", "Meta", "Google", "Microsoft", "Uber", "Palantir"],
  "133": ["Amazon", "Meta", "Google", "LinkedIn"],
  "695": ["Amazon", "Meta", "Google"],
  "417": ["Amazon", "Google"],
  "130": ["Amazon", "Google"],
  "994": ["Amazon", "Meta", "Google"],
  "207": ["Amazon", "Meta", "Google", "Microsoft", "Apple"],
  "210": ["Amazon", "Meta", "Google", "Microsoft", "Snapchat"],
  "684": ["Amazon", "Google", "Uber"],
  "127": ["Amazon", "Meta", "Google", "LinkedIn"],

  // --- Advanced Graphs ---
  "332": ["Google", "Amazon"],
  "787": ["Amazon", "Google"],
  "269": ["Amazon", "Meta", "Google"],
  "778": ["Google", "Amazon"],
  "743": ["Amazon", "Google", "Uber"],

  // --- 1-D DP ---
  "70":  ["Amazon", "Google", "Apple", "Microsoft", "Adobe"],
  "198": ["Amazon", "LinkedIn"],
  "213": ["Amazon", "Microsoft"],
  "5":   ["Amazon", "Meta", "Google", "Microsoft"],
  "647": ["Amazon", "Meta"],
  "91":  ["Amazon", "Meta", "Google", "Uber"],
  "322": ["Amazon", "Google", "Meta", "Goldman", "Uber"],
  "152": ["Amazon", "LinkedIn"],
  "139": ["Amazon", "Meta", "Google", "LinkedIn", "Uber"],
  "300": ["Amazon", "Meta", "Google", "Microsoft"],
  "416": ["Google", "Amazon"],

  // --- 2-D DP ---
  "62":  ["Amazon", "Google", "Bloomberg"],
  "1143":["Amazon", "Google", "Meta"],
  "309": ["Google", "Amazon"],
  "518": ["Amazon", "Google"],
  "494": ["Amazon", "Meta"],
  "97":  ["Google", "Amazon"],
  "72":  ["Amazon", "Google", "LinkedIn", "Meta"],

  // --- Greedy ---
  "53":  ["Amazon", "Meta", "Google", "LinkedIn", "Microsoft", "Bloomberg"],
  "55":  ["Amazon", "Meta", "Google", "Microsoft"],
  "45":  ["Amazon", "Google", "Meta"],
  "134": ["Amazon", "Google"],
  "846": ["Google", "Amazon"],
  "763": ["Amazon", "Meta", "Google"],
  "1899":["Google"],

  // --- Intervals ---
  "57":  ["Amazon", "Meta", "Google", "LinkedIn", "Bloomberg"],
  "56":  ["Amazon", "Meta", "Google", "LinkedIn", "Microsoft", "Bloomberg"],
  "435": ["Amazon", "Google"],
  "252": ["Amazon", "Google", "Meta"],
  "253": ["Amazon", "Meta", "Google", "Uber", "Snapchat"],

  // --- Bit Manipulation ---
  "136": ["Amazon", "Bloomberg", "Palantir"],
  "191": ["Amazon", "Apple"],
  "338": ["Amazon", "Apple"],
  "190": ["Amazon", "Apple"],
  "268": ["Amazon", "Google", "Microsoft"],
  "371": ["Amazon", "Google"],

  // --- Math & Geometry ---
  "202": ["Amazon", "Google", "Bloomberg"],
  "66":  ["Amazon", "Google", "Apple"],
  "48":  ["Amazon", "Meta", "Google", "Microsoft", "Apple"],
  "54":  ["Amazon", "Meta", "Google", "Microsoft", "Bloomberg"],
  "73":  ["Amazon", "Meta", "Google", "Microsoft"],
  "50":  ["Amazon", "Meta", "Google", "LinkedIn", "Bloomberg"],

  // --- SQL popular ---
  "175": ["Amazon", "Meta", "Google"],
  "176": ["Amazon", "Meta"],
  "177": ["Amazon", "Meta", "Google"],
  "181": ["Amazon", "Meta"],
  "182": ["Amazon"],
  "183": ["Amazon", "Meta"],
  "184": ["Amazon", "Meta", "LinkedIn"],
  "185": ["Amazon", "Meta"],
  "196": ["Amazon"],
  "197": ["Amazon"],
  "262": ["Amazon", "Uber", "Lyft"],
};

// Title substring → companies[]. Case-insensitive; applied when no LC# match.
// Order matters: first match wins, so put the most specific first.
export const TITLE_COMPANIES = [
  [/time.?based.?key.?value/i,       ["Google", "Uber", "Amazon"]],
  [/daily temperatures/i,             ["Amazon", "Google", "Meta"]],
  [/pow\(x[^)]*n\)|pow x n/i,         ["Amazon", "Google", "Meta", "Bloomberg"]],
  [/group anagrams/i,                 ["Amazon", "Meta", "Google", "Uber", "Palantir"]],
  [/two sum/i,                        ["Amazon", "Google", "Apple", "Microsoft"]],
  [/contains duplicate/i,             ["Amazon", "Apple", "Microsoft"]],
  [/valid anagram/i,                  ["Amazon", "Google", "Uber", "Meta"]],
  [/longest consecutive/i,            ["Amazon", "Google", "Meta"]],
  [/product of array/i,               ["Amazon", "Meta", "Apple", "LinkedIn"]],
  [/valid sudoku/i,                   ["Amazon", "Meta", "Apple", "Uber"]],
  [/top k frequent/i,                 ["Amazon", "Google", "Meta", "Snapchat"]],
  [/encode and decode strings/i,      ["Google", "Meta", "Uber", "Amazon"]],
  [/best time to buy/i,               ["Amazon", "Meta", "Google", "Apple"]],
  [/longest substring/i,              ["Amazon", "Meta", "Google", "Microsoft"]],
  [/number of islands/i,              ["Amazon", "Meta", "Google", "Palantir", "Microsoft"]],
  [/course schedule/i,                ["Amazon", "Meta", "Google", "Microsoft", "Apple"]],
  [/word search/i,                    ["Amazon", "Meta", "Google", "Bloomberg"]],
  [/word ladder/i,                    ["Amazon", "Meta", "Google", "LinkedIn"]],
  [/trapping rain water/i,            ["Amazon", "Google", "Meta", "Goldman", "Palantir"]],
  [/container with most water/i,      ["Amazon", "Meta", "Google", "Apple"]],
  [/3sum|3 sum/i,                     ["Amazon", "Meta", "Google", "Microsoft"]],
  [/minimum window/i,                 ["Meta", "Amazon", "Google", "Uber"]],
  [/sliding window maximum/i,         ["Amazon", "Google", "Meta", "Citadel"]],
  [/valid parentheses/i,              ["Amazon", "Google", "Meta", "Microsoft", "Bloomberg"]],
  [/min stack/i,                      ["Amazon", "Google", "Bloomberg"]],
  [/evaluate reverse polish/i,        ["Amazon", "LinkedIn"]],
  [/generate parentheses/i,           ["Amazon", "Meta", "Google", "Uber"]],
  [/largest rectangle/i,              ["Amazon", "Google", "Microsoft", "Citadel"]],
  [/binary search\b/i,                ["Amazon", "Google", "Microsoft", "Bloomberg"]],
  [/koko eating bananas/i,            ["Google", "Amazon"]],
  [/find minimum in rotated/i,        ["Amazon", "Meta", "Google", "Bloomberg"]],
  [/search in rotated/i,              ["Amazon", "Meta", "Google", "Microsoft", "LinkedIn"]],
  [/median of two/i,                  ["Amazon", "Google", "Meta", "Apple", "Goldman"]],
  [/reverse linked list/i,            ["Amazon", "Meta", "Google", "Microsoft", "Apple"]],
  [/merge two sorted/i,               ["Amazon", "Meta", "Google", "Apple", "Microsoft"]],
  [/reorder list/i,                   ["Meta", "Amazon"]],
  [/linked list cycle/i,              ["Amazon", "Microsoft", "Meta", "Bloomberg"]],
  [/find the duplicate/i,             ["Amazon", "Google"]],
  [/lru cache/i,                      ["Amazon", "Meta", "Google", "Microsoft", "Apple", "Uber"]],
  [/merge k sorted/i,                 ["Amazon", "Meta", "Google", "Microsoft", "Uber"]],
  [/reverse nodes in k/i,             ["Amazon", "Meta", "Google", "Microsoft"]],
  [/invert binary tree/i,             ["Amazon", "Google", "Meta", "Microsoft"]],
  [/maximum depth of binary/i,        ["Amazon", "Google", "LinkedIn"]],
  [/diameter of binary/i,             ["Amazon", "Meta", "Google"]],
  [/balanced binary tree/i,           ["Amazon", "Meta", "Google"]],
  [/same tree/i,                      ["Amazon", "Google", "Apple"]],
  [/subtree of another/i,             ["Amazon", "Microsoft"]],
  [/lowest common ancestor/i,         ["Amazon", "Meta", "LinkedIn", "Bloomberg"]],
  [/binary tree level order/i,        ["Amazon", "Meta", "Google", "LinkedIn", "Bloomberg"]],
  [/binary tree right side/i,         ["Amazon", "Meta", "Microsoft"]],
  [/count good nodes/i,               ["Amazon", "Uber"]],
  [/validate binary search tree/i,    ["Amazon", "Meta", "Google", "Microsoft"]],
  [/kth smallest element/i,           ["Amazon", "Meta", "Google", "Bloomberg"]],
  [/construct binary tree/i,          ["Amazon", "Meta", "Google", "Bloomberg"]],
  [/binary tree maximum path/i,       ["Amazon", "Meta", "Google", "Microsoft"]],
  [/serialize.?.*binary tree/i,       ["Amazon", "Meta", "Google", "LinkedIn", "Uber"]],
  [/implement trie/i,                 ["Amazon", "Google", "Microsoft", "Meta"]],
  [/design add and search/i,          ["Amazon", "Meta", "Google"]],
  [/word search ii/i,                 ["Amazon", "Meta", "Google", "Microsoft"]],
  [/kth largest element in a stream/i,["Amazon", "Google", "Apple"]],
  [/last stone weight/i,              ["Google", "Amazon"]],
  [/k closest points/i,               ["Amazon", "Meta", "Google"]],
  [/kth largest element in an array/i,["Amazon", "Meta", "Google", "LinkedIn"]],
  [/task scheduler/i,                 ["Meta", "Amazon", "Google", "Uber"]],
  [/design twitter/i,                 ["Twitter", "Amazon", "Meta"]],
  [/find median from data stream/i,   ["Amazon", "Meta", "Google"]],
  [/subsets?\b/i,                     ["Amazon", "Meta", "Google", "Bloomberg"]],
  [/combination sum/i,                ["Amazon", "Meta", "Google", "Uber", "Airbnb"]],
  [/permutations/i,                   ["Amazon", "Meta", "Google", "LinkedIn", "Microsoft"]],
  [/palindrome partitioning/i,        ["Amazon", "Meta", "Google", "Bloomberg"]],
  [/letter combinations/i,            ["Amazon", "Google", "Meta", "Uber"]],
  [/n.?queens/i,                      ["Amazon", "Google", "Meta", "Microsoft"]],
  [/clone graph/i,                    ["Amazon", "Meta", "Google", "LinkedIn"]],
  [/max area of island/i,             ["Amazon", "Meta", "Google"]],
  [/pacific atlantic/i,               ["Amazon", "Google"]],
  [/surrounded regions/i,             ["Amazon", "Google"]],
  [/rotting oranges/i,                ["Amazon", "Meta", "Google"]],
  [/redundant connection/i,           ["Amazon", "Google", "Uber"]],
  [/reconstruct itinerary/i,          ["Google", "Amazon"]],
  [/cheapest flights/i,               ["Amazon", "Google"]],
  [/alien dictionary/i,               ["Amazon", "Meta", "Google"]],
  [/swim in rising water/i,           ["Google", "Amazon"]],
  [/network delay time/i,             ["Amazon", "Google", "Uber"]],
  [/climbing stairs/i,                ["Amazon", "Google", "Apple", "Adobe"]],
  [/house robber/i,                   ["Amazon", "LinkedIn"]],
  [/longest palindromic substring/i,  ["Amazon", "Meta", "Google", "Microsoft"]],
  [/palindromic substrings/i,         ["Amazon", "Meta"]],
  [/decode ways/i,                    ["Amazon", "Meta", "Google", "Uber"]],
  [/coin change/i,                    ["Amazon", "Google", "Meta", "Goldman"]],
  [/maximum product subarray/i,       ["Amazon", "LinkedIn"]],
  [/word break/i,                     ["Amazon", "Meta", "Google", "LinkedIn", "Uber"]],
  [/longest increasing subsequence/i, ["Amazon", "Meta", "Google", "Microsoft"]],
  [/partition equal subset/i,         ["Google", "Amazon"]],
  [/unique paths/i,                   ["Amazon", "Google", "Bloomberg"]],
  [/longest common subsequence/i,     ["Amazon", "Google", "Meta"]],
  [/best time to buy.*cooldown/i,     ["Google", "Amazon"]],
  [/coin change 2|coin change ii/i,   ["Amazon", "Google"]],
  [/target sum/i,                     ["Amazon", "Meta"]],
  [/interleaving string/i,            ["Google", "Amazon"]],
  [/edit distance/i,                  ["Amazon", "Google", "LinkedIn", "Meta"]],
  [/maximum subarray/i,               ["Amazon", "Meta", "Google", "LinkedIn", "Microsoft", "Bloomberg"]],
  [/jump game/i,                      ["Amazon", "Meta", "Google", "Microsoft"]],
  [/gas station/i,                    ["Amazon", "Google"]],
  [/hand of straights/i,              ["Google", "Amazon"]],
  [/partition labels/i,               ["Amazon", "Meta", "Google"]],
  [/valid parenthesis string/i,       ["Google"]],
  [/insert interval/i,                ["Amazon", "Meta", "Google", "LinkedIn", "Bloomberg"]],
  [/merge intervals/i,                ["Amazon", "Meta", "Google", "LinkedIn", "Microsoft", "Bloomberg"]],
  [/non.?overlapping intervals/i,     ["Amazon", "Google"]],
  [/meeting rooms(?!.*ii)/i,          ["Amazon", "Google", "Meta"]],
  [/meeting rooms ii/i,               ["Amazon", "Meta", "Google", "Uber", "Snapchat"]],
  [/single number/i,                  ["Amazon", "Bloomberg", "Palantir"]],
  [/number of 1 bits/i,               ["Amazon", "Apple"]],
  [/counting bits/i,                  ["Amazon", "Apple"]],
  [/reverse bits/i,                   ["Amazon", "Apple"]],
  [/missing number/i,                 ["Amazon", "Google", "Microsoft"]],
  [/sum of two integers/i,            ["Amazon", "Google"]],
  [/happy number/i,                   ["Amazon", "Google", "Bloomberg"]],
  [/plus one/i,                       ["Amazon", "Google", "Apple"]],
  [/rotate image/i,                   ["Amazon", "Meta", "Google", "Microsoft", "Apple"]],
  [/spiral matrix/i,                  ["Amazon", "Meta", "Google", "Microsoft", "Bloomberg"]],
  [/set matrix zeroes/i,              ["Amazon", "Meta", "Google", "Microsoft"]],

  // --- System Design (titles vary a lot — these catch the big ones) ---
  [/design.*url shortener|tinyurl/i,  ["Amazon", "Google", "Meta", "Uber", "Bitly"]],
  [/design.*rate limit/i,             ["Stripe", "Cloudflare", "Google", "Amazon"]],
  [/design.*twitter|news feed/i,      ["Twitter", "Meta", "Amazon", "LinkedIn"]],
  [/design.*instagram/i,              ["Meta", "Snapchat", "Pinterest"]],
  [/design.*uber|lyft|ride.?hail/i,   ["Uber", "DoorDash", "Instacart"]],
  [/design.*whatsapp|messenger|chat/i,["Meta", "Slack", "Discord", "Zoom"]],
  [/design.*netflix|youtube|video/i,  ["Netflix", "Google", "Amazon"]],
  [/design.*dropbox|google drive/i,   ["Dropbox", "Google", "Microsoft"]],
  [/design.*search.*autocomplete/i,   ["Google", "Amazon", "Meta"]],
  [/design.*parking lot/i,            ["Amazon", "Google", "Apple", "Uber"]],
  [/design.*vending/i,                ["Amazon", "Google", "Apple"]],
  [/design.*elevator/i,               ["Amazon", "Google"]],
  [/design.*calendar|scheduling/i,    ["Google", "Microsoft", "Zoom"]],
  [/design.*web ?crawler/i,           ["Google", "Amazon", "Meta"]],
  [/design.*key.?value|kv store/i,    ["Amazon", "Google", "Palantir", "Rocketlane"]],
  [/distributed cache|caching/i,      ["Amazon", "Google", "Meta", "Cloudflare"]],
  [/consistent hashing/i,             ["Amazon", "Google", "Meta", "Cloudflare"]],
  [/pub.?sub|message queue|kafka/i,   ["LinkedIn", "Amazon", "Meta", "Palantir"]],
  [/webhook/i,                        ["Stripe", "Github", "Slack", "Rocketlane"]],
  [/oauth|sso|single sign on/i,       ["Google", "Github", "Okta", "Rocketlane"]],
  [/api.?gateway/i,                   ["Amazon", "Google", "Cloudflare"]],
  [/circuit breaker/i,                ["Netflix", "Amazon", "Google"]],
  [/idempoten/i,                      ["Stripe", "Amazon", "Google"]],

  // --- SQL ---
  [/combine two tables/i,             ["Amazon", "Meta", "Google"]],
  [/second highest salary/i,          ["Amazon", "Meta"]],
  [/nth highest salary/i,             ["Amazon", "Meta", "Google"]],
  [/employees earning more/i,         ["Amazon", "Meta"]],
  [/duplicate emails/i,               ["Amazon"]],
  [/customers who never/i,            ["Amazon", "Meta"]],
  [/department.*highest salary/i,     ["Amazon", "Meta", "LinkedIn"]],
  [/department top three/i,           ["Amazon", "Meta"]],
  [/delete duplicate emails/i,        ["Amazon"]],
  [/rising temperature/i,             ["Amazon"]],
  [/trips and users/i,                ["Amazon", "Uber", "Lyft"]],

  // --- Integrations / Platforms ---
  [/salesforce.*api|salesforce rest/i,["Salesforce", "Rocketlane"]],
  [/hubspot/i,                        ["HubSpot", "Rocketlane"]],
  [/jira|atlassian/i,                 ["Atlassian", "Rocketlane"]],
  [/slack.*api|slack bot/i,           ["Slack", "Rocketlane"]],
  [/zapier/i,                         ["Zapier", "Rocketlane"]],
  [/segment/i,                        ["Segment", "Rocketlane"]],
  [/graphql/i,                        ["Meta", "Github", "Shopify", "Rocketlane"]],
  [/rest api design/i,                ["Google", "Stripe", "Rocketlane"]],
  [/pagination/i,                     ["Stripe", "Github", "Shopify", "Rocketlane"]],
  [/retry.*backoff|exponential backoff/i,["Stripe", "AWS", "Google", "Rocketlane"]],
];

// Look up companies for one row. `lc` is a trimmed string ("49" or ""),
// `title` is the problem title. Returns an array of canonical names,
// possibly empty if nothing matches.
export function companiesForProblem({ lc, title }) {
  if (lc && LC_COMPANIES[lc]) return LC_COMPANIES[lc];
  if (title) {
    for (const [re, list] of TITLE_COMPANIES) {
      if (re.test(title)) return list;
    }
  }
  return [];
}

// One-shot seeder — fills the Companies column for every matching row across
// every sheet. Creates the column if missing. Only writes rows that are
// currently empty (so user edits are never overwritten). Returns {sheets, rows}
// counts for logging. Persists each sheet it touched.
export async function seedAllCompanies({ getSheets, persistSheet, emit }) {
  const sheets = getSheets();
  let sheetsTouched = 0, rowsWritten = 0;
  for (const [name, sh] of Object.entries(sheets)) {
    if (!sh?.rows?.length || !sh.headers?.length) continue;
    const titleCol = sh.headers.find(h => /^(problem|topic|skill(\s*or\s*platform)?|item|name)$/i.test(h.replace(/\s+/g, " ").trim()));
    const lcCol = sh.headers.find(h => /^(lc#?|leetcode)$/i.test(h));
    if (!titleCol && !lcCol) continue;
    let col = sh.headers.find(h => /^compan(y|ies)$/i.test(h));
    if (!col) { col = "Companies"; sh.headers.push(col); }
    let touchedThisSheet = 0;
    for (const row of sh.rows) {
      if (row[col] && String(row[col]).trim()) continue;  // keep user edits
      const lc = lcCol ? String(row[lcCol] || "").trim() : "";
      const title = titleCol ? String(row[titleCol] || "").trim() : "";
      if (!lc && !title) continue;
      const list = companiesForProblem({ lc, title });
      if (!list.length) continue;
      row[col] = list.join(", ");
      touchedThisSheet++;
    }
    if (touchedThisSheet > 0) {
      await persistSheet(name);
      emit?.("sheet", name);
      sheetsTouched++;
      rowsWritten += touchedThisSheet;
    }
  }
  return { sheetsTouched, rowsWritten };
}
