-- Ticket 383 (D37): a guessed Where can be dismissed while Completion places is off.
-- Mirrors hosted 20261126230000_where_guess_dismissal_without_labels.sql. A dismissal row
-- is admitted while labels are off only for a suggestion a model guess can produce
-- (WHERE_GUESS_DISMISSAL_KEYS: home, anywhere, add_place). Saved-place dismissals and
-- markers keep requiring labels on. Turning labels off still deletes every dismissal
-- (local_store/place_labels.rs). Account sync contract 11 carries such rows.
DROP TRIGGER where_suggestion_dismissals_require_enabled;
DROP TRIGGER where_suggestion_dismissals_require_enabled_update;

CREATE TRIGGER where_suggestion_dismissals_require_enabled BEFORE INSERT ON where_suggestion_dismissals
WHEN NEW.suggestion NOT IN ('home','anywhere','add_place')
  AND NOT EXISTS (SELECT 1 FROM place_label_settings WHERE user_id = NEW.user_id AND enabled = 1)
BEGIN SELECT RAISE(ABORT, 'Completion place labels are off.'); END;
CREATE TRIGGER where_suggestion_dismissals_require_enabled_update BEFORE UPDATE ON where_suggestion_dismissals
WHEN NEW.suggestion NOT IN ('home','anywhere','add_place')
  AND NOT EXISTS (SELECT 1 FROM place_label_settings WHERE user_id = NEW.user_id AND enabled = 1)
BEGIN SELECT RAISE(ABORT, 'Completion place labels are off.'); END;
