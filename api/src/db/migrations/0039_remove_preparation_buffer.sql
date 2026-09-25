-- Preparation-before-pickup is no longer part of Drezivo's reservation availability model.
-- Existing variants are normalized to zero so historical catalogue rows cannot continue to imply
-- a pre-pickup block. The legacy column remains for backward-compatible schema rollout; new code
-- ignores it and treats turnaround_minutes as the post-return recovery duration.

UPDATE product_variant
SET prep_minutes = 0
WHERE prep_minutes <> 0;
