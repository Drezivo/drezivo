-- 0085 already added request_fingerprint; omitted internal reasons are stored as SQL NULL.
ALTER TABLE operator_command ALTER COLUMN reason DROP NOT NULL;
