CREATE TYPE "public"."content_review" AS ENUM('DRAFT', 'REVIEW', 'APPROVED', 'REJECTED');--> statement-breakpoint
ALTER TABLE "content_pieces" ADD COLUMN "review" "content_review" DEFAULT 'DRAFT' NOT NULL;--> statement-breakpoint
--
-- Anything that was approved, sent, or is being sent had a person approve it:
-- that is what the old single column meant. Left at the DRAFT default they
-- would all stop being publishable the moment the publisher starts reading
-- this column instead.
--
UPDATE "content_pieces" SET "review" = 'APPROVED'
 WHERE "status" IN ('APPROVED', 'PUBLISHING', 'PUBLISHED');--> statement-breakpoint
--
-- A failed publish says nothing about the verdict, and the piece was approved
-- once or it would never have been attempted.
--
UPDATE "content_pieces" SET "review" = 'APPROVED' WHERE "status" = 'FAILED';