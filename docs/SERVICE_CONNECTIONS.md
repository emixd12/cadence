# Service Connections

This file documents external service connections for the project. Sections marked with service-connections-bootstrap comments are generated and may be replaced by the installer.

<!-- service-connections-bootstrap:begin cloudflare -->
## Cloudflare

Cloudflare domain management via user-owned scoped API token: DNS records, zones, Cloudflare Registrar.

- Kind: cloud-cli
- Scope tier: dns-edit
- Mutation policy: mutate_with_approval

Allowed interfaces:
- cloudflare-api verify (token check)
- cloudflare-api zones list / zone info (read)
- cloudflare-api dns list (read)
- cloudflare-api registrar list/get (read)
- cloudflare-api dns create/update/delete within the bound zone only

Required env names:
- CLOUDFLARE_API_TOKEN
- CLOUDFLARE_ACCOUNT_ID
- CLOUDFLARE_ZONE_NAME
- CLOUDFLARE_ZONE_ID

User inputs:
- [ ] In the Cloudflare dashboard -> My Profile -> API Tokens (a USER token, NOT an account token - Registrar is unsupported on account tokens), create a custom token with Zone:Read, DNS:Read, Registrar:Read for the management account (optionally restrict to specific zones and add IP filter/TTL), and stage it in .env.local as CLOUDFLARE_API_TOKEN.
- [ ] Stage CLOUDFLARE_ACCOUNT_ID (dashboard account home -> Account ID) and CLOUDFLARE_ZONE_NAME (this project's domain, e.g. example.com) in .env.local.
- [ ] Edit the same API token to add the DNS:Edit permission (zone-restricted to this project's zone, or all zones if preferred).

Preflight command: npm run cloudflare:verify

Readback command: npm run cloudflare -- dns list

Rollback/disable: Roll or delete the API token in the Cloudflare dashboard (My Profile -> API Tokens), remove CLOUDFLARE_* from .env.local, delete scripts/cloudflare-api.mjs.
<!-- service-connections-bootstrap:end cloudflare -->


## Cadence connection checkpoint (Ticket 138, 2026-09-17)

Only Cloudflare was selected for bootstrap. Existing Supabase, Vercel, GitHub,
and Sequenzy workflows remain in their established provider documents.
Cloudflare is locally configured, not linked or verified. The intended zone is
`cadence-me.com`; the account ID must come from the owner's selected account.
`CLOUDFLARE_ZONE_ID` is optional in the wrapper despite its listing in the
installer's generated environment checklist. The wrapper resolves the ID from
the account and zone name.

`services:preflight` passes local setup checks with missing-credential warnings.
`cloudflare:verify` fails with a missing-token message. The operation checker
reports matching catalog/registry tiers, available dependencies, and ignored,
untracked evidence storage. None of these results authorizes a DNS write.
The installer required expanding the equivalent `*.py[cod]` ignore pattern into
three explicit suffixes because its conservative projected-ignore parser rejects
character classes. No load-test ignore coverage changed.

Use a user-owned token restricted to this zone, with Zone:Read, DNS:Read/Edit,
and Registrar:Read. Stage values only in `.env.local`. Before a DNS change, run
`cloudflare:verify`, `cloudflare -- zone info`, and `cloudflare -- dns list`, then
plan/check the exact account, zone, and record operation. Keep readback evidence
under ignored `.agentic/runtime/`; do not commit DNS inventories or credentials.
Revoke the token in Cloudflare and remove its local values when access ends.

The existing Vercel CLI credential was used only for the owner's two exact domain
attachments and readback under `Emi's projects`. Its lifetime follows the existing
CLI login; `vercel logout` revokes that local session. No new credential was
issued. Google console inspection uses the existing Identity Scaffolding Chrome
session for `cadence-calendar-498717`, with support contact
`info@identityscaffolding.com`. The `sc-domain:cadence-me.com` property is verified
through Domain name provider (September 17, 2026; reconfirmed October 24, 2026 for
`cadence-calendar-agent-prod`); keep its TXT record. This step added no delegated
DNS access, new OAuth grant, or publishing change. The
browser session remains valid until logout/expiry; Google sign-out ends access.


The installed Cloudflare wrapper also checks an optional zone ID against the
selected account and zone name before DNS reads or writes. A local synthetic
regression verifies that a mismatched ID fails before record access. This fixes
a bootstrap shortcut that otherwise trusted the optional ID without readback.

### Dashboard route used, 2026-09-17

The owner explicitly selected signed-in Cloudflare Computer Use instead of
issuing a CLI token. The existing session inspected the empty `cadence-me.com`
zone and added the two Vercel A records plus Google's ownership TXT challenge.
Public DNS, HTTPS, and Search Console ownership passed. See
`VERCEL_WORKFLOW.md#authorized-dashboard-continuation-2026-09-17`. No API token
was created or staged; CLI credential preflight remains unlinked. Dashboard
execution does not establish CLI credentials or broaden wrapper authority.
