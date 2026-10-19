import { ProviderCallTimeoutError, runProviderCallWithTimeout } from "@/lib/services/provider-call-timeout";
import type { ExternalEventErrorCode, ExternalEventFailure } from "@cadence/core/types/external-event";

// Ticket 227 CalDAV transport for iCloud Calendar. It is the only code that sends
// Apple login values. Rules enforced here:
// - Methods: PROPFIND and REPORT only. Every other method throws before fetch.
// - Hosts: the fixed HTTPS initial endpoint and HTTPS hosts under icloud.com on
//   the default port, with no userinfo. Every href and redirect target is vetted
//   before the Authorization header is attached.
// - Redirects: followed manually, at most three hops, never to another domain,
//   never to HTTP, never in a loop, and never with a method change (303).
// - Deadline: one absolute deadline across every request, hop, retry, and body.
//   Each attempt is capped at 10 s or the remaining time; a response finishing
//   after the deadline is discarded as `timeout`.
// - Bodies: 5 MB per response, streamed and cancelled at the limit.
// - XML: a strict namespace-aware subset. DOCTYPE, entity declarations, and
//   processing instructions are refused, so no entity or network expansion exists.

export const ICLOUD_CALDAV_ENDPOINT = "https://caldav.icloud.com/";
export const ICLOUD_READ_DEADLINE_MS = 25_000;
export const ICLOUD_MAX_RESPONSE_BYTES = 5_000_000;
const ATTEMPT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const MAX_REDIRECTS = 3;
const MAX_BACKOFF_MS = 5_000;
const MAX_HREF_LENGTH = 2_048;
const ALLOWED_METHODS = new Set(["PROPFIND", "REPORT"]);

export const DAV_NS = "DAV:";
export const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";

export type IcloudCalDavMethod = "PROPFIND" | "REPORT";
export type IcloudFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type IcloudLogin = Readonly<{ appleId: string; appPassword: string }>;

/** Shared controls. `deadlineAt` is an absolute clock value from `now`. */
export type IcloudRequestOptions = Readonly<{
  login: IcloudLogin;
  deadlineAt: number;
  now?: () => number;
  fetch?: IcloudFetch;
  signal?: AbortSignal;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}>;

export class IcloudCalendarProviderError extends Error {
  constructor(public readonly failure: ExternalEventFailure) {
    super(failure.message);
    this.name = "IcloudCalendarProviderError";
  }
}

export function icloudFailure(code: ExternalEventErrorCode, calendarId: string | null, retryable: boolean, retryAfterSeconds: number | null,
  message: string): ExternalEventFailure {
  return { code, calendarId, retryable, retryAfterSeconds, message };
}

/** Throws for any method other than PROPFIND or REPORT. Writes are impossible through this module. */
export function assertIcloudCalDavMethod(method: string): asserts method is IcloudCalDavMethod {
  if (!ALLOWED_METHODS.has(method)) throw new TypeError(`iCloud Calendar refuses the ${method} method.`);
}

/** True for HTTPS hosts under icloud.com (for example caldav.icloud.com or p12-caldav.icloud.com). */
function vettedHost(hostname: string): boolean {
  if (hostname.length > 253 || !hostname.endsWith(".icloud.com")) return false;
  return hostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

/**
 * Resolves a provider href or redirect target against `base` and returns it only
 * when it is HTTPS on a vetted icloud.com host, the default port, no userinfo,
 * no fragment, and a bounded path. Returns null otherwise.
 */
export function icloudCalDavUrlAllowed(value: string, base: URL | string = ICLOUD_CALDAV_ENDPOINT): URL | null {
  if (typeof value !== "string" || !value || value.length > MAX_HREF_LENGTH || /[\u0000- \u007f\\]/.test(value)) return null;
  let url: URL;
  try { url = new URL(value, base); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.hash || url.search) return null;
  if (!vettedHost(url.hostname) || url.pathname.length > MAX_HREF_LENGTH || !url.pathname.startsWith("/")) return null;
  url.port = "";
  return url;
}

/** Same resource identity: vetted origin plus path. */
export function icloudUrlKey(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

function basicAuthorization(login: IcloudLogin): string {
  return `Basic ${Buffer.from(`${login.appleId}:${login.appPassword}`, "utf8").toString("base64")}`;
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => { clearTimeout(timeout); reject(signal.reason); }, { once: true });
  });
}

function retryAfter(value: string | null): number | null {
  return value && /^\d{1,6}$/.test(value) ? Number(value) : null;
}

class BodyError extends Error {}

async function readBoundedText(response: Response, signal: AbortSignal): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > ICLOUD_MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new BodyError("too_large");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new BodyError("empty");
  signal.addEventListener("abort", () => { void reader.cancel().catch(() => undefined); }, { once: true });
  const chunks: Uint8Array[] = []; let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > ICLOUD_MAX_RESPONSE_BYTES) { await reader.cancel().catch(() => undefined); throw new BodyError("too_large"); }
    chunks.push(value);
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw new BodyError("encoding"); }
}

export function icloudHttpFailure(status: number, calendarId: string | null, seconds: number | null): ExternalEventFailure {
  if (status === 401) return icloudFailure("reconnect_required", calendarId, false, null, "iCloud Calendar did not accept the app-specific password.");
  if (status === 403) return icloudFailure("permission_denied", calendarId, false, null, "iCloud Calendar denied the read.");
  if (status === 429) return icloudFailure("rate_limited", calendarId, true, seconds, "iCloud Calendar rate limited the read.");
  if (status === 507) return icloudFailure("incomplete_pagination", calendarId, false, null, "iCloud Calendar returned truncated results.");
  if (status >= 500) return icloudFailure("provider_unavailable", calendarId, true, seconds, "iCloud Calendar is unavailable.");
  if (status === 400) return icloudFailure("invalid_request", calendarId, false, null, "iCloud Calendar rejected the bounded read.");
  return icloudFailure("provider_unavailable", calendarId, false, null, "iCloud Calendar could not read this resource.");
}

type AttemptOutcome =
  | Readonly<{ ok: true; body: string; url: URL }>
  | Readonly<{ ok: false; failure: ExternalEventFailure }>;

/**
 * One allowlisted CalDAV request with the shared deadline rule. Redirects are
 * followed inside the attempt and every target is vetted before credentials are
 * sent. Returns the 207 multistatus body and the final URL.
 */
export async function icloudCalDavRequest(input: Readonly<{
  method: string;
  url: URL;
  depth: "0" | "1";
  body: string;
  calendarId: string | null;
}>, options: IcloudRequestOptions): Promise<Readonly<{ body: string; url: URL }>> {
  assertIcloudCalDavMethod(input.method);
  const method = input.method;
  const initial = icloudCalDavUrlAllowed(input.url.toString());
  if (!initial) throw new IcloudCalendarProviderError(icloudFailure("malformed_provider_response", input.calendarId, false, null, "iCloud Calendar URL is outside icloud.com."));
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? wait;
  const random = options.random ?? Math.random;
  const timeout = (retryAfterSeconds: number | null = null) =>
    new IcloudCalendarProviderError(icloudFailure("timeout", input.calendarId, true, retryAfterSeconds, "iCloud Calendar read deadline ended."));
  let last: ExternalEventFailure = icloudFailure("timeout", input.calendarId, true, null, "iCloud Calendar read deadline ended.");
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const remaining = options.deadlineAt - now();
    if (remaining <= 0 || options.signal?.aborted) throw timeout(last.retryAfterSeconds);
    const attemptMs = Math.min(ATTEMPT_TIMEOUT_MS, remaining);
    const signal = AbortSignal.any([AbortSignal.timeout(attemptMs), ...(options.signal ? [options.signal] : [])]);
    let outcome: AttemptOutcome | null = null;
    let retryAfterSeconds: number | null = null;
    try {
      outcome = await runProviderCallWithTimeout(async (attemptSignal) => {
        let url = initial;
        const seen = new Set<string>([icloudUrlKey(url)]);
        for (let hop = 0; ; hop += 1) {
          const response = await (options.fetch ?? fetch)(url, { method, cache: "no-store", redirect: "manual", signal: attemptSignal,
            headers: { Authorization: basicAuthorization(options.login), Depth: input.depth, Accept: "application/xml, text/xml",
              "Content-Type": "application/xml; charset=utf-8" }, body: input.body });
          if (response.status >= 300 && response.status < 400) {
            void response.body?.cancel().catch(() => undefined);
            if (response.status === 303 || response.status === 304 || hop >= MAX_REDIRECTS) {
              return { ok: false as const, failure: icloudFailure("provider_unavailable", input.calendarId, false, null, "iCloud Calendar redirected too many times.") };
            }
            const location = response.headers.get("location");
            const next = location ? icloudCalDavUrlAllowed(location, url) : null;
            if (!next) return { ok: false as const, failure: icloudFailure("malformed_provider_response", input.calendarId, false, null, "iCloud Calendar redirected outside icloud.com.") };
            if (seen.has(icloudUrlKey(next))) return { ok: false as const, failure: icloudFailure("provider_unavailable", input.calendarId, false, null, "iCloud Calendar redirect loop.") };
            seen.add(icloudUrlKey(next));
            url = next;
            continue;
          }
          if (response.status !== 207) {
            void response.body?.cancel().catch(() => undefined);
            retryAfterSeconds = retryAfter(response.headers.get("retry-after"));
            return { ok: false as const, failure: icloudHttpFailure(response.status, input.calendarId, retryAfterSeconds) };
          }
          const type = response.headers.get("content-type");
          if (type && !/^(?:application|text)\/xml\b/i.test(type)) {
            void response.body?.cancel().catch(() => undefined);
            return { ok: false as const, failure: icloudFailure("malformed_provider_response", input.calendarId, false, null, "iCloud Calendar returned a non-XML response.") };
          }
          return { ok: true as const, body: await readBoundedText(response, attemptSignal), url };
        }
      }, { timeoutMs: attemptMs, signal });
    } catch (error) {
      if (error instanceof BodyError && error.message === "too_large") {
        throw new IcloudCalendarProviderError(icloudFailure("incomplete_pagination", input.calendarId, false, null, "iCloud Calendar response exceeded the size limit."));
      }
      if (error instanceof BodyError) throw new IcloudCalendarProviderError(icloudFailure("malformed_provider_response", input.calendarId, false, null, "iCloud Calendar returned an unreadable body."));
      if (error instanceof ProviderCallTimeoutError || signal.aborted) last = icloudFailure("timeout", input.calendarId, true, null, "iCloud Calendar request timed out.");
      else last = icloudFailure("provider_unavailable", input.calendarId, true, null, "iCloud Calendar request failed.");
    }
    // A response that completes after the absolute deadline is discarded.
    if (now() >= options.deadlineAt) throw timeout(retryAfterSeconds);
    if (outcome?.ok) return { body: outcome.body, url: outcome.url };
    if (outcome) last = outcome.failure;
    if (!last.retryable || attempt === MAX_RETRIES) break;
    const delay = last.retryAfterSeconds !== null ? last.retryAfterSeconds * 1_000 + 1_000
      : Math.min(MAX_BACKOFF_MS, 250 * (2 ** attempt) + Math.floor(random() * 100));
    // Retry-After that does not fit before the deadline stops the read with its value.
    if (now() + delay >= options.deadlineAt) break;
    try { await sleep(last.retryAfterSeconds !== null ? last.retryAfterSeconds * 1_000 : delay, options.signal); }
    catch { throw timeout(); }
  }
  throw new IcloudCalendarProviderError(last);
}

// ---------------------------------------------------------------------------
// Strict XML subset
// ---------------------------------------------------------------------------

/** Unprefixed attributes only (they carry no namespace); namespace declarations are excluded. */
export type XmlElement = Readonly<{ ns: string; name: string; attributes: Readonly<Record<string, string>>; children: XmlElement[]; text: string }>;
export class IcloudXmlError extends Error {
  constructor(public readonly kind: "malformed" | "truncated", message: string) { super(message); this.name = "IcloudXmlError"; }
}

const MAX_XML_DEPTH = 64;
const MAX_XML_ELEMENTS = 200_000;
const MAX_XML_ATTRIBUTES = 32;
const NAME = /^[A-Za-z_][A-Za-z0-9._-]*(?::[A-Za-z_][A-Za-z0-9._-]*)?$/;

function decodeEntities(value: string): string {
  return value.replace(/&([^;&\s]{1,12});|&/g, (match, entity: string | undefined) => {
    if (!entity) throw new IcloudXmlError("malformed", "bare ampersand");
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "amp") return "&";
    if (entity === "quot") return "\"";
    if (entity === "apos") return "'";
    const numeric = /^#(?:x([0-9a-fA-F]{1,6})|([0-9]{1,7}))$/.exec(entity);
    if (!numeric) throw new IcloudXmlError("malformed", "undeclared entity");
    const code = numeric[1] ? Number.parseInt(numeric[1], 16) : Number(numeric[2]);
    const legal = code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
    if (!legal) throw new IcloudXmlError("malformed", "illegal character reference");
    return String.fromCodePoint(code);
  });
}

type OpenElement = { prefix: string; local: string; qname: string; scope: Map<string, string>; attributes: Record<string, string>; children: XmlElement[]; text: string[] };

/**
 * Parses one XML document into namespace-resolved elements. Refuses DOCTYPE,
 * entity declarations, processing instructions other than the leading XML
 * declaration, undeclared prefixes, mismatched tags, and content outside the
 * root. Reaching the end with open elements or an unfinished token is `truncated`.
 */
export function parseIcloudXml(source: string): XmlElement {
  let index = 0;
  const stack: OpenElement[] = [];
  let root: XmlElement | null = null;
  let elements = 0;
  const truncated = (what: string) => new IcloudXmlError("truncated", `document ended inside ${what}`);
  const malformed = (what: string) => new IcloudXmlError("malformed", what);
  if (source.charCodeAt(0) === 0xfeff) index = 1;
  if (source.startsWith("<?xml", index)) {
    const end = source.indexOf("?>", index);
    if (end < 0) throw truncated("the XML declaration");
    const declaration = source.slice(index + 5, end);
    if (/encoding\s*=\s*["'](?!utf-8["'])/i.test(declaration)) throw malformed("only UTF-8 is accepted");
    index = end + 2;
  }
  const resolve = (scope: Map<string, string>, prefix: string, isElement: boolean): string => {
    if (prefix === "xml") return "http://www.w3.org/XML/1998/namespace";
    const ns = scope.get(prefix);
    if (ns === undefined) {
      if (prefix === "" && isElement) return "";
      throw malformed(`undeclared namespace prefix ${prefix}`);
    }
    return ns;
  };
  while (index < source.length) {
    const lt = source.indexOf("<", index);
    const textEnd = lt < 0 ? source.length : lt;
    if (textEnd > index) {
      const raw = source.slice(index, textEnd);
      if (stack.length === 0) {
        if (raw.trim()) throw malformed("text outside the root element");
      } else {
        if (raw.includes("]]>")) throw malformed("unexpected CDATA terminator");
        stack[stack.length - 1].text.push(decodeEntities(raw));
      }
      index = textEnd;
      if (lt < 0) break;
    }
    if (source.startsWith("<!--", index)) {
      const end = source.indexOf("-->", index + 4);
      if (end < 0) throw truncated("a comment");
      index = end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", index)) {
      if (stack.length === 0) throw malformed("CDATA outside the root element");
      const end = source.indexOf("]]>", index + 9);
      if (end < 0) throw truncated("a CDATA section");
      stack[stack.length - 1].text.push(source.slice(index + 9, end));
      index = end + 3;
      continue;
    }
    if (source.startsWith("<!", index)) throw malformed("DOCTYPE and declarations are refused");
    if (source.startsWith("<?", index)) throw malformed("processing instructions are refused");
    const end = source.indexOf(">", index);
    if (end < 0) throw truncated("a tag");
    // A `>` inside a quoted attribute value would end the tag early; reject it.
    const tag = source.slice(index + 1, end);
    index = end + 1;
    if (tag.startsWith("/")) {
      const qname = tag.slice(1).trim();
      const open = stack.pop();
      if (!open || open.qname !== qname) throw malformed("mismatched end tag");
      const element: XmlElement = { ns: resolve(open.scope, open.prefix, true), name: open.local, attributes: open.attributes, children: open.children, text: open.text.join("") };
      if (stack.length === 0) root = element; else stack[stack.length - 1].children.push(element);
      continue;
    }
    if (root) throw malformed("content after the root element");
    const selfClosing = tag.endsWith("/");
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const nameMatch = /^([^\s/>]+)/.exec(body);
    if (!nameMatch || !NAME.test(nameMatch[1])) throw malformed("invalid element name");
    const qname = nameMatch[1];
    const attributes = body.slice(qname.length);
    const parentScope = stack.length ? stack[stack.length - 1].scope : new Map<string, string>();
    const scope = new Map(parentScope);
    const pattern = /\s+([^\s=]+)\s*=\s*("([^"<]*)"|'([^'<]*)')/gy;
    let consumed = 0; let count = 0;
    const names = new Set<string>();
    const plain: Record<string, string> = {};
    for (let match = pattern.exec(attributes); match; match = pattern.exec(attributes)) {
      consumed = pattern.lastIndex;
      count += 1;
      const attribute = match[1];
      if (count > MAX_XML_ATTRIBUTES || !NAME.test(attribute) || names.has(attribute)) throw malformed("invalid attribute");
      names.add(attribute);
      const value = decodeEntities(match[3] ?? match[4] ?? "");
      if (attribute === "xmlns") scope.set("", value);
      else if (attribute.startsWith("xmlns:")) {
        if (!value) throw malformed("empty namespace declaration");
        scope.set(attribute.slice(6), value);
      } else if (!attribute.includes(":")) plain[attribute] = value;
    }
    if (attributes.slice(consumed).trim()) throw malformed("invalid attribute syntax");
    for (const attribute of names) {
      const colon = attribute.indexOf(":");
      if (colon > 0 && attribute.slice(0, colon) !== "xmlns") resolve(scope, attribute.slice(0, colon), false);
    }
    const colon = qname.indexOf(":");
    const prefix = colon > 0 ? qname.slice(0, colon) : "";
    const local = colon > 0 ? qname.slice(colon + 1) : qname;
    resolve(scope, prefix, true);
    elements += 1;
    if (elements > MAX_XML_ELEMENTS) throw malformed("too many elements");
    if (stack.length >= MAX_XML_DEPTH) throw malformed("nesting is too deep");
    const open: OpenElement = { prefix, local, qname, scope, attributes: plain, children: [], text: [] };
    if (selfClosing) {
      const element: XmlElement = { ns: resolve(scope, prefix, true), name: local, attributes: plain, children: [], text: "" };
      if (stack.length === 0) root = element; else stack[stack.length - 1].children.push(element);
    } else stack.push(open);
  }
  if (stack.length > 0) throw truncated("an element");
  if (!root) throw truncated("the document");
  return root;
}

export function xmlChild(element: XmlElement, ns: string, name: string): XmlElement | undefined {
  return element.children.find((child) => child.ns === ns && child.name === name);
}
export function xmlChildren(element: XmlElement, ns: string, name: string): XmlElement[] {
  return element.children.filter((child) => child.ns === ns && child.name === name);
}

export type DavPropstat = Readonly<{ status: number; prop: XmlElement }>;
export type DavResponse = Readonly<{ href: string; status: number | null; propstats: DavPropstat[] }>;

function statusCode(element: XmlElement | undefined): number | null {
  if (!element) return null;
  const match = /^HTTP\/\d(?:\.\d)?\s+(\d{3})(?:\s|$)/.exec(element.text.trim());
  if (!match) throw new IcloudXmlError("malformed", "invalid DAV:status");
  return Number(match[1]);
}

/**
 * Parses a DAV:multistatus body. Each response needs exactly one DAV:href and
 * either a response-level DAV:status or at least one DAV:propstat with a status
 * and a DAV:prop. A 507 anywhere means the server truncated the results.
 */
export function parseIcloudMultistatus(body: string, maxResponses: number): Readonly<{ responses: DavResponse[]; truncated: boolean }> {
  const root = parseIcloudXml(body);
  if (root.ns !== DAV_NS || root.name !== "multistatus") throw new IcloudXmlError("malformed", "root is not DAV:multistatus");
  const items = xmlChildren(root, DAV_NS, "response");
  if (items.length > maxResponses) return { responses: [], truncated: true };
  let truncated = false;
  const responses = items.map((item) => {
    const hrefs = xmlChildren(item, DAV_NS, "href");
    if (hrefs.length !== 1) throw new IcloudXmlError("malformed", "a response needs exactly one href");
    const href = hrefs[0].text.trim();
    const status = statusCode(xmlChild(item, DAV_NS, "status"));
    const propstats = xmlChildren(item, DAV_NS, "propstat").map((propstat) => {
      const code = statusCode(xmlChild(propstat, DAV_NS, "status"));
      const prop = xmlChild(propstat, DAV_NS, "prop");
      if (code === null || !prop) throw new IcloudXmlError("malformed", "a propstat needs a status and a prop");
      return { status: code, prop };
    });
    if (status === null && propstats.length === 0) throw new IcloudXmlError("malformed", "a response needs a status or a propstat");
    if (status === 507 || propstats.some((entry) => entry.status === 507)) truncated = true;
    return { href, status, propstats };
  });
  return { responses, truncated };
}

/** The property element from a 200 propstat, or undefined when absent or not 200. */
export function davProp(response: DavResponse, ns: string, name: string): Readonly<{ status: number; element: XmlElement }> | undefined {
  for (const propstat of response.propstats) {
    const element = xmlChild(propstat.prop, ns, name);
    if (element) return { status: propstat.status, element };
  }
  return undefined;
}

export function xmlEscape(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;" })[character] ?? character);
}
