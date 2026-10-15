# Land Deal Analyzer — Claude Code Context

## What this is
A single-file HTML/JS web app for vacant land wholesaling deal analysis. Enter a parcel ID and it auto-fills deal details via the LandPortal API, then runs full deal math (ARV, MAO, profit, ROI, deal score).

## Current state
Fully functional artifact built in Claude.ai. Ready to be extracted into a real project, hosted, and iterated on. The full HTML/JS source should be in `index.html` in this repo.

---

## LandPortal API integration

**Base URL:** `https://landportal.com/wp-json/lp-rest-api/v1`

**Auth:** All requests require `Authorization: Bearer <JWT_TOKEN>` header. JWT is saved in `localStorage` under key `lp_jwt`.

### The 3-step auto-fill flow (runs sequentially on "Look up"):

#### Step 1 — Property Search
```
GET /search?type=parcelnumb&query={APN}&state={2-letter-state}
```
Returns GeoJSON FeatureCollection. Each feature has:
- `properties.propertyid` — needed for steps 2 & 3
- `properties.fips` — 5-digit county FIPS code, needed for steps 2 & 3
- `properties.parcelnumb`, `properties.owner`, `properties.address`

If multiple results → show picker dropdown. If 1 result → auto-proceed to step 2.
`search_limit` is decremented only when results are found; resets daily at midnight ET.

#### Step 2 — Property Data
```
GET /property-data?propertyid={id}&fips={fips}
```
Returns `data.property` object. Fields vary by account config — the example in docs shows `address`, `city`, `state`, `zip` but your account may return more (acreage, zoning, APN, etc). Always show a "raw API data" toggle so no fields are hidden.

Quota: deducts from `single_property_limit` first, then from subscription export rows. Returns 403 when both exhausted.

Auto-fills from this response: `county`, `apn`, `acreage`, `zoning` (guessed from land use string).

#### Step 3 — Comp Report (async)
```
POST /reports  body: { propertyid, fips }
→ GET  /reports?propertyid={id}&fips={fips}   (poll until ready)
```
POST kicks off async generation, returns `task_id`. Then poll GET every 2.5s (up to 15 attempts) until the report appears. Error `"Report not found"` on GET means still generating — keep polling.

GET response fields that map to the analyzer:
| API field | Maps to |
|---|---|
| `location` | county/state display |
| `apn` | APN field |
| `size` | acreage |
| `land_locked` | road access → "none" if true |
| `road_frontage` | road access → "paved" if > 0; also displayed as ft |
| `fema_cover_percentage` | flood zone: >50% = yes, 5-50% = partial, <5% = no |
| `landuse` | zoning (guessed) |
| `total_our_estimation_values_base` | LP estimated value (display card) |
| `price_acre_our_estimation_values_base` | LP price/acre |
| `price_acre_mean` | mean price/acre |
| `price_acre_county` | county avg price/acre |
| `wetlands_cover_percentage` | wetlands display |
| `link` | LandPortal property link |

`comp_reports_limit` is decremented per POST call; resets daily at midnight ET.

### Skip Trace API (built in docs, NOT yet in UI — add later)
```
POST /skip-trace
```
- `method: "create_single"` for instant single-record lookup (owner name + address → phones)
- `method: "create"` for bulk CSV/JSON batch
- Returns phones with `line_type`, `dnc` flag, `dnc_types`
- `single_skip_trace_limit` resets daily at midnight ET

---

## Deal math formulas

```js
// ARV = average $/acre from sold comps × subject acreage
arvPPA = avg(soldComps.filter(c => c.ppa > 0).map(c => c.ppa))
arv = arvPPA * acreage

// Costs
totalCosts = closing + holding + hoa_annual

// MAO (70% rule)
mao = arv * 0.70 - totalCosts

// Effective buy price
effectiveBuy = buyPrice > 0 ? buyPrice : askingPrice

// Profit & list price by exit strategy:
// wholesale:     listPrice = effectiveBuy * 1.2     profit = listPrice - effectiveBuy
// retail:        listPrice = arv * 0.95             profit = listPrice - effectiveBuy - totalCosts
// owner_finance: listPrice = arv * 1.1              profit = listPrice * 0.15
// subdivide:     listPrice = arv * 1.3              profit = listPrice - effectiveBuy - (arv * 0.05)

// ROI
roi = (profit / effectiveBuy) * 100
```

## Deal score (0–100)

Starts at 50, then:

| Condition | Adjustment |
|---|---|
| ARV spread > 40% | +20 |
| ARV spread 25–40% | +12 |
| ARV spread 10–25% | +4 |
| ARV spread < 0% | -20 |
| Asking ≤ MAO | +10 |
| Asking > 85% of ARV | -15 |
| Paved road | +8 |
| Dirt road | +3 |
| Easement only | -5 |
| No access / landlocked | -18 |
| FEMA flood zone | -15 |
| Partial flood | -6 |
| Full utilities | +7 |
| No utilities | -4 |
| Flat terrain | +5 |
| Mountainous | -3 |
| HOA present | -3 |
| ≥ 3 sold comps | +5 |
| 0 sold comps | -10 |

Score bands: 80+ = Strong deal (green), 60–79 = Decent deal (amber), 40–59 = Marginal (red), <40 = Weak (red).

---

## UI structure

Three tabs:

### 1. Parcel details tab
- LandPortal lookup panel (JWT input, APN + state fields, Look up button)
- Step progress pills: Search → Property data → Comp report
- Search results dropdown (when multiple parcels match)
- Status bar with live messages
- Raw API data toggle (expandable JSON dump)
- Parcel details card: county/state, APN, acreage, zoning, road access, flood zone, utilities, terrain
- Deal terms card: asking price, buy price, closing costs, holding costs, HOA, exit strategy
- LP Estimates card (appears after comp report loads): LP est. value, LP $/acre, mean $/acre, county avg $/acre, road frontage, wetlands %

### 2. Comps tab
- Sold comps table: address, acres, sale price, $/acre (auto-calculated)
- Active listings table: same structure
- Add/remove rows inline

### 3. Analysis tab
- Deal score bar + badge + label
- 4 metric cards: ARV, MAO, Projected profit, ROI
- Insights list (auto-generated flags with color dots)
- Price recommendation summary box
- Reset button + "Negotiation script ↗" button (sendPrompt to Claude)

---

## Zoning guess logic
```js
function guessZoning(raw) {
  const r = raw.toLowerCase();
  if (r.includes('agri') || r.includes('rural') || r.includes('farm') || r.includes('vacl') || r.includes('vacant land')) return 'rural';
  if (r.includes('comm') || r.includes('retail') || r.includes('office')) return 'commercial';
  if (r.includes('ind') || r.includes('manuf') || r.includes('warehouse')) return 'industrial';
  if (r.includes('rec') || r.includes('park') || r.includes('open space')) return 'recreational';
  if (r.includes('res') || r.includes('single') || r.includes('multi')) return 'residential';
  return '';
}
```

---

## What's next / feature backlog

### High priority
- [ ] **Test against real LandPortal API** — verify property data fields your account actually returns; expand `autofillProperty()` to map them
- [ ] **CORS handling** — LandPortal API may block direct browser fetch; may need a thin proxy (Cloudflare Worker or simple Express server) to relay requests with the JWT
- [ ] **Save/load deals** — export deal as JSON, reload later
- [ ] **PDF export** — one-page deal summary printout

### Medium priority
- [ ] **Skip trace integration** — after parcel loads, one-click `create_single` skip trace to get owner phone numbers; display with DNC flags
- [ ] **Multi-deal comparison** — side-by-side table of saved deals
- [ ] **Comp report auto-import** — parse LandPortal comp report link to pre-populate sold comps table

### Lower priority
- [ ] **Map embed** — show parcel location on a map using the GeoJSON coordinates from search results
- [ ] **Negotiation script generator** — structured Claude prompt that uses deal fields to generate a seller script

---

## CORS note (important for deployment)
LandPortal's API (`landportal.com/wp-json/...`) will likely reject direct browser `fetch()` calls with a CORS error. If that happens, the fix is a simple proxy — either:
- A Cloudflare Worker that forwards requests and injects the JWT server-side (keeps the token out of the browser)
- A local Express/Node server for development

Ask Claude Code to set this up if you hit CORS errors during testing.

---

## File structure (suggested)
```
land-analyzer/
  CLAUDE.md          ← this file (auto-loaded by Claude Code)
  index.html         ← the full app (single file)
  proxy/             ← optional: Cloudflare Worker or Express proxy for CORS
    worker.js
  README.md
```
