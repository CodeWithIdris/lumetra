-- Lumetra Phase 4B: Central PostgreSQL Persistence & Row Level Security
-- Migration: 20261029101800_create_lumetra_schema_and_rls.sql
-- Creates tables: lumetra_projects, datasets, saved_analyses, reports
-- Enables RLS and sets explicit policies for SELECT, INSERT, UPDATE, DELETE

-- 1. lumetra_projects
CREATE TABLE IF NOT EXISTS public.lumetra_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    objective TEXT,
    status TEXT NOT NULL DEFAULT 'no-data' CHECK (status IN ('no-data', 'data-loaded', 'analysed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Index for owner lookups and sorting
CREATE INDEX IF NOT EXISTS idx_lumetra_projects_user_id ON public.lumetra_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_lumetra_projects_updated_at ON public.lumetra_projects(updated_at DESC);

-- Enable RLS on lumetra_projects
ALTER TABLE public.lumetra_projects ENABLE ROW LEVEL SECURITY;

-- Explicit RLS Policies for lumetra_projects
CREATE POLICY "Users can select own projects"
    ON public.lumetra_projects
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own projects"
    ON public.lumetra_projects
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own projects"
    ON public.lumetra_projects
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own projects"
    ON public.lumetra_projects
    FOR DELETE
    USING (auth.uid() = user_id);


-- 2. datasets
CREATE TABLE IF NOT EXISTS public.datasets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.lumetra_projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'sample')),
    row_count INTEGER NOT NULL DEFAULT 0,
    column_count INTEGER NOT NULL DEFAULT 0,
    columns JSONB NOT NULL DEFAULT '[]'::jsonb,
    delimiter TEXT DEFAULT ',',
    type_overrides JSONB,
    cleaning_steps JSONB DEFAULT '[]'::jsonb,
    csv_content TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Indexes for datasets
CREATE INDEX IF NOT EXISTS idx_datasets_project_id ON public.datasets(project_id);
CREATE INDEX IF NOT EXISTS idx_datasets_user_id ON public.datasets(user_id);

-- Enable RLS on datasets
ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;

-- Explicit RLS Policies for datasets
CREATE POLICY "Users can select own datasets"
    ON public.datasets
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own datasets"
    ON public.datasets
    FOR INSERT
    WITH CHECK (
        auth.uid() = user_id AND
        EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update own datasets"
    ON public.datasets
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (
        auth.uid() = user_id AND
        EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete own datasets"
    ON public.datasets
    FOR DELETE
    USING (auth.uid() = user_id);


-- 3. saved_analyses
CREATE TABLE IF NOT EXISTS public.saved_analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.lumetra_projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    dataset_id TEXT,
    dataset_name TEXT,
    dataset_signature TEXT NOT NULL,
    variables JSONB NOT NULL DEFAULT '[]'::jsonb,
    configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
    sample_size INTEGER NOT NULL DEFAULT 0,
    missing_count INTEGER NOT NULL DEFAULT 0,
    missing_handling TEXT DEFAULT 'exclude',
    results JSONB NOT NULL DEFAULT '{}'::jsonb,
    interpretation JSONB NOT NULL DEFAULT '{}'::jsonb,
    method_notes JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Indexes for saved_analyses
CREATE INDEX IF NOT EXISTS idx_saved_analyses_project_id ON public.saved_analyses(project_id);
CREATE INDEX IF NOT EXISTS idx_saved_analyses_user_id ON public.saved_analyses(user_id);

-- Enable RLS on saved_analyses
ALTER TABLE public.saved_analyses ENABLE ROW LEVEL SECURITY;

-- Explicit RLS Policies for saved_analyses
CREATE POLICY "Users can select own analyses"
    ON public.saved_analyses
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own analyses"
    ON public.saved_analyses
    FOR INSERT
    WITH CHECK (
        auth.uid() = user_id AND
        EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update own analyses"
    ON public.saved_analyses
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (
        auth.uid() = user_id AND
        EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete own analyses"
    ON public.saved_analyses
    FOR DELETE
    USING (auth.uid() = user_id);


-- 4. reports
CREATE TABLE IF NOT EXISTS public.reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.lumetra_projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    objective TEXT,
    content_markdown TEXT NOT NULL,
    summary JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Indexes for reports
CREATE INDEX IF NOT EXISTS idx_reports_project_id ON public.reports(project_id);
CREATE INDEX IF NOT EXISTS idx_reports_user_id ON public.reports(user_id);

-- Enable RLS on reports
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Explicit RLS Policies for reports
CREATE POLICY "Users can select own reports"
    ON public.reports
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own reports"
    ON public.reports
    FOR INSERT
    WITH CHECK (
        auth.uid() = user_id AND
        EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update own reports"
    ON public.reports
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (
        auth.uid() = user_id AND
        EXISTS (
            SELECT 1 FROM public.lumetra_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete own reports"
    ON public.reports
    FOR DELETE
    USING (auth.uid() = user_id);

-- 5. Trigger to automatically update updated_at on modification
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_lumetra_projects_updated_at ON public.lumetra_projects;
CREATE TRIGGER trigger_lumetra_projects_updated_at
    BEFORE UPDATE ON public.lumetra_projects
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trigger_datasets_updated_at ON public.datasets;
CREATE TRIGGER trigger_datasets_updated_at
    BEFORE UPDATE ON public.datasets
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trigger_saved_analyses_updated_at ON public.saved_analyses;
CREATE TRIGGER trigger_saved_analyses_updated_at
    BEFORE UPDATE ON public.saved_analyses
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trigger_reports_updated_at ON public.reports;
CREATE TRIGGER trigger_reports_updated_at
    BEFORE UPDATE ON public.reports
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
