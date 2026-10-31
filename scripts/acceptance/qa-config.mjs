// Ticket 257: public production QA configuration.
//
// The production project ref and its publishable key are public by design: the
// key only identifies the project, and every read through it still runs as a
// signed-in test account under Row Level Security. The signed-out web bundle does
// not expose the key, so it is committed here and production runs need no lookup.
//
// Never add a secret key, a service-role key, a token or a session to this file.
// CADENCE_QA_SUPABASE_PUBLISHABLE_KEY still overrides the key when set (for
// example after a key rotation, before this file is updated); callers check its
// shape and stop with their usual reason on a bad value.
export const QA_PUBLISHABLE_KEY_ENV = 'CADENCE_QA_SUPABASE_PUBLISHABLE_KEY';

export const PRODUCTION_QA = Object.freeze({
  projectRef: 'qjodzutjxtmtzczbloxa',
  supabaseUrl: 'https://qjodzutjxtmtzczbloxa.supabase.co',
  publishableKey: 'sb_publishable__Sx-lZ5YR8FXt8e_bjKntw_25I9xu1k',
});

/** The production publishable key: the environment override when set, else the committed key. */
export function qaPublishableKey(env = process.env) {
  const override = env?.[QA_PUBLISHABLE_KEY_ENV];
  return typeof override === 'string' && override.trim() !== '' ? override.trim() : PRODUCTION_QA.publishableKey;
}
