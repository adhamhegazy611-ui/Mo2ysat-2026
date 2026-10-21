-- Signup requests + admin approval. Safe to run more than once.

create table if not exists public.signup_requests (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  username   text not null,
  status     text not null default 'pending' check (status in ('pending','approved')),
  created_at timestamptz not null default now()
);
alter table public.signup_requests enable row level security;

create or replace function public.is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.app_users a
    where (to_jsonb(a)->>'user_id' = auth.uid()::text or to_jsonb(a)->>'id' = auth.uid()::text)
      and a.role = 'admin'
  )
$$;

create or replace function public.approve_signup(p_user uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare r public.signup_requests;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into r from public.signup_requests where user_id = p_user and status = 'pending';
  if not found then raise exception 'request not found'; end if;
  update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = p_user;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'app_users' and column_name = 'user_id') then
    insert into public.app_users (user_id, username, role) values (p_user, r.username, 'user') on conflict do nothing;
  else
    insert into public.app_users (id, username, role) values (p_user, r.username, 'user') on conflict do nothing;
  end if;
  update public.signup_requests set status = 'approved' where user_id = p_user;
end $$;

create or replace function public.reject_signup(p_user uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  delete from auth.users
   where id = p_user
     and exists (select 1 from public.signup_requests where user_id = p_user and status = 'pending');
end $$;

create or replace function public.handle_signup_request() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if new.raw_user_meta_data->>'signup_request' = 'true' and new.email like '%@mo2ysaat.app' then
    insert into public.signup_requests (user_id, username)
    values (new.id, split_part(new.email, '@', 1)) on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists on_signup_request on auth.users;
create trigger on_signup_request after insert on auth.users
  for each row execute function public.handle_signup_request();

drop policy if exists "admins read requests" on public.signup_requests;
create policy "admins read requests" on public.signup_requests for select using (public.is_admin());

revoke all on function public.is_admin()           from public, anon;
revoke all on function public.approve_signup(uuid) from public, anon;
revoke all on function public.reject_signup(uuid)  from public, anon;
grant execute on function public.is_admin()           to authenticated;
grant execute on function public.approve_signup(uuid) to authenticated;
grant execute on function public.reject_signup(uuid)  to authenticated;
