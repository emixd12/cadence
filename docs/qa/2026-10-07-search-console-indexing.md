# October 7 Search Console indexing alert

**Verdict: expected exclusion; no remediation required.** Google reports exactly
one redirect example: `http://cadence-me.com/`. Vercel permanently redirects it
to `https://cadence-me.com/`. Google indexes that HTTPS destination and selects
it as canonical. Neither `/cadence` nor `/standard` appears in Google's examples.

Investigation: October 7, 2026, approximately 21:10–21:18 EDT.
The supplied notification arrived October 7 at 03:02 ET. The email itself was
not retrieved. The evidence below comes from authenticated Search Console,
Google APIs, Vercel APIs, live unauthenticated HTTP GETs, and local build output.

## Google evidence

The existing **Identity Scaffolding** Chrome profile opens Search Console as
`info@identityscaffolding.com`. Settings says **You are a verified owner**.
The exact property is **`sc-domain:cadence-me.com`**. No permissions changed.

[Page indexing](https://search.google.com/search-console/index?resource_id=sc-domain%3Acadence-me.com)
shows one indexed page and one excluded page. Its only exclusion reason is
**Page with redirect**, count **1**, validation **Not Started**.
The report displays last update **10/3/26** and first detection **10/5/26**.
Those dates are transcribed as displayed; their apparent inconsistency is unresolved.

[Redirect examples](https://search.google.com/search-console/index/drilldown?resource_id=sc-domain%3Acadence-me.com&item_key=CAMYCyAC)
contains one row, `http://cadence-me.com/`, last crawled **Sep 30, 2026**.
The row's detail panel displays **Sep 30, 2026, 4:54:32 PM**.

Indexed-state URL Inspection supplies newer information for that HTTP URL:

| Field | HTTP source | HTTPS destination |
|---|---|---|
| Exact URL | `http://cadence-me.com/` | `https://cadence-me.com/` |
| Google status | URL is not on Google | URL is on Google |
| Coverage | Page is not indexed: Page with redirect | Page is indexed |
| Last crawl | Oct 7, 2026, 2:41:29 PM | Sep 30, 2026, 4:54:32 PM |
| Crawler | Googlebot smartphone | Googlebot smartphone |
| Crawl allowed / indexing allowed | Yes / Yes | Yes / Yes |
| Fetch | Successful | Successful |
| User-declared canonical | `https://cadence-me.com/` | `https://cadence-me.com/` |
| Google-selected canonical | Same as user-declared canonical | Inspected URL |
| Referring page | `https://cadence-me.com/` | `http://cadence-me.com/` |
| Sitemaps field | No referring sitemaps detected | Temporary processing error |

Times above preserve Google's display. The UI did not identify their timezone.
The HTTP inspection's reported canonical is Google's stored result, not an HTML
canonical in today's HTTP 308 response. Inspection reads indexed-state data;
no live inspection, indexing request, or validation request ran.

The Sitemaps screen contains **zero submitted sitemap records**. Robots discovery
still advertises the live sitemap. The HTTPS inspection's temporary processing
error does not establish a code defect. Index status for the other four marketing
pages was not inspected. Their absence from this report is not proof of failure.

Google documents [Page with redirect](https://support.google.com/webmasters/answer/7440203#page_with_redirect)
as an exclusion of the redirect source. The destination can be indexed separately.

### CLI and API access

Commands:

```sh
gcloud auth list --format=json
gcloud config list --format=json
```

Active identity: `info@identityscaffolding.com`.
Active Cloud project: `polyak-precious--1726112956978`, name `Identity Scaffolding`.
A Cloud Resource Manager project GET returned HTTP 200 and `lifecycleState: ACTIVE`.
This confirms Cloud project read access, not Search Console authorization.

The existing CLI token has Cloud scopes, including `cloud-platform`, but lacks
`webmasters.readonly` and `webmasters`. Google's token-info endpoint confirmed
the identity and scopes. Tokens remained in process memory and were not printed.

Both requests below returned HTTP 403:

```http
GET https://www.googleapis.com/webmasters/v3/sites

POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect
Content-Type: application/json

{"inspectionUrl":"https://cadence-me.com/","siteUrl":"sc-domain:cadence-me.com","languageCode":"en-US"}
```

Relevant response fields:

```json
{
  "error": {
    "code": 403,
    "message": "Request had insufficient authentication scopes.",
    "status": "PERMISSION_DENIED",
    "details": [{"reason": "ACCESS_TOKEN_SCOPE_INSUFFICIENT"}]
  }
}
```

The Sites request identifies method `google.searchconsole.v1.SitesService.List`.
Inspection identifies `google.searchconsole.v1.InspectionTools.InspectUrlIndex`.
These failures do not indicate missing property ownership. The browser establishes
ownership independently. No OAuth grant, Cloud IAM role, or API setting changed.
Google's [Sites API](https://developers.google.com/webmaster-tools/v1/sites/list)
and [Inspection API](https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect)
document the required Search Console scopes.

## Production evidence and classification

The audit tested 46 exact starting URLs with HTTP GET, without cookies or login.
It followed HTTP Location headers manually, with eight redirects maximum.
No HTTP loop, broken redirect destination, or unintended cross-domain redirect appeared.

`M` means `https://cadence-me.com`; `A` means `https://app.cadence-me.com`.
Each path listed in a grouped row was tested individually.

| Starting URL(s) | Complete observed chain / result | Assessment |
|---|---|---|
| `http://cadence-me.com/` | 308 → `M/` → 200 | **A**, confirmed Google example; HTTPS upgrade |
| `http://cadence-me.com/about` | 308 → `M/about` → 200 | **A**, independently tested candidate |
| `http://cadence-me.com/cadence` | 308 → `M/cadence` → 200; instant HTML refresh → `M/` → 200 | **A**, independently tested candidate |
| `M/`, `M/about`, `M/faq`, `M/docs`, `M/examples` | 200 directly; each canonical equals its exact URL | No indexing defect observed |
| `M/about/`, `M/faq/`, `M/docs/`, `M/examples/` | 200 directly; canonical points to the corresponding slashless URL | Consistent duplicate consolidation; no redirect |
| `M/cadence`, `M/standard`, `M/cadence/`, `M/standard/` | 200; `refresh=0;url=/`; canonical `M/`; robots `noindex`; destination `M/` → 200 | **A**, intentional compatibility redirects; not Google-reported examples |
| `M/robots.txt`, `M/sitemap.xml` | 200 directly | Correct HTTPS sitemap reference; five canonical HTML URLs |
| `M/index.md`, `M/about.md`, `M/faq.md`, `M/docs.md`, `M/examples.md` | 200, `text/markdown`; frontmatter names canonical HTML URLs | No HTML indexing interference observed |
| `M/llms.txt`, `M/llms-full.txt`, `M/data/route-manifest.json` | 200; text/plain or application/json | No redirect or sitemap pollution |
| HTTP and HTTPS `www.cadence-me.com/` and `/about` | DNS resolution fails; curl exit 6; no HTTP response | Documented unsupported hostname; not an alert example |
| `A/` | 307 → `A/login` → 200 | **A**, intentional unauthenticated routing |
| `A/timeline`, `A/behaviors`, `A/export`, `A/settings`, `A/analytics` | 307 → `A/login?next=%2F<path>` → 200 | **A**, intentional auth protection |
| `A/login`, `A/privacy`, `A/terms`, `A/trust` | 200 directly | No canonical link or robots meta observed; no conflicting canonical established |
| `A/login/`, `A/privacy/` | 308 → corresponding slashless URL → 200 | **A**, permanent normalization |
| `http://app.cadence-me.com/` | 308 → `A/` → 307 → `A/login` → 200 | **A**, HTTPS upgrade plus auth routing |
| `http://app.cadence-me.com/privacy` | 308 → `A/privacy` → 200 | **A**, HTTPS upgrade |
| `A/robots.txt`, `A/sitemap.xml` | 404; HTML robots `noindex` | No app sitemap claimed; marketing sitemap is separate |

No tested response supplied `X-Robots-Tag`. The five canonical marketing pages
have no restrictive robots meta. Their Open Graph URLs also match their canonicals.
App public-page indexing and canonical policy remain outside the confirmed alert.

308 is permanent; 307 is temporary. The static Astro redirects are **HTTP 200
HTML refresh documents**, not HTTP 301 responses. Google treats zero-second
[meta refresh as permanent](https://developers.google.com/search/docs/crawling-indexing/301-redirects#meta-refresh).
The audit tested their homepage destination separately because curl does not follow meta refresh.

**B: none confirmed. C: none confirmed. D:** current Vercel environment-variable
readback, the temporary sitemap-processing message, and uninspected pages' Google
index status. No evidence connects those uncertainties to this alert.

## Root cause and repository audit

The confirmed exclusion comes from Vercel's HTTP-to-HTTPS upgrade, not either
Astro compatibility route. Both Vercel project domain APIs return `redirect: null`.
A null domain redirect does not disable the platform's HTTPS upgrade.
Vercel's [Encryption and TLS documentation](https://vercel.com/docs/cdn-security/encryption)
confirms that its CDN automatically forwards HTTP to HTTPS with status 308.

- `apps/marketing/astro.config.mjs:4` selects `MARKETING_SITE_URL`, with the legacy
  Vercel alias as fallback. Lines 22–24 define `/cadence` and `/standard` → `/`.
- `apps/marketing/src/data/site.ts:10` consumes Astro's `SITE` for canonical URLs.
- `apps/marketing/src/data/routes.ts:219` builds absolute canonical URLs.
  Its five route entries exclude both compatibility routes.
- `apps/marketing/src/data/agent-output.ts:84` filters the manifest into the sitemap.
  Line 106 generates permissive robots rules and the canonical sitemap reference.
- `apps/marketing/src/pages/sitemap.xml.ts` and `robots.txt.ts` expose those generators.
- `apps/marketing/src/layouts/BaseLayout.astro:16` and line 29 emit canonical metadata.
- `lib/supabase/proxy.ts:121` implements unauthenticated app redirects.
- `docs/ROUTE_MAP.md` explicitly identifies the two marketing compatibility routes.
- `docs/VERCEL_WORKFLOW.md:515` explicitly leaves `www` unconfigured.

Live HTML, Open Graph metadata, sitemap, route manifest, and Markdown frontmatter
all use `https://cadence-me.com`. The deployed output does **not** use the fallback.
Marketing HTML links use canonical destinations and do not link to `/cadence`,
`/standard`, HTTP marketing URLs, or the unsupported `www` hostname.
App CTAs target `https://app.cadence-me.com/login` directly.

Vercel readback maps the apex to `cadence-marketing` (Astro), project
`prj_BLlsxoaz1wSvWuK7xcZLLkHglQcR`; app host to `cadence` (Next.js), project
`prj_9tZKRXZ6IdT56ZLKVSmoJH5AAYhs`. Production deployment lookup by actual host
returns marketing `dpl_HfvZ63AiK3qinAKFNPzQgKAKy4vR`, source commit
`5e7ebdeb67082ebae12b41713507b027bdf726c8`, and app
`dpl_9u3Ki7ZjgCnHwGiL9FTVBGNhFt1n`. Both are READY.
The projects' latest deployment fields name different previews; those fields
were not treated as production evidence.

Read-only connector calls used `teamId: team_BxWfRYU1gqrl6Ba6t7Vm3wp1`:
`vercel_get_project`, `vercel_list_project_domains`, and
`vercel_get_deployment` with `idOrUrl` equal to each production host.
`vercel_filter_project_envs` with `decrypt:false` returned HTTP 403:
**You don't have permission to list the project environment variable.**
No installed Vercel CLI was available. Current stored environment values remain
unverified; live output and a matching local build independently establish correct canonicals.

## Reproduction and verification

Use GET rather than assuming HEAD behavior. `-L` follows HTTP redirects only:

```sh
curl -sS -L --max-redirs 8 --max-time 25 -D - -o /tmp/cadence-home.html http://cadence-me.com/
curl -sS --max-time 25 -D - https://cadence-me.com/cadence
curl -sS --max-time 25 -D - https://cadence-me.com/standard
curl -sS --max-time 25 https://cadence-me.com/sitemap.xml
curl -sS --max-time 25 https://cadence-me.com/robots.txt
curl -sS --max-time 25 -D - https://www.cadence-me.com/
```

The complete temporary evidence directory is `/tmp/cadence-indexing-20261007`:
`http-audit.py`, `http-audit.json`, numbered response headers/bodies,
`google-access.py`, sanitized `google-access.json`, and `marketing-build.log`.
Run `python3 /tmp/cadence-indexing-20261007/http-audit.py` to repeat all 46 GET chains.
Run `python3 /tmp/cadence-indexing-20261007/google-access.py` to repeat the scoped
Google probes. That script obtains the CLI token internally and never prints it.
Temporary files are local evidence, not durable production records.

Node 24.19.0 verification passed:

```sh
MARKETING_SITE_URL=https://cadence-me.com PUBLIC_CADENCE_APP_URL=https://app.cadence-me.com npm run marketing:build
MARKETING_SITE_URL=https://cadence-me.com PUBLIC_CADENCE_APP_URL=https://app.cadence-me.com npm run marketing:check
npm run test -- tests/marketing-agent-readability.test.ts tests/marketing-layout.test.ts
npm run agents:check
npm run interactions:check
```

Marketing check: 28 files, zero errors/warnings/hints; generated-output check passed.
Focused tests: two files, seven tests passed. Additional Python assertions verified
the five built sitemap URLs, HTML canonicals, robots URL, and both refresh artifacts.
Live-output assertions verified absence of the fallback marketing origin and redirect-source links.

Only this report was added. No runtime code, tests, ticket state, provider setting,
DNS record, or deployed artifact changed. Existing workspace edits were preserved.
Full application lint/typecheck/tests/build were not rerun for this investigation-only report.

## Remaining actions

None required for the October 7 alert. Preserve the HTTP-to-HTTPS redirect and
both compatibility redirects. Do not request indexing for redirect sources or
validate an intentional exclusion as a defect.

A separately authorized read-only Search Console OAuth grant would enable future
API inspections. Existing browser access already supplied the required evidence.
Additional Vercel environment access would verify stored build settings; it is
not needed to resolve this alert. Sitemap submission would require an operator's
separate instruction and is not necessary to correct the reported redirect.
