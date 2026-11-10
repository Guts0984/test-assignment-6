-- Room double-booking is guaranteed by the database, not by application code.
-- btree_gist is required to mix `=` on uuid with `&&` on a range in one GiST index.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "event_occurrences"
  ADD CONSTRAINT "occurrences_no_room_overlap"
  EXCLUDE USING gist ("room_id" WITH =, "during" WITH &&);
