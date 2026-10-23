# Weather provider comparison for Ticket 218

Recommendation for the owner's decision: Open-Meteo's API Standard plan (US$29 per
month). Its CC BY 4.0 data licence clearly allows the three uses Tickets 218–219 need:
caching one forecast per area per hour, sharing it across users, and sending derived
facts to the Daily Brief model. Apple WeatherKit is the free alternative if Apple
confirms its caching terms. The National Weather Service is free and public domain
but covers only the United States. The Google Weather API is the cheapest paid option,
but it needs a Google coordinate for each stop and its terms create the largest risk
for model input. The owner selects the provider. This file chooses nothing.

Owner decision, October 18, 2026: Open-Meteo is the provider (`docs/DECISIONS.md`).
The open legal questions moved to [`docs/LEGAL.md`](../LEGAL.md). Corrections made
the same day: Cadence holds no Google coordinates today, and the Google Weather API
needs a coordinate for each stop.

Research date: October 17, 2026. No provider account was created and no paid call
was made. One free, unauthenticated National Weather Service request per point
confirmed its coverage: a London point returned 404 "Data Unavailable For Requested
Point"; a Chicago point returned 200.

Method: this session read each pricing page, terms page and licence in full, except
the Apple Developer Program License Agreement (about 620,000 characters). For that
agreement the session read Attachment 8 (WeatherKit) in full, the WeatherKit
definitions, Section 3.2 and every clause that mentions artificial intelligence or
model training. Legal readings below are the session's interpretation, not legal
advice.

## Expected volume

The design sends one request per coarse area per clock hour, on demand, and shares the
result across users. A request returns an hourly forecast for at least the rest of the
day. The counts below use the `docs/COSTS.md` user profiles. All figures are assumed.

| Assumption per user per month | Light | Typical | Heavy |
| --- | --- | --- | --- |
| Daily Briefs × coarse areas per brief | 15 × 1.5 | 30 × 2 | 60 × 3 |
| Travel days × hours with a Timeline estimate × areas | 8 × 2 × 1 | 20 × 4 × 1.5 | 26 × 6 × 2 |
| **Area-hour requests before sharing** | **about 40** | **about 180** | **about 490** |

| Scenario | Requests per month | Requests per day |
| --- | --- | --- |
| 100 typical users | about 18,000 | about 600 |
| 1,000 typical users | about 180,000 | about 6,000 |
| 100 heavy users (sensitivity) | about 49,000 | about 1,630 |
| 1,000 heavy users (sensitivity) | about 490,000 | about 16,300 |

Sharing can only lower these counts. The ceiling is distinct areas × active hours ×
30 days. For example, 1,000 users in 250 coarse areas, active 16 hours a day, need at
most 120,000 requests a month. At 100 users spread across many cities, sharing saves
little. The cost table therefore uses the no-sharing figures as an upper bound.

Assumed area size: coordinates rounded to 0.1° (about 11 km north–south). Ticket 218
implementation sets the real size. Weather models run at 1–11 km, so a coarser area
loses little accuracy.

## Comparison: price, coverage and resolution

| Provider | 100 typical users | 1,000 typical users | Heavy sensitivity (100 / 1,000) | Coverage outside the US | Hourly forecast |
| --- | --- | --- | --- | --- | --- |
| National Weather Service (api.weather.gov) | US$0 | US$0 | US$0 / US$0 | None. US states and territories only | 7 days, 2.5 km grid |
| Google Weather API | US$1.20 | US$23.10 | US$5.85 / US$60.30 | Global except China, Cuba, Iran, Japan, North Korea, South Korea, Syria, Vietnam | Up to 240 hours; "within a few kilometers" |
| Open-Meteo, API Standard | US$29 flat | US$29 flat | US$29 / US$29 | Global | 16 days; 1–2 km in North America, Central Europe, France, Switzerland, UK; 9–11 km elsewhere |
| Open-Meteo, free tier | US$0, non-commercial only | US$0, non-commercial only | US$0 / exceeds 10,000 per day | Global | Same |
| Apple WeatherKit (REST) | US$0 marginal | US$0 marginal | US$0 / US$0 (just under 500,000) | Global; no published country list; per-location availability endpoint | 10 days (240 hours) |
| Tomorrow.io | Not available: free plan allows 500 per day and bars commercial use | Contact sales; no public price | Contact sales | Global | 120 hours |
| OpenWeather One Call 4.0 | US$0 (under 1,000 per day) | US$225 | US$28.50 / US$690 | Global, any coordinates | 48 hours (15-minute steps also 48 hours) |
| MET Norway Locationforecast | US$0 | US$0 | US$0 / US$0 | Global; 9 km outside the Nordic and Arctic areas | Hourly in the short range (0–60 hours in the Nordic area), then 6-hourly to 10 days. Outside the Nordic area, hourly precipitation has amount only, no probability |

Price notes:

- Google: 10,000 free events per month for the Weather Usage SKU, then US$0.15 per
  1,000 up to 100,000 and US$0.12 per 1,000 up to 500,000. Assumed: one request for a
  24-hour page is one billable event. The billing page does not define the event.
- Open-Meteo: Standard covers 1 million calls per month; Professional is US$99 for
  5 million. The Stripe pricing table showed US dollars; the currency may vary by
  region. A request with up to 10 variables and up to two weeks counts as one call.
- WeatherKit: the Apple Developer Program membership (US$99 per year, already a fixed
  cost in `docs/COSTS.md`) includes 500,000 calls per month. The next tier is
  US$49.99 per month for 1 million.
- OpenWeather: the first 1,000 One Call requests per day are free; each additional
  request costs US$0.0015. The Developer subscription (US$180 per month) is the
  cheapest fixed plan with a 4-day hourly forecast.
- Per user at 1,000 typical users: Google about US$0.02, Open-Meteo about US$0.03,
  OpenWeather about US$0.23. At 100 users Open-Meteo's flat fee is US$0.29 per user.

## Comparison: terms

IDs such as L-002 refer to entries in [`docs/LEGAL.md`](../LEGAL.md).

| Provider | Attribution | Cache one forecast per area per hour and share it across users | Derived facts, such as "rain expected before 3 PM", in OpenAI input | Area derived from a Google-geocoded coordinate |
| --- | --- | --- | --- | --- |
| National Weather Service | Not required. Do not claim the data, imply NWS endorsement, or present modified content as official. The NWS name and logo are trademarks | Allowed. Public domain; the API is built to be cached | Allowed. The brief must not read as official NWS material | Provider terms: no limit. Google terms: not expressly permitted (L-002) |
| Google Weather API | "Includes data from Google Maps" for derived content; Google Maps logo or text for unmodified data; "Source: Includes weather data from Google" also appears in the policy | Allowed for at most one hour for hourly forecast values, then delete. Section 21 has no per-user isolation rule. Sharing is probably allowed (L-005) | Unclear, highest risk (L-004). Conflicts with the owner's model-input regime (L-001). Model testing with real data is prohibited | Needs a coordinate per stop. Cadence holds none today, so it would first fetch Google coordinates; they then stay inside Google services |
| Open-Meteo | CC BY 4.0: credit, licence link, note changes; a "Weather data by Open-Meteo.com" link next to any displayed data | Allowed. CC BY 4.0 permits copying and redistribution | Allowed with attribution | Provider terms: no limit. Google terms: not expressly permitted (L-002) |
| Apple WeatherKit | Apple Weather mark and the legal link to other data sources; for transformed data, "Weather" plus a notice that Apple's data was modified | Unclear (L-006). Caching only "on a temporary and limited basis solely to improve the performance"; no "secondary or derived database" | Probably allowed for transformed data shown to users; sending it to a third-party model is not addressed (L-007) | Provider terms: no limit. Google terms: not expressly permitted (L-002) |
| Tomorrow.io | "Powered by Tomorrow.io", linked, near the data or anything derived from it | Not allowed without a negotiated order: the terms bar storing unaltered data and bar commercial use on self-serve accounts | Depends on the negotiated order; the terms bar redistribution | Provider terms: no limit. Google terms: not expressly permitted (L-002) |
| OpenWeather | "Weather data provided by OpenWeather", a link and the logo, for Free through Professional plans | Allowed. Data under ODbL; products under CC BY-SA 4.0 | Allowed with attribution; share-alike scope unclear (L-009) | Provider terms: no limit. Google terms: not expressly permitted (L-002) |
| MET Norway | CC BY 4.0, for example "Data from MET Norway", licence link, note changes | Allowed and requested: cache responses and call through a server proxy | Allowed with attribution | Provider terms: no limit. Google terms: not expressly permitted (L-002) |

## Provider notes

### National Weather Service

- The API page states all data is "open data, free to use for any purpose" and that
  NWS charges no fees. An undisclosed rate limit applies; "proxies are more likely to
  reach the limit". A server-side cache is a proxy in this sense.
- Each request needs an identifying User-Agent. NWS says an API key will replace it in
  the future.
- A forecast takes two calls: `/points/{lat},{lon}` maps a point to a 2.5 km grid
  cell, then `/gridpoints/{office}/{x},{y}/forecast/hourly`. The points response
  carried a 13–24 hour cache header; NWS says grid mappings occasionally change.
- The NWS grid cell is a natural shared cache key.
- Users outside the US would get no weather. Choosing NWS means either US-only
  weather or a second provider for other countries.

### Google Weather API

- Service Specific Terms section 21.1 bars using Weather API data to recreate a
  Google product, such as a weather app. A travel margin is not a weather app.
- Section 21.2 caching limits: current conditions and hourly forecast values one
  hour; daily forecast values 24 hours; "Today's Forecast values" 30 days.
- The default rate limit is 6,000 queries per minute. Billing must be enabled.
- Maps Platform Terms section 4.4(a) lets Google use and retain the coordinates it
  receives. Section 4.4(c)(iii) requires telling users in advance about "the
  combination and use of End User's location with any other data provider's data".
  That notice applies to Cadence's existing Routes use whichever weather provider is
  chosen.
- The Weather API takes latitude and longitude, not place IDs. Cadence stores place IDs
  only, so choosing Google means first fetching coordinates for each stop and keeping
  them for at most 30 days (Service Specific Terms 6.3.1). The coordinates then stay
  inside Google services, so the question in the next section does not arise.
- Under the owner's October 18 model-input regime (`docs/LEGAL.md` L-001), Google
  forecast facts would be Google content in model input. The Google Weather API
  therefore conflicts with that regime.

### Open-Meteo

- The free tier is limited to non-commercial use, 10,000 calls per day, 5,000 per hour
  and 300,000 per month. The terms define commercial use to include apps "that have
  subscriptions or display advertisements" and "Integrating our service into commercial
  products". Cadence has no subscription today, but the owner's US$5 per user price
  goal points to one (L-008).
- Paid plans use a separate endpoint and API key. Monthly limits are not enforced yet;
  Open-Meteo sends email alerts at 80%, 90% and 100%.
- Privacy: free-tier web server logs may contain coordinates and are deleted after 90
  days. Paid-plan logs are deleted after 90 days, leaving aggregated counts.
- The server code is AGPLv3. Self-hosting is a fallback if prices or availability
  change.

### Apple WeatherKit

- The REST API works for websites and servers. It needs a Service ID and a signing key
  from the existing Apple Developer membership. Creating them is a provider
  configuration step that needs the owner's authorization.
- Attachment 8 section 1.2 allows "Value-Added Services or Products" that transform the
  data so no one can recover the original. A travel margin and a brief sentence fit
  that description.
- Section 1.3 bars apps "designed or marketed for emergency or life-saving purposes".
  Section 2.2 requires a specific end-user notice for "real-time weather guidance";
  whether a departure margin counts is unclear.
- The weather service stops if the Apple Developer membership lapses.

### Tomorrow.io

- The Subscription Terms (last updated October 19, 2023) say "Commercial use is strictly
  prohibited" on self-generated accounts. Commercial applications need an order and an
  end-user agreement naming Tomorrow.io as a third-party beneficiary.
- The free plan allows 500 requests per day and 25 per hour. About 100 typical users
  would exceed both.

### OpenWeather

- One Call 3.0 is deprecated; One Call 4.0 replaces it. The default daily cap is 2,000
  calls and is adjustable, which works as a spending limit.
- Terms of sale: products under CC BY-SA 4.0, data and database under ODbL.

### MET Norway

- Free, no account, commercial use allowed under NLOD 2.0 and CC BY 4.0.
- The terms require an identifying User-Agent, at most four decimals in coordinates,
  respect for cache headers, and no more than 20 requests per second per application.
- There is no delivery guarantee and no SLA.

## Google-geocoded coordinates

Correction, October 18, 2026: Cadence holds no Google coordinates today. It stores
place IDs only. The hosted geocode request asks only for place ID, granularity and
types; routes are requested by place ID; the only coordinates in the system come from
the device (`docs/LEGAL.md` L-002). The question below arises only if Cadence starts
fetching Google coordinates.

Coordinates from Google Maps Platform are Google Maps Content. No term expressly
permits sending them, rounded or not, to another provider:

- Maps Platform Terms 3.2.3(a): "Customer will not export, extract, or otherwise scrape
  Google Maps Content for use outside the Services", including to "store, reshare, or
  rehost" it outside the services.
- 3.2.3(c): "Customer will not create content based on Google Maps Content." One
  example prohibits using Places API coordinates "as an input for point-in-polygon
  analysis". Assigning a coordinate to a coarse grid cell is a close analogue.
- Service Specific Terms 6.3 lets Cadence cache Geocoding coordinates for 30 days. It
  grants no right to use them with another service.

Conservative reading: with a non-Google provider, derive the area from the device
position only, as Ticket 218 already allows. Weather then covers the user's current
area. Legs that start from another stop use the current area as a proxy or show no
weather. Other routes, each with a cost: ask Google in writing (L-002), choose the
Google Weather API (which first needs a coordinate fetch for each stop), or geocode the
typed place text with a non-Google geocoder (this sends typed place text to another
provider and needs a privacy disclosure).

Cadence reads the device position from the browser or the operating system, not from a
Google Maps Platform API. Sending its coarse area to any provider raises no Google
terms question.

## Recommendation and reasons

Recommended: Open-Meteo API Standard, with the area derived from the device position
while L-002 stays open.

1. Its licence clearly permits all three planned uses: a one-hour cache, sharing
   across users and derived facts in model input. No other paid option is clear on all
   three.
2. It covers the whole world with hourly steps, and uses 1–2 km models in North America
   and much of Europe.
3. The flat US$29 covers even 1,000 heavy users with room to spare. There is no
   per-call bill to monitor.
4. The open-source server gives a self-hosting fallback.
5. Server-side calls keep user IP addresses away from the provider; logs expire after
   90 days.

Costs of this choice: fixed costs in `docs/COSTS.md` rise from about US$54 to about
US$83 per month. At 10 users that is US$2.90 per user for weather alone. Weather at
other stops waits on L-002.

Alternatives the owner may prefer:

- **Apple WeatherKit** if Apple confirms L-006 and L-007. It adds no cost up to
  500,000 calls per month and covers the world for 10 days. Its caching wording is the
  most restrictive of the free options.
- **National Weather Service** if US-only weather is acceptable at first. It is free
  and public domain, so it has no open licence question. It could also serve as a free
  US source next to another provider, at the cost of two adapters.
- **Google Weather API** if weather at every stop matters more than model input. It is
  the cheapest paid option. It needs a Google coordinate for each stop, which Cadence
  does not fetch today; the coordinate then stays inside Google. Its forecast facts
  would be Google content in model input, which conflicts with the L-001 regime, and
  the cache must expire after one hour.
- Tomorrow.io, OpenWeather and MET Norway are weaker fits. Tomorrow.io needs a
  negotiated contract with unknown price. OpenWeather costs about US$225 per month at
  1,000 users and forecasts only 48 hours hourly. MET Norway is free and permissive but
  has no SLA and, outside the Nordic area, no hourly precipitation probability.

## Open legal questions

The nine questions moved to [`docs/LEGAL.md`](../LEGAL.md) on October 18, 2026.
Question 1 (Google coordinates) is part of L-002. Questions 2–9 are L-004 to L-011.

Assumed, not verified: the owner's Google Maps billing address is outside the European
Economic Area. An EEA address would bring different Maps terms.

## After the provider selection

- Done October 18, 2026: the choice is in `docs/DECISIONS.md` and the provider row is
  in `docs/COSTS.md`, as Ticket 218 requires.
- Before implementation, the owner confirms the plan (`docs/LEGAL.md` L-008) and the
  privacy and attribution content (L-011). Update, October 22, 2026: the owner chose
  the free plan for development and testing and requires API Standard before
  commercial use (L-008 stays open until Cadence subscribes). L-011 moved to
  `docs/PRIVACY_CHANGES.md` P-003 and does not block development.
- Ticket 218 keeps the boundaries above: a hosted adapter in `lib/services`, weather
  rules in `packages/core`, one shared forecast per area per hour, no per-user
  forecast storage.

## Sources

All checked October 17, 2026.

National Weather Service:
- [API Web Service documentation](https://www.weather.gov/documentation/services-web-api)
- [Disclaimer and use of NOAA/NWS data](https://www.weather.gov/disclaimer)
- Coverage check: `https://api.weather.gov/points/51.5,-0.12` (404) and
  `https://api.weather.gov/points/41.88,-87.63` (200)

Google Maps Platform:
- [Weather API overview](https://developers.google.com/maps/documentation/weather/overview)
- [Weather API usage and billing](https://developers.google.com/maps/documentation/weather/usage-and-billing)
- [Core services pricing list](https://developers.google.com/maps/billing-and-pricing/pricing)
- [Weather API policies and attributions](https://developers.google.com/maps/documentation/weather/policies)
- [Weather API supported countries](https://developers.google.com/maps/documentation/weather/coverage)
- [Weather API FAQ](https://developers.google.com/maps/documentation/weather/faq)
- [Get hourly forecast](https://developers.google.com/maps/documentation/weather/hourly-forecast)
- [Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms), last
  modified August 26, 2026
- [Maps Platform Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms),
  last modified October 15, 2026
- [Geocoding API policies](https://developers.google.com/maps/documentation/geocoding/policies)

Open-Meteo:
- [Pricing](https://open-meteo.com/en/pricing)
- [Terms and privacy](https://open-meteo.com/en/terms)
- [Licence](https://open-meteo.com/en/licence)
- [Features](https://open-meteo.com/en/features)

Apple WeatherKit:
- [WeatherKit overview, pricing and attribution](https://developer.apple.com/weatherkit/)
- [Apple Developer Program License Agreement](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/):
  Attachment 8, Attachment 9, definitions and Section 3.2
- [WeatherKit REST API weather endpoint](https://developer.apple.com/documentation/weatherkitrestapi/get-api-v1-weather-_language_-_latitude_-_longitude_)

Tomorrow.io:
- [Weather API](https://www.tomorrow.io/weather-api/)
- [Pricing overview](https://support.tomorrow.io/hc/en-us/articles/23554984091156-Tomorrow-io-Pricing-Overview)
- [Free API plan rate limits](https://support.tomorrow.io/hc/en-us/articles/20273728362644-Free-API-Plan-Rate-Limits)
- [Subscription Terms](https://www.tomorrow.io/legal/terms-of-service/)
- [Data sources and attribution](https://www.tomorrow.io/legal/data-source-attribution/)
- [Weather forecast endpoint](https://docs.tomorrow.io/reference/weather-forecast)

OpenWeather:
- [Pricing](https://openweathermap.org/price)
- [FAQ](https://openweathermap.org/faq)
- [Terms and conditions of sale](https://openweather.co.uk/api/files/file/OpenWeather_T%26C_of_sale.pdf)
- [Website terms and conditions of use](https://openweather.co.uk/api/files/file/Openweather_website_terms_and_conditions_of_use.pdf)

MET Norway:
- [Terms of Service](https://docs.api.met.no/doc/TermsOfService)
- [Licensing and data policy](https://docs.api.met.no/doc/License)
- [Locationforecast data model](https://docs.api.met.no/doc/locationforecast/datamodel)

OpenAI:
- [Data controls in the OpenAI platform](https://platform.openai.com/docs/guides/your-data)
