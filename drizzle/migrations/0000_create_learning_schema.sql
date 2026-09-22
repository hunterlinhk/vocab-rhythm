-- profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- attempts
CREATE TABLE public.attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  mode text NOT NULL DEFAULT 'word',
  book_id text NOT NULL DEFAULT 'core',
  word text NOT NULL,
  translation text,
  correct boolean NOT NULL DEFAULT true,
  mistouch boolean NOT NULL DEFAULT false,
  typo_count integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attempts_user_created_idx ON public.attempts (user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attempts TO authenticated;
GRANT ALL ON public.attempts TO service_role;
ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own attempts select" ON public.attempts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own attempts insert" ON public.attempts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own attempts update" ON public.attempts FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own attempts delete" ON public.attempts FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- assistant messages (single conversation per user)
CREATE TABLE public.assistant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_messages_user_idx ON public.assistant_messages (user_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assistant_messages TO authenticated;
GRANT ALL ON public.assistant_messages TO service_role;
ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own messages select" ON public.assistant_messages FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own messages insert" ON public.assistant_messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own messages delete" ON public.assistant_messages FOR DELETE TO authenticated USING (auth.uid() = user_id);
