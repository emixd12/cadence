# Cadence mailbox acceptance — November 14, 2026

Setup: `docs/OPERATIONS.md`, "Cadence mailbox (Microsoft 365)". Owner approval:
November 14, 2026, 07:19Z. Raw headers, the DNS before-copy and Microsoft's
record list are kept locally under the git-ignored
`.agentic/runtime/mail-2026-11-14/`.

| Test | Result | Evidence |
| --- | --- | --- |
| a. AgentMail test inbox sends to `hello@`, `login@` and `support@cadence-me.com` | Pass. All three arrived in the shared mailbox Inbox (Focused), none in Junk. Sent 07:31Z, read 08:19Z | Outlook on the web, shared mailbox view |
| b. Reply from the shared mailbox to the AgentMail inbox | Pass. `From: Cadence <hello@cadence-me.com>`, `Return-Path: <hello@cadence-me.com>`; SPF pass (Microsoft outbound IP), DKIM pass `d=cadence-me.com; s=selector1`, DMARC pass | `m365-reply-headers.txt` |
| c. Sequenzy `habit-reminder` test send to AgentMail | Pass. `From: Cadence <hello@cadence-me.com>`, `Reply-To: Cadence <login@cadence-me.com>`; SPF pass (`rp2.cadence-me.com`), DKIM pass `d=cadence-me.com; s=sq1`, DMARC pass | `sequenzy-test-headers.txt` |
| c. Hosted Auth SMTP settings (read only, no change) | `smtp.sequenzy.com:587`, sender `Cadence <login@cadence-me.com>` | Supabase Management API read, 07:33Z |
| d. Sequenzy send to `support@cadence-me.com`, now an accepted domain in the tenant | Pass. Arrived in the Inbox (Focused), not Junk or quarantine. No fix needed | Outlook on the web, shared mailbox view |
| e. Public DNS | Pass on 1.1.1.1 and 8.8.8.8: MX `0 cadenceme-com01i.mail.protection.outlook.com`; SPF `v=spf1 include:spf.protection.outlook.com include:spf.sequenzydns.com ~all`; `selector1`/`selector2` CNAMEs to Microsoft; `sq1` CNAME to Sequenzy unchanged; DMARC `v=DMARC1; p=none;` | `dig +short` at 08:20Z |

Microsoft DKIM signing: the first enable at 07:31Z failed ("CNAME record does not
exist"), because Microsoft had not yet published the key records. Enabled at
08:18Z; Defender shows status Valid.

Not verified: sending as `login@` or `support@` (alias sending is off; see the
setup section); delivery to large consumer inboxes (Gmail, Outlook.com) from the
shared mailbox.
