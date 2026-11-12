GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE
        public.lumetra_projects,
        public.datasets,
        public.saved_analyses,
        public.reports,
        public.user_preferences
    TO authenticated;

GRANT SELECT, INSERT, DELETE
    ON TABLE
        public.dataset_versions,
        public.project_history
    TO authenticated;
