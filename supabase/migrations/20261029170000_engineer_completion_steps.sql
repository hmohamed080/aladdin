-- Engineer-specific saved requirements; preserve every other persona formula.
alter function app.profile_completion(uuid) rename to profile_completion_before_engineer_steps;
create function app.profile_completion(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles; i public.individual_onboarding; checks boolean[]; keys text[]; missing text[] := '{}'; done int := 0; n int; sections boolean[];
begin
 if coalesce(app.effective_persona(p_user_id)::text, (select selected_persona::text from public.onboarding_progress where user_id=p_user_id), '') <> 'engineer' then
   return app.profile_completion_before_engineer_steps(p_user_id);
 end if;
 select * into p from public.profiles where user_id=p_user_id;
 select * into i from public.individual_onboarding where user_id=p_user_id;
 checks := array[
   p.display_name_confirmed_at is not null,
   p.avatar_media_id is not null,
   nullif(btrim(i.prof_governorate),'') is not null,
   nullif(btrim(i.prof_city),'') is not null,
   nullif(btrim(p.headline),'') is not null,
   i.prof_years_experience is not null,
   i.prof_specialization in ('architecture','civil'),
   nullif(btrim(p.bio),'') is not null,
   cardinality(i.prof_services)>0,
   p.availability_updated_at is not null,
   p.availability_updated_at is not null and (p.available_for_work=false or nullif(i.prof_availability,'') is not null),
   exists(select 1 from public.portfolio_items where owner_user_id=p_user_id and state='ready')
 ];
 keys:=array['display_name','avatar','governorate','city','headline','years_experience','specialization','bio','services','work_status','readiness','portfolio'];
 for n in 1..12 loop
   checks[n]:=coalesce(checks[n],false);
   if checks[n] then done:=done+1; else missing:=array_append(missing,keys[n]); end if;
 end loop;
 sections:=array[checks[1] and checks[2] and checks[3] and checks[4], checks[5] and checks[6] and checks[7] and checks[8] and checks[9], checks[10] and checks[11], checks[12]];
 return jsonb_build_object('percent',round(done*100.0/12),'missing',to_jsonb(missing),'sections',to_jsonb(sections));
end; $$;
revoke all on function app.profile_completion(uuid) from public, anon, authenticated;
