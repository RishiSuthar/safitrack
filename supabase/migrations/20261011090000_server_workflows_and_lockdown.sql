-- ============================================================
-- Server-side workflow engine + function/view lockdown
-- ============================================================
-- 1. route_stops_view ran as its owner, bypassing RLS, and was
--    readable with the anon key: every organization's route stops
--    (company names, addresses, coordinates) were public. It now runs
--    with the caller's permissions and is not exposed to anon.
--
-- 2. Workflows ran twice: once in database triggers (which ignored
--    conditions and only knew record_created/record_updated) and once
--    in every open manager browser tab. The old triggers are replaced
--    by one engine that runs here, once per change, with the same
--    triggers, conditions, actions and {{record.field}} templates the
--    browser engine supported. The browser engine is switched off in
--    the app at the same time.
--
-- 3. Internal SECURITY DEFINER functions (trigger functions, the
--    workflow engine) were callable by anyone through /rest/v1/rpc.
--    EXECUTE is revoked from API roles; triggers still fire.
--
-- 4. search_path is pinned on functions the security advisor flagged.
-- ============================================================

begin;

-- ─────────────────────────────────────────────────────────────
-- 1. route_stops_view
-- ─────────────────────────────────────────────────────────────
alter view public.route_stops_view set (security_invoker = true);
revoke all on public.route_stops_view from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.route_stops_view from authenticated;


-- ─────────────────────────────────────────────────────────────
-- 2. Workflow engine
-- ─────────────────────────────────────────────────────────────
drop trigger if exists trg_workflow_companies     on public.companies;
drop trigger if exists trg_workflow_people        on public.people;
drop trigger if exists trg_workflow_opportunities on public.opportunities;
drop trigger if exists trg_workflow_tasks         on public.tasks;
drop function if exists public.trigger_workflow_companies();
drop function if exists public.trigger_workflow_people();
drop function if exists public.trigger_workflow_opportunities();
drop function if exists public.trigger_workflow_tasks();
drop function if exists public.execute_workflow_actions(uuid, jsonb);

-- Replace {{record.field}}, {{trigger.table}}, {{trigger.eventType}} and
-- {{field}} placeholders. Unknown placeholders are left as written.
create or replace function public.wf_render(p_template text, p_record jsonb, p_table text, p_event text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_out   text := p_template;
  v_match text[];
  v_path  text;
  v_parts text[];
  v_value text;
begin
  if p_template is null then
    return null;
  end if;

  for v_match in select regexp_matches(p_template, '\{\{(\w+(?:\.\w+)*)\}\}', 'g') loop
    v_path  := v_match[1];
    v_parts := string_to_array(v_path, '.');
    if v_parts[1] = 'record' then
      v_value := p_record ->> v_parts[2];
    elsif v_parts[1] = 'trigger' then
      v_value := case v_parts[2] when 'table' then p_table when 'eventType' then p_event end;
    else
      v_value := p_record ->> v_path;
    end if;
    if v_value is not null then
      v_out := replace(v_out, '{{' || v_path || '}}', v_value);
    end if;
  end loop;

  return v_out;
end;
$$;

create or replace function public.wf_render_fields(p_fields jsonb, p_record jsonb, p_table text, p_event text)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(
           key,
           case when jsonb_typeof(value) = 'string'
                then to_jsonb(public.wf_render(value #>> '{}', p_record, p_table, p_event))
                else value end),
         '{}'::jsonb)
  from jsonb_each(case when jsonb_typeof(p_fields) = 'object' then p_fields else '{}'::jsonb end);
$$;

create or replace function public.wf_condition_ok(p_record jsonb, p_cond jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_raw  text := p_record ->> (p_cond ->> 'field');
  v_val  text := coalesce(v_raw, '');
  v_test text := coalesce(p_cond ->> 'value', '');
begin
  case p_cond ->> 'operator'
    when 'equals'       then return v_val = v_test;
    when 'not_equals'   then return v_val <> v_test;
    when 'contains'     then return position(lower(v_test) in lower(v_val)) > 0;
    when 'not_contains' then return position(lower(v_test) in lower(v_val)) = 0;
    when 'greater_than' then return coalesce(v_raw::numeric > v_test::numeric, false);
    when 'less_than'    then return coalesce(v_raw::numeric < v_test::numeric, false);
    when 'is_empty'     then return trim(v_val) = '';
    when 'is_not_empty' then return trim(v_val) <> '';
    else return true;
  end case;
exception when others then
  -- e.g. a non-numeric value compared with greater_than
  return false;
end;
$$;

create or replace function public.wf_conditions_ok(p_conditions jsonb, p_record jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(bool_and(public.wf_condition_ok(p_record, c)), true)
  from jsonb_array_elements(case when jsonb_typeof(p_conditions) = 'array' then p_conditions else '[]'::jsonb end) c;
$$;

create or replace function public.wf_matches(p_trigger jsonb, p_table text, p_op text, p_new jsonb, p_old jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_type    text := p_trigger ->> 'type';
  v_object  text := nullif(p_trigger ->> 'object_type', '');
  v_record  text := nullif(p_trigger ->> 'record_id', '');
  v_field   text := nullif(p_trigger ->> 'watch_field', '');
  v_from    text := nullif(p_trigger ->> 'from_value', '');
  v_to      text := nullif(p_trigger ->> 'to_value', '');
  v_is_task boolean := p_table = 'tasks';
begin
  if v_type in ('record_created', 'record_updated') then
    if v_is_task then return false; end if;
    if (v_type = 'record_created' and p_op <> 'INSERT')
       or (v_type = 'record_updated' and p_op <> 'UPDATE') then return false; end if;
    if v_object is not null and v_object <> p_table then return false; end if;
    if v_record is not null and v_record <> p_new ->> 'id' then return false; end if;
    return true;

  elsif v_type = 'field_changed' then
    if p_op <> 'UPDATE' then return false; end if;
    if v_object is not null and v_object <> p_table then return false; end if;
    if v_field is not null then
      if (p_old -> v_field) is not distinct from (p_new -> v_field) then return false; end if;
      if v_from is not null and coalesce(p_old ->> v_field, '') <> v_from then return false; end if;
      if v_to   is not null and coalesce(p_new ->> v_field, '') <> v_to   then return false; end if;
    end if;
    return true;

  elsif v_type = 'task_created' then
    return v_is_task and p_op = 'INSERT';

  elsif v_type = 'task_completed' then
    return v_is_task and p_op = 'UPDATE'
       and p_new ->> 'status' = 'completed'
       and coalesce(p_old ->> 'status', '') <> 'completed';
  end if;

  return false;
end;
$$;

-- Insert only the keys that are real columns, so table defaults apply
-- to everything else.
create or replace function public.wf_insert(p_table text, p_fields jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cols text;
  v_id   uuid;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
  into   v_cols
  from   pg_attribute a
  where  a.attrelid = format('public.%I', p_table)::regclass
    and  a.attnum > 0 and not a.attisdropped
    and  a.attname not in ('id', 'created_at', 'updated_at')
    and  p_fields ? a.attname;

  if v_cols is null then
    raise exception 'No valid fields to insert into %', p_table;
  end if;

  execute format(
    'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning id',
    p_table, v_cols, v_cols, p_table)
  into v_id
  using p_fields;

  return v_id;
end;
$$;

create or replace function public.wf_update(p_table text, p_id uuid, p_org uuid, p_fields jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cols text;
  v_id   uuid;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
  into   v_cols
  from   pg_attribute a
  where  a.attrelid = format('public.%I', p_table)::regclass
    and  a.attnum > 0 and not a.attisdropped
    and  a.attname not in ('id', 'organization_id', 'created_at', 'created_by')
    and  p_fields ? a.attname;

  if v_cols is null then
    raise exception 'No valid fields to update on %', p_table;
  end if;

  execute format(
    'update public.%I set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) '
    'where id = $2 and organization_id = $3 returning id',
    p_table, v_cols, v_cols, p_table)
  into v_id
  using p_fields, p_id, p_org;

  return v_id;
end;
$$;

create or replace function public.wf_execute(p_wf public.workflows, p_table text, p_op text, p_record jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start     timestamptz := clock_timestamp();
  v_org       uuid := p_wf.organization_id;
  v_action    jsonb;
  v_index     int := 0;
  v_type      text;
  v_object    text;
  v_fields    jsonb;
  v_target    uuid;
  v_id        uuid;
  v_message   text;
  v_recipient uuid;
  v_results   jsonb := '[]'::jsonb;
  v_status    text := 'success';
  v_error     text;
begin
  for v_action in
    select value from jsonb_array_elements(case when jsonb_typeof(p_wf.actions) = 'array' then p_wf.actions else '[]'::jsonb end)
  loop
    v_type := v_action ->> 'type';
    v_id   := null;

    -- Each action runs in its own subtransaction: a failing action is
    -- rolled back and logged without undoing the others.
    begin
      v_fields := public.wf_render_fields(v_action -> 'field_values', p_record, p_table, p_op);

      if v_type = 'create_record' then
        v_object := v_action ->> 'object_type';
        if v_object is null or v_object not in ('companies', 'people', 'opportunities') then
          raise exception 'Unsupported object type: %', coalesce(v_object, 'none');
        end if;
        v_fields := jsonb_build_object(case when v_object = 'opportunities' then 'user_id' else 'created_by' end, p_wf.created_by)
                    || v_fields
                    || jsonb_build_object('organization_id', v_org);
        v_id := public.wf_insert(v_object, v_fields);

      elsif v_type in ('update_record', 'update_task') then
        v_object := case when v_type = 'update_task' then 'tasks'
                         else coalesce(nullif(v_action ->> 'object_type', ''), p_table) end;
        if v_object not in ('companies', 'people', 'opportunities', 'tasks') then
          raise exception 'Unsupported object type: %', v_object;
        end if;
        v_target := coalesce(nullif(v_action ->> 'target_record_id', ''), p_record ->> 'id')::uuid;
        v_id := public.wf_update(v_object, v_target, v_org, v_fields);
        if v_id is null then
          raise exception 'Target record not found';
        end if;

      elsif v_type = 'create_task' then
        -- Empty form fields fall back to the defaults, as in the app.
        select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_fields
        from jsonb_each(v_fields) where value not in ('""'::jsonb, 'null'::jsonb);
        v_fields := jsonb_build_object('title', 'Auto-task from workflow', 'priority', 'medium',
                                       'status', 'pending', 'assigned_to', p_wf.created_by)
                    || v_fields
                    || jsonb_build_object('organization_id', v_org, 'created_by', p_wf.created_by);
        if not exists (select 1 from profiles
                       where id = (v_fields ->> 'assigned_to')::uuid and organization_id = v_org) then
          raise exception 'Assignee is not a member of this organization';
        end if;
        v_id := public.wf_insert('tasks', v_fields);

      elsif v_type = 'send_notification' then
        -- Notifications are delivered as low-priority tasks; with no
        -- recipients selected, the workflow's creator is notified.
        v_message := public.wf_render(coalesce(nullif(v_action ->> 'message', ''), 'Workflow triggered'),
                                      p_record, p_table, p_op);
        for v_recipient in
          select p.id from profiles p
          where p.organization_id = v_org
            and p.id in (
              select r::uuid from jsonb_array_elements_text(
                case when jsonb_typeof(v_action -> 'notify_users') = 'array'
                          and jsonb_array_length(v_action -> 'notify_users') > 0
                     then v_action -> 'notify_users'
                     else jsonb_build_array(p_wf.created_by) end) r)
        loop
          insert into tasks (title, description, assigned_to, priority, status, organization_id, created_by)
          values ('🔔 ' || v_message,
                  format('Auto-generated by workflow. Trigger: %s on %s', p_op, p_table),
                  v_recipient, 'low', 'pending', v_org, p_wf.created_by);
        end loop;

      else
        raise exception 'Unknown action type: %', coalesce(v_type, 'none');
      end if;

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'index', v_index, 'type', v_type, 'status', 'success', 'result_id', v_id));
    exception when others then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'index', v_index, 'type', v_type, 'status', 'error', 'error', sqlerrm));
      v_status := 'partial_failure';
      v_error  := format('Action %s failed: %s', v_index + 1, sqlerrm);
    end;

    v_index := v_index + 1;
  end loop;

  insert into workflow_runs (workflow_id, organization_id, trigger_event, actions_executed,
                             status, error_message, duration_ms, actions_run)
  values (p_wf.id, v_org,
          jsonb_build_object('table', p_table, 'event_type', p_op,
                             'record_id', p_record ->> 'id',
                             'record_name', coalesce(p_record ->> 'name', p_record ->> 'title')),
          v_results, v_status, v_error,
          (extract(epoch from clock_timestamp() - v_start) * 1000)::int, v_index);
end;
$$;

create or replace function public.run_workflows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wf  public.workflows;
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
begin
  -- Changes made by a workflow's own actions do not start more workflows.
  if pg_trigger_depth() > 1 or new.organization_id is null then
    return null;
  end if;

  for v_wf in
    select * from workflows
    where organization_id = new.organization_id and is_active and trigger_config is not null
    order by created_at
  loop
    if public.wf_matches(v_wf.trigger_config, tg_table_name, tg_op, v_new, v_old)
       and public.wf_conditions_ok(v_wf.trigger_config -> 'conditions', v_new)
    then
      begin
        perform public.wf_execute(v_wf, tg_table_name, tg_op, v_new);
      exception when others then
        -- A broken workflow must never block the user's own change.
        raise warning 'workflow % failed: %', v_wf.id, sqlerrm;
      end;
    end if;
  end loop;

  return null;
end;
$$;

drop trigger if exists run_workflows on public.companies;
drop trigger if exists run_workflows on public.people;
drop trigger if exists run_workflows on public.opportunities;
drop trigger if exists run_workflows on public.tasks;
create trigger run_workflows after insert or update on public.companies
  for each row execute function public.run_workflows();
create trigger run_workflows after insert or update on public.people
  for each row execute function public.run_workflows();
create trigger run_workflows after insert or update on public.opportunities
  for each row execute function public.run_workflows();
create trigger run_workflows after insert or update on public.tasks
  for each row execute function public.run_workflows();


-- ─────────────────────────────────────────────────────────────
-- 3. Internal functions are not part of the public API
-- ─────────────────────────────────────────────────────────────
revoke execute on function public.wf_render(text, jsonb, text, text)                from public, anon, authenticated;
revoke execute on function public.wf_render_fields(jsonb, jsonb, text, text)        from public, anon, authenticated;
revoke execute on function public.wf_condition_ok(jsonb, jsonb)                     from public, anon, authenticated;
revoke execute on function public.wf_conditions_ok(jsonb, jsonb)                    from public, anon, authenticated;
revoke execute on function public.wf_matches(jsonb, text, text, jsonb, jsonb)       from public, anon, authenticated;
revoke execute on function public.wf_insert(text, jsonb)                            from public, anon, authenticated;
revoke execute on function public.wf_update(text, uuid, uuid, jsonb)                from public, anon, authenticated;
revoke execute on function public.wf_execute(public.workflows, text, text, jsonb)   from public, anon, authenticated;
revoke execute on function public.run_workflows()                                   from public, anon, authenticated;
revoke execute on function public.handle_new_user()                                 from public, anon, authenticated;
revoke execute on function public.guard_profile_columns()                           from public, anon, authenticated;
revoke execute on function public.set_organization_id()                             from public, anon, authenticated;
revoke execute on function public.log_proposal_status_change()                      from public, anon, authenticated;

-- Called by signed-in users only.
revoke execute on function public.accept_invitation(uuid, text, text)     from public, anon;
revoke execute on function public.complete_google_signup(text, text, text) from public, anon;


-- ─────────────────────────────────────────────────────────────
-- 4. Pin search_path on flagged functions
-- ─────────────────────────────────────────────────────────────
alter function public.handle_updated_at()                  set search_path = public;
alter function public.touch_updated_at()                   set search_path = public;
alter function public.set_opportunity_stage_changed_at()   set search_path = public;
alter function public.update_updated_at_column()           set search_path = public;
alter function public.log_proposal_status_change()         set search_path = public;
alter function public.update_technician_forms_updated_at() set search_path = public;
alter function public.set_updated_at()                     set search_path = public;

commit;
