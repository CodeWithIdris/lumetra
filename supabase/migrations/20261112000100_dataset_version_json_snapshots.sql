-- Version snapshots preserve the exact structured dataset alongside their metadata.
UPDATE storage.buckets
SET
    file_size_limit = 67108864,
    allowed_mime_types = ARRAY[
        'text/csv',
        'text/plain',
        'application/octet-stream',
        'application/json'
    ]
WHERE id = 'lumetra-dataset-versions';

ALTER TABLE public.saved_analyses
    ADD COLUMN IF NOT EXISTS dataset_version_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dataset_versions_project_id_id
    ON public.dataset_versions(project_id, id);

ALTER TABLE public.dataset_versions
    DROP CONSTRAINT IF EXISTS dataset_versions_dataset_id_version_number_key;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'saved_analyses_dataset_version_project_fkey'
          AND conrelid = 'public.saved_analyses'::regclass
    ) THEN
        ALTER TABLE public.saved_analyses
            ADD CONSTRAINT saved_analyses_dataset_version_project_fkey
            FOREIGN KEY (project_id, dataset_version_id)
            REFERENCES public.dataset_versions(project_id, id)
            ON DELETE CASCADE;
    END IF;
END
$$;
