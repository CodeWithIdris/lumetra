-- Phase 4B.4: immutable dataset snapshots and optimistic record revisions.
ALTER TABLE public.lumetra_projects
    ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE public.datasets
    ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE public.saved_analyses
    ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS dataset_version INTEGER;
ALTER TABLE public.reports
    ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.dataset_versions (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES public.lumetra_projects(id) ON DELETE CASCADE,
    dataset_id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    content_hash TEXT NOT NULL,
    content_path TEXT NOT NULL,
    cleaning_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    change_description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (content_path)
);

CREATE INDEX IF NOT EXISTS idx_dataset_versions_project_created
    ON public.dataset_versions(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dataset_versions_owner
    ON public.dataset_versions(user_id);
ALTER TABLE public.dataset_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own dataset versions"
    ON public.dataset_versions FOR SELECT
    USING (
        auth.uid() = user_id AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can insert own dataset versions"
    ON public.dataset_versions FOR INSERT
    WITH CHECK (
        auth.uid() = user_id AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can delete own dataset versions"
    ON public.dataset_versions FOR DELETE
    USING (
        auth.uid() = user_id AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );

CREATE TABLE IF NOT EXISTS public.project_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.lumetra_projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('project', 'analysis', 'report')),
    entity_id TEXT NOT NULL,
    revision BIGINT NOT NULL,
    change_description TEXT NOT NULL,
    snapshot JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_project_history_project_created
    ON public.project_history(project_id, created_at DESC);
ALTER TABLE public.project_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can select own project history"
    ON public.project_history FOR SELECT
    USING (
        auth.uid() = user_id AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can insert own project history"
    ON public.project_history FOR INSERT
    WITH CHECK (
        auth.uid() = user_id AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can delete own project history"
    ON public.project_history FOR DELETE
    USING (
        auth.uid() = user_id AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'lumetra-dataset-versions',
    'lumetra-dataset-versions',
    false,
    67108864,
    ARRAY['text/csv', 'text/plain', 'application/octet-stream', 'application/json']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 67108864,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "Users can read own dataset version files"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'lumetra-dataset-versions'
        AND (storage.foldername(name))[1] = auth.uid()::text
        AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = ((storage.foldername(name))[2])::uuid
              AND p.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can upload own dataset version files"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'lumetra-dataset-versions'
        AND (storage.foldername(name))[1] = auth.uid()::text
        AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = ((storage.foldername(name))[2])::uuid
              AND p.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can update own dataset version files"
    ON storage.objects FOR UPDATE
    USING (
        bucket_id = 'lumetra-dataset-versions'
        AND (storage.foldername(name))[1] = auth.uid()::text
        AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = ((storage.foldername(name))[2])::uuid
              AND p.user_id = auth.uid()
        )
    )
    WITH CHECK (
        bucket_id = 'lumetra-dataset-versions'
        AND (storage.foldername(name))[1] = auth.uid()::text
        AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = ((storage.foldername(name))[2])::uuid
              AND p.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can delete own dataset version files"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'lumetra-dataset-versions'
        AND (storage.foldername(name))[1] = auth.uid()::text
        AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = ((storage.foldername(name))[2])::uuid
              AND p.user_id = auth.uid()
        )
    );
