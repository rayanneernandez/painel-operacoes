-- ============================================================================
-- SEED FICTÍCIO — Stellantis (POC JEEP - THE LED) — FASE 1 + devices
-- Gênero + volume + idade (planilha). Domingos sem dados.
-- Devices: Avenger > Renegade > Compass > Commander (+ entradas).
-- Horas espalhadas SEM pico. Tempo de atenção fixo ~6s.
-- Período: 2026-09-22 a 2026-10-22.
-- ============================================================================
delete from visitor_analytics        where client_id = '8b32886d-9cda-4423-b075-62c868254526';
delete from visitor_analytics_rollups where client_id = '8b32886d-9cda-4423-b075-62c868254526';
delete from visitor_total_cache       where client_id = '8b32886d-9cda-4423-b075-62c868254526';

do $$
declare
  v_client uuid := '8b32886d-9cda-4423-b075-62c868254526';
  v_pool bigint[] := array[]::bigint[]; v_dev bigint;
  v_avenger bigint; v_renegade bigint; v_compass bigint; v_commander bigint; v_ent1 bigint; v_ent2 bigint;
  v_dates date[]:=array['2026-09-22'::date,'2026-09-23'::date,'2026-09-24'::date,'2026-09-25'::date,'2026-09-26'::date,'2026-09-28'::date,'2026-09-29'::date,'2026-09-30'::date,'2026-10-01'::date,'2026-10-02'::date,'2026-10-03'::date,'2026-10-05'::date,'2026-10-06'::date,'2026-10-07'::date,'2026-10-08'::date,'2026-10-09'::date,'2026-10-10'::date,'2026-10-12'::date,'2026-10-13'::date,'2026-10-14'::date,'2026-10-15'::date,'2026-10-16'::date,'2026-10-17'::date,'2026-10-19'::date,'2026-10-20'::date,'2026-10-21'::date,'2026-10-22'::date]; v_max int[]:=array[63,42,55,62,113,42,66,45,58,65,116,46,70,49,62,69,120,43,67,46,59,66,117,36,60,39,52]; v_masc numeric[]:=array[0.7300,0.6900,0.6800,0.7400,0.7100,0.7300,0.6900,0.6400,0.7300,0.7000,0.7100,0.6700,0.7100,0.7200,0.6500,0.7100,0.6700,0.7400,0.6600,0.6500,0.7200,0.7100,0.6900,0.7100,0.6900,0.6700,0.7200];
  v_a1 numeric[]:=array[0.0200,0.0100,0.0100,0.0100,0.0100,0.0100,0.0100,0.0100,0.0200,0.0100,0.0200,0.0200,0.0100,0.0200,0.0100,0.0100,0.0100,0.0100,0.0200,0.0100,0.0100,0.0100,0.0200,0.0100,0.0100,0.0200,0.0100]; v_a2 numeric[]:=array[0.0800,0.1300,0.0600,0.0300,0.0400,0.0400,0.0600,0.0600,0.0800,0.0300,0.0800,0.0800,0.0300,0.0800,0.0600,0.0400,0.0600,0.0600,0.0800,0.0400,0.0300,0.0600,0.0800,0.0300,0.0400,0.0800,0.0600]; v_a3 numeric[]:=array[0.2400,0.3200,0.3000,0.3900,0.4300,0.4300,0.3000,0.3000,0.2400,0.3900,0.2300,0.2400,0.3900,0.2300,0.3000,0.4300,0.3000,0.3000,0.2300,0.4300,0.3900,0.3000,0.2300,0.3900,0.4300,0.2400,0.3000];
  v_a4 numeric[]:=array[0.4700,0.3700,0.4300,0.3900,0.4100,0.4100,0.4300,0.4300,0.4700,0.3900,0.4700,0.4700,0.3900,0.4700,0.4300,0.4100,0.4300,0.4300,0.4700,0.4100,0.3900,0.4300,0.4700,0.3900,0.4100,0.4700,0.4300]; v_a5 numeric[]:=array[0.1400,0.1100,0.1200,0.1600,0.1000,0.1000,0.1200,0.1200,0.1400,0.1600,0.1400,0.1400,0.1600,0.1400,0.1200,0.1000,0.1200,0.1200,0.1400,0.1000,0.1600,0.1200,0.1400,0.1600,0.1000,0.1400,0.1200]; v_a6 numeric[]:=array[0.0500,0.0600,0.0800,0.0200,0.0100,0.0100,0.0800,0.0800,0.0500,0.0200,0.0600,0.0500,0.0200,0.0600,0.0800,0.0100,0.0800,0.0800,0.0600,0.0100,0.0200,0.0800,0.0600,0.0200,0.0100,0.0500,0.0800];
  d int; i int; n int; males int; g int; a int; r numeric; dur int; att int; hr int; mn int; sc int;
  ts timestamptz; te timestamptz; age_lo int; age_hi int;
  hours int[] := array[10,11,12,13,14,15,16,17,18,19];
begin
  select d.external_id into v_avenger   from devices d join stores s on s.id=d.store_id where s.client_id=v_client and d.name ilike '%avenger%'   and d.external_id is not null limit 1;
  select d.external_id into v_renegade  from devices d join stores s on s.id=d.store_id where s.client_id=v_client and d.name ilike '%renegade%'  and d.external_id is not null limit 1;
  select d.external_id into v_compass   from devices d join stores s on s.id=d.store_id where s.client_id=v_client and d.name ilike '%compass%'   and d.external_id is not null limit 1;
  select d.external_id into v_commander from devices d join stores s on s.id=d.store_id where s.client_id=v_client and (d.name ilike '%commander%' or d.name ilike '%comando%') and d.external_id is not null limit 1;
  select d.external_id into v_ent1 from devices d join stores s on s.id=d.store_id where s.client_id=v_client and d.name ilike '%entrada 1%' and d.external_id is not null limit 1;
  select d.external_id into v_ent2 from devices d join stores s on s.id=d.store_id where s.client_id=v_client and d.name ilike '%entrada 2%' and d.external_id is not null limit 1;
  if v_avenger   is not null then v_pool := v_pool || array_fill(v_avenger,   array[34]); end if;
  if v_renegade  is not null then v_pool := v_pool || array_fill(v_renegade,  array[26]); end if;
  if v_compass   is not null then v_pool := v_pool || array_fill(v_compass,   array[18]); end if;
  if v_commander is not null then v_pool := v_pool || array_fill(v_commander, array[10]); end if;
  if v_ent1      is not null then v_pool := v_pool || array_fill(v_ent1,      array[6]);  end if;
  if v_ent2      is not null then v_pool := v_pool || array_fill(v_ent2,      array[6]);  end if;
  if array_length(v_pool,1) is null then
    select array_agg(d.external_id) into v_pool from devices d join stores s on s.id=d.store_id where s.client_id=v_client and d.external_id is not null;
  end if;
  if array_length(v_pool,1) is null then raise exception 'Nenhum device encontrado'; end if;

  for d in 1..array_length(v_dates,1) loop
    n := v_max[d]; males := round(n * v_masc[d]);
    for i in 1..n loop
      if i <= males then g := 1; else g := 2; end if;
      r := random();
      if    r < v_a1[d] then age_lo:=15; age_hi:=17;
      elsif r < v_a1[d]+v_a2[d] then age_lo:=18; age_hi:=24;
      elsif r < v_a1[d]+v_a2[d]+v_a3[d] then age_lo:=25; age_hi:=34;
      elsif r < v_a1[d]+v_a2[d]+v_a3[d]+v_a4[d] then age_lo:=35; age_hi:=44;
      elsif r < v_a1[d]+v_a2[d]+v_a3[d]+v_a4[d]+v_a5[d] then age_lo:=45; age_hi:=54;
      else age_lo:=55; age_hi:=64; end if;
      a := age_lo + floor(random()*(age_hi-age_lo+1));
      hr := hours[1 + floor(random()*array_length(hours,1))];
      mn := floor(random()*60); sc := floor(random()*60);
      ts := (v_dates[d]::timestamp + make_interval(hours=>hr, mins=>mn, secs=>sc)) at time zone 'UTC';
      dur := 60 + floor(random()*240);     -- permanência 1-5 min
      att := 5 + floor(random()*4);        -- ATENÇÃO fixa ~5-8s
      te := ts + make_interval(secs=>dur);
      v_dev := v_pool[1 + floor(random()*array_length(v_pool,1))];
      insert into visitor_analytics
        (visit_uid, client_id, device_id, timestamp, end_timestamp, age, gender,
         attributes, visit_time_seconds, dwell_time_seconds, contact_time_seconds, raw_data)
      values (
        gen_random_uuid()::text, v_client, v_dev, ts, te, a, g,
        jsonb_build_object('glasses', case when random()<0.12 then 'dark' else 'none' end,
          'facial_hair', case when g=1 and random()<0.5 then 'beard' else 'none' end,
          'hair_color', (array['black','brown','blond','gray'])[1+floor(random()*4)]),
        dur, dur, att,
        jsonb_build_object('tracks_duration', dur, 'content_view_duration', att,
          'sex', g, 'age', a, 'devices', jsonb_build_array(v_dev),
          'start', to_char(ts at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'end',   to_char(te at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
      );
    end loop;
  end loop;
  raise notice 'Seed concluido: % dias', array_length(v_dates,1);
end $$;

select count(*) total, round(100.0*sum((gender=1)::int)/count(*),1) pct_masc,
       round(avg(contact_time_seconds),1) atencao_media_s
from visitor_analytics where client_id='8b32886d-9cda-4423-b075-62c868254526';
