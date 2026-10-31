-- Slice 1: organizaciones, ledger de créditos, órdenes, consultas, formularios, auditoría.
create extension if not exists pgcrypto;

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'pending' check (status in ('pending','active','suspended')),
  created_at timestamptz not null default now()
);

create table memberships (
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  primary key (org_id, user_id)
);

create table credit_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  delta int not null,
  reason text not null check (reason in ('purchase','consume','trial','refund','adjustment')),
  ref_type text,
  ref_id uuid,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  created_by uuid
);
create index on credit_ledger (org_id);

create or replace function forbid_ledger_mutation() returns trigger language plpgsql as $$
begin raise exception 'credit_ledger es de solo inserción'; end $$;
create trigger credit_ledger_immutable before update or delete on credit_ledger
  for each row execute function forbid_ledger_mutation();

create view org_balances with (security_invoker = true) as
  select org_id, coalesce(sum(delta), 0)::int as balance from credit_ledger group by org_id;

create table orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  credits int not null check (credits > 0),
  amount_cop int not null check (amount_cop > 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired')),
  bank_reference text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid
);

create table lookups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  user_id uuid not null,
  plate text not null,
  tramite smallint not null check (tramite between 1 and 18),
  status text not null default 'pending' check (status in ('pending','done','not_found','blocked','error','timeout')),
  croma_job_id text,
  credits_used int,
  latency_ms int,
  cache_hit boolean,
  response jsonb,            -- datos personales: se purga a las 72 h
  error_code text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  purged_at timestamptz,
  unique (org_id, idempotency_key)
);
create index on lookups (org_id, created_at desc);

create table forms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  user_id uuid not null,
  lookup_id uuid references lookups(id),
  tramite smallint not null check (tramite between 1 and 18),
  template_version text not null,
  payload jsonb,             -- datos personales: se purga a las 72 h
  regenerable_until timestamptz not null,
  ledger_id uuid references credit_ledger(id),
  outcome text check (outcome in ('accepted','rejected')),
  created_at timestamptz not null default now(),
  purged_at timestamptz
);
create index on forms (org_id, created_at desc);

create table audit_log (
  id bigserial primary key,
  org_id uuid,
  user_id uuid,
  event text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);

-- RLS: todo se filtra por membresía. Las escrituras sensibles pasan por el servidor (service role).
create or replace function is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where org_id = p_org and user_id = auth.uid());
$$;

alter table organizations enable row level security;
alter table memberships enable row level security;
alter table credit_ledger enable row level security;
alter table orders enable row level security;
alter table lookups enable row level security;
alter table forms enable row level security;
alter table audit_log enable row level security;

create policy org_select on organizations for select using (is_member(id));
create policy membership_select on memberships for select using (user_id = auth.uid());
create policy ledger_select on credit_ledger for select using (is_member(org_id));
create policy orders_select on orders for select using (is_member(org_id));
create policy orders_insert on orders for insert with check (is_member(org_id) and status = 'pending');
create policy lookups_select on lookups for select using (is_member(org_id));
create policy forms_select on forms for select using (is_member(org_id));
-- audit_log: sin políticas = solo service role.

-- Consumo atómico e idempotente de 1 crédito.
create or replace function consume_credit(p_org uuid, p_form uuid, p_key text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_balance int; v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_org::text));
  select id into v_id from credit_ledger where idempotency_key = p_key;
  if found then return v_id; end if;
  select coalesce(sum(delta), 0) into v_balance from credit_ledger where org_id = p_org;
  if v_balance < 1 then raise exception 'INSUFFICIENT_CREDITS'; end if;
  insert into credit_ledger(org_id, delta, reason, ref_type, ref_id, idempotency_key)
  values (p_org, -1, 'consume', 'form', p_form, p_key) returning id into v_id;
  return v_id;
end $$;

create or replace function approve_order(p_order uuid, p_admin uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_order orders%rowtype; v_id uuid;
begin
  select * into v_order from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status = 'approved' then
    select id into v_id from credit_ledger where idempotency_key = 'order:' || p_order;
    return v_id;
  end if;
  if v_order.status <> 'pending' then raise exception 'ORDER_NOT_PENDING'; end if;
  insert into credit_ledger(org_id, delta, reason, ref_type, ref_id, idempotency_key, created_by)
  values (v_order.org_id, v_order.credits, 'purchase', 'order', v_order.id, 'order:' || p_order, p_admin)
  returning id into v_id;
  update orders set status = 'approved', approved_at = now(), approved_by = p_admin where id = p_order;
  return v_id;
end $$;

create or replace function grant_trial(p_org uuid, p_credits int default 3)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into credit_ledger(org_id, delta, reason, idempotency_key)
  values (p_org, p_credits, 'trial', 'trial:' || p_org)
  on conflict (idempotency_key) do nothing returning id into v_id;
  return v_id;
end $$;

-- Purga de datos personales a las 72 h (se invoca desde el cron diario).
create or replace function purge_personal_data() returns int
language plpgsql security definer set search_path = public as $$
declare n1 int; n2 int;
begin
  update lookups set response = null, purged_at = now()
   where response is not null and created_at < now() - interval '72 hours';
  get diagnostics n1 = row_count;
  update forms set payload = null, purged_at = now()
   where payload is not null and created_at < now() - interval '72 hours';
  get diagnostics n2 = row_count;
  return n1 + n2;
end $$;

revoke all on function consume_credit(uuid, uuid, text) from public, anon, authenticated;
revoke all on function approve_order(uuid, uuid) from public, anon, authenticated;
revoke all on function grant_trial(uuid, int) from public, anon, authenticated;
revoke all on function purge_personal_data() from public, anon, authenticated;
grant execute on function consume_credit(uuid, uuid, text) to service_role;
grant execute on function approve_order(uuid, uuid) to service_role;
grant execute on function grant_trial(uuid, int) to service_role;
grant execute on function purge_personal_data() to service_role;
