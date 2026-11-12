-- Keep larger dataset files in private object storage; retain ownership and metadata in PostgreSQL.
ALTER TABLE public.datasets
    ADD COLUMN IF NOT EXISTS content_path TEXT;

-- A project's object files are removed after the owning project row is deleted.
DROP POLICY IF EXISTS "Users can delete own dataset version files" ON storage.objects;
CREATE POLICY "Users can delete own dataset version files"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'lumetra-dataset-versions'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Child ownership must agree with the owning project as well as auth.uid().
DROP POLICY IF EXISTS "Users can select own datasets" ON public.datasets;
DROP POLICY IF EXISTS "Users can insert own datasets" ON public.datasets;
DROP POLICY IF EXISTS "Users can update own datasets" ON public.datasets;
DROP POLICY IF EXISTS "Users can delete own datasets" ON public.datasets;

CREATE POLICY "Users can select own datasets"
    ON public.datasets FOR SELECT
    USING (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can insert own datasets"
    ON public.datasets FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can update own datasets"
    ON public.datasets FOR UPDATE
    USING (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    )
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can delete own datasets"
    ON public.datasets FOR DELETE
    USING (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can select own analyses" ON public.saved_analyses;
DROP POLICY IF EXISTS "Users can insert own analyses" ON public.saved_analyses;
DROP POLICY IF EXISTS "Users can update own analyses" ON public.saved_analyses;
DROP POLICY IF EXISTS "Users can delete own analyses" ON public.saved_analyses;

CREATE POLICY "Users can select own analyses"
    ON public.saved_analyses FOR SELECT
    USING (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can insert own analyses"
    ON public.saved_analyses FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can update own analyses"
    ON public.saved_analyses FOR UPDATE
    USING (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    )
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can delete own analyses"
    ON public.saved_analyses FOR DELETE
    USING (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can select own reports" ON public.reports;
DROP POLICY IF EXISTS "Users can insert own reports" ON public.reports;
DROP POLICY IF EXISTS "Users can update own reports" ON public.reports;
DROP POLICY IF EXISTS "Users can delete own reports" ON public.reports;

CREATE POLICY "Users can select own reports"
    ON public.reports FOR SELECT
    USING (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can insert own reports"
    ON public.reports FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can update own reports"
    ON public.reports FOR UPDATE
    USING (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    )
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can delete own reports"
    ON public.reports FOR DELETE
    USING (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );

CREATE TABLE IF NOT EXISTS public.user_preferences (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    persona TEXT NOT NULL DEFAULT 'scientist'
        CHECK (persona IN ('engineer', 'economist', 'scientist', 'product', 'clinical')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own preferences"
    ON public.user_preferences FOR SELECT
    USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own preferences"
    ON public.user_preferences FOR INSERT
    WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own preferences"
    ON public.user_preferences FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own preferences"
    ON public.user_preferences FOR DELETE
    USING (auth.uid() = user_id);
