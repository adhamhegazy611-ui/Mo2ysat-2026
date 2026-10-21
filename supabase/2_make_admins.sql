-- Makes the two main accounts admins.
-- Prerequisite: both users already exist in Authentication > Users.
do $$
declare
  names text[] := array['adham_hegazy33','tasmemat2026'];
  n text;
  uid uuid;
  cnt int;
begin
  foreach n in array names loop
    select id into uid from auth.users where email = lower(n) || '@mo2ysaat.app';
    if uid is null then
      raise exception 'No auth user found for: %', n;
    end if;

    update public.app_users set role = 'admin'
     where to_jsonb(app_users)->>'user_id' = uid::text
        or to_jsonb(app_users)->>'id' = uid::text;
    get diagnostics cnt = row_count;

    if cnt = 0 then
      if exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'app_users' and column_name = 'user_id') then
        insert into public.app_users (user_id, username, role) values (uid, lower(n), 'admin');
      else
        insert into public.app_users (id, username, role) values (uid, lower(n), 'admin');
      end if;
    end if;
  end loop;
end $$;
