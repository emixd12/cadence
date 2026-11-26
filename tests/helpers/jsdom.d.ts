// jsdom ships no types and the repository adds no @types package for it. This declares
// the small part the day view harness uses (tests/helpers/day-view-harness.ts).
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: Record<string, unknown>);
    readonly window: Window & typeof globalThis;
  }
}
