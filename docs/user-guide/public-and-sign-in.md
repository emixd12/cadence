# Public site, account information, and sign-in

Use this guide to learn what Cadence is, inspect the BehaviorLog portability
standard, read account information, and enter the protected app.

## Explore the public marketing site

**Prerequisites:** None. The marketing site is public.

1. At the first keyboard focus, use **Skip to content** to move directly to the
   main content.
2. Use the **Cadence** brand to return to the marketing homepage.
3. In the header, use **Cadence** to return home, **Download for Mac** to
   download the current Apple Silicon preview DMG, or **Log in** to open the Cadence
   sign-in screen.
4. Use **Begin a record** to open the Cadence product entry. Use
   **Read the BehaviorLog specification** to open the BehaviorLog repository.
5. Follow contextual links such as **See how the record works**, **Open Cadence docs**,
   **Read agent docs**, or other related-content links to move to the named
   section or page.
6. Use **View on GitHub**, **View BehaviorLog repository**, or another named
   repository link to inspect the corresponding public source repository.
7. The footer provides **FAQ**, **About**, **GitHub**, **llms.txt**, **Trust**,
   **Trust evidence JSON**, **Privacy**, and **Terms**.

**Result and persistence:** Page and fragment links change only the current
location. They do not create a Cadence account or change tracker data. GitHub,
the Cadence app, and the public account-information pages may be on a different
site from the marketing page.

**Recovery or undo:** Use the browser Back action or the **Cadence** brand to
return. If an external destination is unavailable, the current page and all
Cadence data remain unchanged.

**Privacy and safety:** The public marketing site does not require personal
Behavior data. Do not enter private records into a public page or repository.

**Keyboard and mobile:** **Skip to content** is the first focusable link. Use
Tab and Shift+Tab to reach header, content, and footer links, then Enter to
activate. At larger text sizes or on a narrow screen, links may wrap; their
order and labels remain the same.

## Download Cadence for Mac

**Prerequisites:** An Apple Silicon Mac. Cadence for Mac is tested on macOS 27;
earlier versions are not tested.

1. Choose **Download for Mac** in the marketing header.
2. The browser downloads the current signed Cadence DMG. Apple has notarized it,
   so macOS opens it after its standard downloaded-app prompt, without
   **Open Anyway**.
3. Open the DMG and drag Cadence into Applications. Back up existing Cadence
   data before replacing an installed version. If you are updating from a
   preview, choose **Reconnect account** in Settings and sign in once.

**Result and persistence:** The browser stores the current Cadence DMG. Cadence
data does not change unless you install and run the desktop app. Later updates
arrive inside the app through the stable update channel.

**Recovery or undo:** Remove the downloaded DMG through the operating system if
you no longer need it.

**Privacy and safety:** The marketing button targets the signed release DMG on
the `desktop-stable` GitHub release, not an updater archive or a QA asset.

**Keyboard and mobile:** Focus **Download for Mac** and press Enter. The link
starts the same DMG download from narrow layouts.

## Download the sanitized example bundle

**Prerequisites:** A browser that allows downloads and enough local storage for
the example ZIP.

1. From the homepage, BehaviorLog page, Docs page, or Examples page, choose
   **Download Example Bundle**. The Examples page also shows the direct
   download path.
2. Confirm that the browser downloads `cadence-demo.behaviorlog.zip`.
3. Treat the archive as sample data for inspection or parser testing, not as a
   backup of your Cadence account.

**Result and persistence:** The browser stores a local `.behaviorlog.zip` file.
No account or hosted tracker data changes.

**Recovery or undo:** If the download is blocked, allow downloads for the site
or use the direct link on the Examples page. Delete the local file through the
operating system when you no longer need it.

**Privacy and safety:** The bundle is generated from sanitized demo data. Do
not mistake its example records for a real user's record.

**Keyboard and mobile:** Focus **Download Example Bundle** and press Enter. On
mobile, use the browser's download manager to find or remove the file.

## Use BehaviorLog and machine-readable resources

**Prerequisites:** None for public resources. A text editor or JSON viewer is
helpful for machine-readable files.

1. Open the marketing **Docs** page from a contextual docs link.
2. Choose **Open llms.txt** or the footer **llms.txt** link for the concise
   agent-oriented index.
3. Choose **Open route manifest** for `/data/route-manifest.json`.
4. Follow the listed links for `llms-full.txt`, Markdown mirrors such as
   `/faq.md`, or related public resources.
5. Use **Cadence**, **BehaviorLog**, the example bundle, and related Docs links
   to move between the human-readable and machine-readable explanations.

**Result and persistence:** The selected text, JSON, Markdown, or HTML resource
loads in the browser. Reading a resource does not change Cadence data.

**Recovery or undo:** Use Back or reopen the Docs page if a raw resource
replaces the current page. A missing resource produces normal browser
navigation failure only.

**Privacy and safety:** Public agent resources describe the product and contain
sanitized examples. Never infer that **Unresolved** means failure, and do not
treat the example bundle as personal data.

**Keyboard and mobile:** All resources are normal links and work with Tab plus
Enter. Raw text and JSON may require horizontal scrolling in some mobile
browsers; browser Find can locate a route or key without pointer input.

## Read account information

**Prerequisites:** None. **Terms**, **Privacy**, and **Trust** are public and can
be opened before sign-in or from Settings after sign-in.

1. On the sign-in screen, choose **Terms**, **Privacy**, or **Trust**.
2. On any of those pages, use the top legal navigation to switch between
   **Privacy**, **Terms**, and **Trust**. The current page is marked as current.
3. On **Trust**, review the named status, verification time, freshness deadline,
   scope, and limit for each check. Choose an **Open immutable evidence** link
   to inspect the public evidence behind that check. The machine-readable view
   is available at `/api/public/trust-evidence`.
4. At the bottom, choose **Cadence overview**, **Sign in**, or
   **Open settings**:
   - **Cadence overview** returns to the public product explanation.
   - **Sign in** opens the login screen.
   - **Open settings** opens Settings when a valid session exists; otherwise
     Cadence routes through sign-in.

**Result and persistence:** These links change pages only. Reading them does
not create an account or update product data.

**Recovery or undo:** Use the legal navigation, browser Back, or
**Cadence overview**. If a protected destination requires authentication,
sign-in preserves the intended protected destination when supported.

**Privacy and safety:** Read Privacy before putting sensitive text into Behavior
descriptions or Occurrence Notes. Trust explains durable commitments separately
from bounded, time-specific verification. A Passed check is not a certification
or a claim that defects are absent. Terms explains that Cadence is not an
emergency, clinical decision, medication dosing, refill, or two-way Calendar
sync system. Optional Google Calendar context is read-only and requires separate
consent when the deployment enables it.

**Keyboard and mobile:** Legal links are ordinary focusable links with a
current-page state that does not depend on color alone. At 200% zoom, allow
navigation rows to wrap and continue in document order.

## Sign in with Google

**Prerequisites:** Cadence must show an enabled **Continue with Google** action,
and you need a Google account you are authorized to use. Provider-owned Google
screens are outside Cadence.

1. On `/login`, review **Terms**, **Privacy**, and **Trust** if needed.
2. Choose **Continue with Google**.
3. Complete the Google account and consent flow.
4. After Google returns to Cadence, confirm that the protected app opens. The
   usual destination is **Timeline**; a safe protected destination requested
   before sign-in may be restored.

**Result and persistence:** Supabase Auth creates a signed-in browser session.
For a first-time account, Cadence creates the profile data needed by the app.
The session remains available according to the browser and authentication
session policy. This sign-in does not grant Google Calendar access. Calendar
uses a separate consent flow in Settings and requires the same Google identity.

**Recovery or undo:** If Cadence returns to `/login`, read the displayed error
and choose **Continue with Google** again. A failed exchange does not expose
provider details or create partial Behavior data. If the button is disabled
with a configuration message in a local environment, the runtime must be
configured before sign-in can work.

**Privacy and safety:** Verify the Google account before completing sign-in,
especially on a shared device. Cadence receives the account identity needed for
authentication; its public Privacy page lists stored product and provider data.

**Keyboard and mobile:** Focus **Continue with Google** and press Enter. After
the external provider returns, focus begins in the Cadence page normally. If
you use browser zoom or a screen magnifier, confirm the account shown by Google
before continuing.

## Developer documentation

Choose Developers in the marketing footer, or Developer documentation in Settings → Connected apps. The public guides explain MCP setup, permissions and every tool. Use the documentation navigation, On this page links, and Previous/Next links to browse. Read Markdown opens the same page without navigation. Copy code copies an example; if copying fails, select the code manually. Local examples use synthetic records. Hosted launch and directory approval remain pending.
