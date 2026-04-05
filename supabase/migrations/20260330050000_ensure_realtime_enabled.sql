-- Ensure realtime is properly enabled on messages table
-- This is a supplemental migration to guarantee realtime works

-- Ensure REPLICA IDENTITY is set to FULL (required for realtime to see all columns)
ALTER TABLE IF EXISTS public.messages REPLICA IDENTITY FULL;

-- Grant necessary permissions for realtime
GRANT SELECT ON public.messages TO anon, authenticated;

-- Add messages to realtime publication (ignore if already exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
    END IF;
END $$;

-- Verify realtime is enabled (for debugging) - this is informational
-- SELECT 
--     schemaname,
--     tablename,
--     isselectable,
--     issendable
-- FROM pg_publication_tables
-- WHERE pubname = 'supabase_realtime'
-- AND tablename = 'messages';
