create table if not exists public.imo_sn_app_state (
    id text primary key check (id = 'main'),
    state jsonb not null check (jsonb_typeof(state) = 'object'),
    updated_at timestamptz not null default now()
);

comment on table public.imo_sn_app_state is
    'Persistent IMO SN application state migrated from data/db.json.';

alter table public.imo_sn_app_state enable row level security;

revoke all on table public.imo_sn_app_state from anon, authenticated;
grant all on table public.imo_sn_app_state to service_role;
