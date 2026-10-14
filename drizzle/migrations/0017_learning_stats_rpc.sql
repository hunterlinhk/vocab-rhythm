CREATE INDEX IF NOT EXISTS attempts_stats_recent_idx
  ON public.attempts (user_id, created_at DESC, id DESC)
  WHERE skipped = false;

CREATE OR REPLACE FUNCTION public.get_today_practice_count_v1(p_time_zone text)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_today date;
  v_count bigint;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  v_today := (now() AT TIME ZONE p_time_zone)::date;
  SELECT count(*) INTO v_count
  FROM public.attempts a
  WHERE a.user_id = v_user_id
    AND a.skipped = false
    AND a.created_at >= (v_today::timestamp AT TIME ZONE p_time_zone)
    AND a.created_at < ((v_today + 1)::timestamp AT TIME ZONE p_time_zone);
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_learning_stats_v1(p_time_zone text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_share boolean;
  v_today date;
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  SELECT coalesce(s.share_review_progress, true) INTO v_share
  FROM public.user_settings s WHERE s.user_id = v_user_id;
  v_share := coalesce(v_share, true);
  v_today := (now() AT TIME ZONE p_time_zone)::date;

  WITH base AS MATERIALIZED (
    SELECT a.id, a.book_id, a.review_word_key, a.created_at,
      (a.created_at AT TIME ZONE p_time_zone)::date AS local_day,
      a.correct, a.mistouch, a.typo_count,
      CASE WHEN v_share THEN '' ELSE a.book_id END AS scope_key
    FROM public.attempts a
    WHERE a.user_id = v_user_id AND a.skipped = false
  ),
  totals AS (
    SELECT count(*) AS total_count,
      count(*) FILTER (WHERE local_day = v_today) AS today_count,
      count(*) FILTER (WHERE correct AND (mistouch OR typo_count = 0)) AS clean_count
    FROM base
  ),
  identities AS (
    SELECT count(*) AS unique_words FROM (
      SELECT 1 FROM base GROUP BY scope_key, review_word_key
    ) grouped
  ),
  today_reps AS (
    SELECT DISTINCT ON (scope_key, review_word_key) id, created_at
    FROM base WHERE local_day = v_today
    ORDER BY scope_key, review_word_key, created_at DESC, id DESC
  ),
  today_words AS (
    SELECT coalesce(jsonb_agg(
      jsonb_build_object('word', a.word, 'bookId', a.book_id)
      ORDER BY t.created_at DESC, t.id DESC
    ), '[]'::jsonb) AS items
    FROM today_reps t JOIN public.attempts a ON a.id = t.id
  ),
  practice_counts AS (
    SELECT scope_key, review_word_key, count(*) AS times
    FROM base GROUP BY scope_key, review_word_key
  ),
  errors AS MATERIALIZED (
    SELECT * FROM base WHERE mistouch = false AND (correct = false OR typo_count > 0)
  ),
  error_counts AS (
    SELECT scope_key, review_word_key, count(*) AS error_attempts
    FROM errors GROUP BY scope_key, review_word_key HAVING count(*) >= 2
  ),
  error_reps AS (
    SELECT DISTINCT ON (scope_key, review_word_key)
      scope_key, review_word_key, id, created_at
    FROM errors
    ORDER BY scope_key, review_word_key, created_at DESC, id DESC
  ),
  trouble AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'word', ranked.word, 'bookId', ranked.book_id,
      'translation', ranked.translation, 'errorAttempts', ranked.error_attempts,
      'times', ranked.times
    ) ORDER BY ranked.error_attempts DESC, ranked.created_at DESC, ranked.id DESC), '[]'::jsonb) AS items
    FROM (
      SELECT a.word, a.book_id, a.translation, ec.error_attempts, pc.times, er.created_at, er.id
      FROM error_counts ec
      JOIN error_reps er USING (scope_key, review_word_key)
      JOIN practice_counts pc USING (scope_key, review_word_key)
      JOIN public.attempts a ON a.id = er.id
      ORDER BY ec.error_attempts DESC, er.created_at DESC, er.id DESC
      LIMIT 8
    ) ranked
  ),
  days AS (SELECT DISTINCT local_day FROM base),
  streak_start AS (
    SELECT CASE WHEN EXISTS (SELECT 1 FROM days WHERE local_day = v_today)
      THEN v_today ELSE v_today - 1 END AS day
  ),
  ordered_days AS (
    SELECT d.local_day, row_number() OVER (ORDER BY d.local_day DESC) AS position
    FROM days d CROSS JOIN streak_start s WHERE d.local_day <= s.day
  ),
  streak AS (
    SELECT count(*) AS days FROM ordered_days d CROSS JOIN streak_start s
    WHERE d.local_day = s.day - (d.position::integer - 1)
  ),
  recent AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'word', r.word, 'bookId', r.book_id, 'translation', r.translation,
      'mode', r.mode, 'correct', r.correct, 'typos', r.typo_count,
      'mistouch', r.mistouch, 'at', r.created_at
    ) ORDER BY r.created_at DESC, r.id DESC), '[]'::jsonb) AS items
    FROM (
      SELECT a.id, a.word, a.book_id, a.translation, a.mode, a.correct,
        a.typo_count, a.mistouch, a.created_at
      FROM public.attempts a
      WHERE a.user_id = v_user_id AND a.skipped = false
      ORDER BY a.created_at DESC, a.id DESC LIMIT 20
    ) r
  )
  SELECT jsonb_build_object(
    'todayCount', t.today_count, 'todayWords', tw.items,
    'totalCount', t.total_count, 'uniqueWords', i.unique_words,
    'cleanRate', CASE WHEN t.total_count = 0 THEN 0
      ELSE round(100.0 * t.clean_count / t.total_count)::integer END,
    'streakDays', s.days, 'troubleWords', tr.items, 'recent', r.items
  ) INTO v_result
  FROM totals t CROSS JOIN identities i CROSS JOIN today_words tw
    CROSS JOIN streak s CROSS JOIN trouble tr CROSS JOIN recent r;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_today_practice_count_v1(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_learning_stats_v1(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_today_practice_count_v1(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_learning_stats_v1(text) TO authenticated, service_role;
