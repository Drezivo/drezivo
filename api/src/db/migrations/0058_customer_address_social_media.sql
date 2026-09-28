-- Customer profiles may originate from fittings, where address and social media are optional.
-- Reservation commands enforce their stricter address requirement before creating a snapshot.
ALTER TABLE customer
  ADD COLUMN address text,
  ADD COLUMN social_media text,
  ADD CONSTRAINT customer_address_when_present_check
    CHECK (address IS NULL OR (address = btrim(address) AND char_length(address) BETWEEN 1 AND 500)) NOT VALID,
  ADD CONSTRAINT customer_social_media_when_present_check
    CHECK (social_media IS NULL OR (social_media = btrim(social_media) AND char_length(social_media) BETWEEN 1 AND 320)) NOT VALID;
