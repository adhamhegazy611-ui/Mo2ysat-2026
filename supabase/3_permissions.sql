-- 3) صلاحيات المستخدمين + حماية جدول المقايسات. آمن تشغيله أكتر من مرة.
-- شغّله مرة واحدة من Supabase > SQL Editor > Run

-- (أ) عمود الصلاحيات
alter table public.app_users
  add column if not exists perms jsonb not null
  default '{"add":true,"edit":true,"del":false,"export":true}'::jsonb;

update public.app_users
   set perms = '{"add":false,"edit":false,"del":false,"export":true}'::jsonb
 where role = 'viewer'
   and perms = '{"add":true,"edit":true,"del":false,"export":true}'::jsonb;

-- (ب) دوال مساعدة
create or replace function public.is_member() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.app_users where user_id = auth.uid())
$$;

create or replace function public.has_perm(k text) returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce((select a.role = 'admin' or coalesce((a.perms->>k)::boolean, false)
                     from public.app_users a where a.user_id = auth.uid()), false)
$$;

create or replace function public.est_exists(p_id text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.estimates_added where id::text = p_id)
$$;

create or replace function public.clean_perms(p jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'add',    coalesce((p->>'add')::boolean, false),
    'edit',   coalesce((p->>'edit')::boolean, false),
    'del',    coalesce((p->>'del')::boolean, false),
    'export', coalesce((p->>'export')::boolean, false))
$$;

create or replace function public.role_for(p jsonb, is_adm boolean) returns text
language sql immutable as $$
  select case when is_adm then 'admin'
              when (p->>'add')::boolean or (p->>'edit')::boolean or (p->>'del')::boolean then 'editor'
              else 'viewer' end
$$;

-- (ج) قبول طلب بصلاحيات يحددها المسؤول
drop function if exists public.approve_signup(uuid);
create or replace function public.approve_signup(p_user uuid, p_perms jsonb default null, p_admin boolean default false)
returns void language plpgsql security definer set search_path = public, auth as $$
declare r public.signup_requests; pm jsonb;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into r from public.signup_requests where user_id = p_user and status = 'pending';
  if not found then raise exception 'request not found'; end if;
  pm := public.clean_perms(coalesce(p_perms, '{"add":true,"edit":true,"del":false,"export":true}'::jsonb));
  update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = p_user;
  insert into public.app_users (user_id, username, role, perms)
  values (p_user, r.username, public.role_for(pm, p_admin), pm)
  on conflict (user_id) do update set role = excluded.role, perms = excluded.perms;
  update public.signup_requests set status = 'approved' where user_id = p_user;
end $$;

-- (د) تعديل صلاحيات حساب موجود
create or replace function public.set_user_perms(p_user uuid, p_perms jsonb, p_admin boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare pm jsonb := public.clean_perms(p_perms);
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_user = auth.uid() and not p_admin then raise exception 'مينفعش تشيل صلاحية المسؤول من حسابك'; end if;
  update public.app_users set perms = pm, role = public.role_for(pm, p_admin) where user_id = p_user;
  if not found then raise exception 'user not found'; end if;
end $$;

-- (هـ) إيقاف حساب (بيرجع لقائمة الطلبات، وتقدر تقبله تاني)
create or replace function public.disable_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare un text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_user = auth.uid() then raise exception 'مينفعش توقف حسابك'; end if;
  delete from public.app_users where user_id = p_user returning username into un;
  if un is null then raise exception 'user not found'; end if;
  insert into public.signup_requests (user_id, username, status) values (p_user, un, 'pending')
  on conflict (user_id) do update set status = 'pending';
end $$;

revoke all on function public.approve_signup(uuid, jsonb, boolean) from public, anon;
revoke all on function public.set_user_perms(uuid, jsonb, boolean)  from public, anon;
revoke all on function public.disable_user(uuid)                    from public, anon;
grant execute on function public.approve_signup(uuid, jsonb, boolean) to authenticated;
grant execute on function public.set_user_perms(uuid, jsonb, boolean)  to authenticated;
grant execute on function public.disable_user(uuid)                    to authenticated;
grant execute on function public.has_perm(text), public.is_member(), public.est_exists(text) to authenticated;

-- (و) المسؤول يشوف كل الحسابات
drop policy if exists "admins read users" on public.app_users;
create policy "admins read users" on public.app_users for select using (public.is_admin());

-- (ز) حماية جدول المقايسات: مفيش قراءة غير للحسابات المقبولة، والكتابة حسب الصلاحية
alter table public.estimates_added enable row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'estimates_added' loop
    execute format('drop policy %I on public.estimates_added', p.policyname);
  end loop;
end $$;

create policy "members read" on public.estimates_added for select
  using (public.is_member());

create policy "perm insert" on public.estimates_added for insert
  with check (case
    when coalesce((doc->>'del')::boolean, false) then public.has_perm('del')
    when id::text like 'm%' then public.has_perm('add') or (public.has_perm('edit') and public.est_exists(id::text))
    else public.has_perm('edit') end);

create policy "perm update" on public.estimates_added for update
  using (public.has_perm('edit') or public.has_perm('del'))
  with check (case when coalesce((doc->>'del')::boolean, false) then public.has_perm('del')
                   else public.has_perm('edit') end);

create policy "perm delete" on public.estimates_added for delete
  using (public.has_perm('del'));
