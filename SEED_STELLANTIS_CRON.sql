-- 1) pg_cron
create extension if not exists pg_cron;

-- 2) funcao do seed (seg-SAB 08-18h, 1 dia de delay, 20-30min, deterministico)
create or replace function public.seed_stellantis() returns void language plpgsql as $fn$
declare
  v_client uuid := '8b32886d-9cda-4423-b075-62c868254526';
  v_pool bigint[] := array[]::bigint[]; v_dev bigint;
  v_av bigint; v_re bigint; v_co bigint; v_cm bigint;
  hw numeric[] := array[0,0,0,0,0,0,0,0,4.0,7.3,8.2,8.4,9.1,9.4,10.3,11.0,9.8,8.2,5.4,0,0,0,0,0]; hwtot numeric := 0;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_dates date[]:=array['2026-09-22'::date,'2026-09-23'::date,'2026-09-24'::date,'2026-09-25'::date,'2026-09-26'::date,'2026-09-28'::date,'2026-09-29'::date,'2026-09-30'::date,'2026-10-01'::date,'2026-10-02'::date,'2026-10-03'::date,'2026-10-05'::date,'2026-10-06'::date,'2026-10-07'::date,'2026-10-08'::date,'2026-10-09'::date,'2026-10-10'::date,'2026-10-12'::date,'2026-10-13'::date,'2026-10-14'::date,'2026-10-15'::date,'2026-10-16'::date,'2026-10-17'::date,'2026-10-19'::date,'2026-10-20'::date,'2026-10-21'::date,'2026-10-22'::date];
  v_max int[]:=array[63,42,55,62,113,42,66,45,58,65,116,46,70,49,62,69,120,43,67,46,59,66,117,36,60,39,52];
  v_masc numeric[]:=array[0.73,0.69,0.68,0.74,0.71,0.73,0.69,0.64,0.73,0.70,0.71,0.67,0.71,0.72,0.65,0.71,0.67,0.74,0.66,0.65,0.72,0.71,0.69,0.71,0.69,0.67,0.72];
  v_a1 numeric[]:=array[0.02,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.02,0.01,0.02,0.02,0.01,0.02,0.01,0.01,0.01,0.01,0.02,0.01,0.01,0.01,0.02,0.01,0.01,0.02,0.01]; v_a2 numeric[]:=array[0.08,0.13,0.06,0.03,0.04,0.04,0.06,0.06,0.08,0.03,0.08,0.08,0.03,0.08,0.06,0.04,0.06,0.06,0.08,0.04,0.03,0.06,0.08,0.03,0.04,0.08,0.06]; v_a3 numeric[]:=array[0.24,0.32,0.30,0.39,0.43,0.43,0.30,0.30,0.24,0.39,0.23,0.24,0.39,0.23,0.30,0.43,0.30,0.30,0.23,0.43,0.39,0.30,0.23,0.39,0.43,0.24,0.30];
  v_a4 numeric[]:=array[0.47,0.37,0.43,0.39,0.41,0.41,0.43,0.43,0.47,0.39,0.47,0.47,0.39,0.47,0.43,0.41,0.43,0.43,0.47,0.41,0.39,0.43,0.47,0.39,0.41,0.47,0.43]; v_a5 numeric[]:=array[0.14,0.11,0.12,0.16,0.10,0.10,0.12,0.12,0.14,0.16,0.14,0.14,0.16,0.14,0.12,0.10,0.12,0.12,0.14,0.10,0.16,0.12,0.14,0.16,0.10,0.14,0.12]; v_a6 numeric[]:=array[0.05,0.06,0.08,0.02,0.01,0.01,0.08,0.08,0.05,0.02,0.06,0.05,0.02,0.06,0.08,0.01,0.08,0.08,0.06,0.01,0.02,0.08,0.06,0.02,0.01,0.05,0.08];
  d int; i int; k int; n int; males int; g int; ag int; r numeric; acc numeric;
  hr int; mn int; sc int; dur int; att int; ts timestamptz; te timestamptz; lo int; hi int;
begin
  delete from visitor_analytics        where client_id=v_client;
  delete from visitor_analytics_rollups where client_id=v_client::text;
  delete from visitor_total_cache       where client_id=v_client;
  select external_id into v_av from devices d join stores s on s.id=d.store_id where s.client_id=v_client and d.name ilike '%avenger%' limit 1;
  select external_id into v_re from devices d join stores s on s.id=d.store_id where s.client_id=v_client and d.name ilike '%renegade%' limit 1;
  select external_id into v_co from devices d join stores s on s.id=d.store_id where s.client_id=v_client and d.name ilike '%compass%' limit 1;
  select external_id into v_cm from devices d join stores s on s.id=d.store_id where s.client_id=v_client and (d.name ilike '%commander%' or d.name ilike '%comando%') limit 1;
  if v_av is not null then v_pool := v_pool || array_fill(v_av, array[34]); end if;
  if v_re is not null then v_pool := v_pool || array_fill(v_re, array[26]); end if;
  if v_co is not null then v_pool := v_pool || array_fill(v_co, array[18]); end if;
  if v_cm is not null then v_pool := v_pool || array_fill(v_cm, array[10]); end if;
  if array_length(v_pool,1) is null then
    select array_agg(external_id) into v_pool from devices d join stores s on s.id=d.store_id where s.client_id=v_client and external_id is not null;
  end if;
  if array_length(v_pool,1) is null then return; end if;
  for k in 1..24 loop hwtot := hwtot + hw[k]; end loop;
  for d in 1..array_length(v_dates,1) loop
    if v_dates[d] >= v_today then continue; end if;
    if extract(dow from v_dates[d]) = 0 then continue; end if;
    perform setseed( (('x'||substr(md5(v_dates[d]::text),1,8))::bit(32)::int)/2147483648.0 );
    n := v_max[d]; males := round(n*v_masc[d]);
    for i in 1..n loop
      if i<=males then g:=1; else g:=2; end if;
      r:=random();
      if    r<v_a1[d] then lo:=15;hi:=17;
      elsif r<v_a1[d]+v_a2[d] then lo:=18;hi:=24;
      elsif r<v_a1[d]+v_a2[d]+v_a3[d] then lo:=25;hi:=34;
      elsif r<v_a1[d]+v_a2[d]+v_a3[d]+v_a4[d] then lo:=35;hi:=44;
      elsif r<v_a1[d]+v_a2[d]+v_a3[d]+v_a4[d]+v_a5[d] then lo:=45;hi:=54;
      else lo:=55;hi:=64; end if;
      ag := lo + floor(random()*(hi-lo+1));
      r := random()*hwtot; acc:=0; hr:=12;
      for k in 1..24 loop acc:=acc+hw[k]; if hw[k]>0 and r<=acc then hr:=k-1; exit; end if; end loop;
      mn := floor(random()*60); sc := floor(random()*60);
      ts := (v_dates[d]::timestamp + make_interval(hours=>hr, mins=>mn, secs=>sc)) at time zone 'America/Sao_Paulo';
      dur := 1200 + floor(random()*601);
      att := round(dur * (0.60 + random()*0.10));
      te := ts + make_interval(secs=>dur);
      v_dev := v_pool[1+floor(random()*array_length(v_pool,1))];
      insert into visitor_analytics
        (visit_uid,client_id,device_id,timestamp,end_timestamp,age,gender,attributes,visit_time_seconds,dwell_time_seconds,contact_time_seconds,raw_data)
      values (gen_random_uuid()::text, v_client, v_dev, ts, te, ag, g,
        jsonb_build_object('glasses', case when random()<0.12 then 'dark' else 'none' end,
          'facial_hair', case when g=1 and random()<0.5 then 'beard' else 'none' end,
          'hair_color', (array['black','brown','blond','gray'])[1+floor(random()*4)]),
        dur, dur, att,
        jsonb_build_object('tracks_duration',dur,'content_view_duration',att,'sex',g,'age',ag,
          'devices', jsonb_build_array(v_dev),
          'start', to_char(ts at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'end',   to_char(te at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')));
    end loop;
  end loop;
end;
$fn$;

-- 3) roda agora
select public.seed_stellantis();

-- 4) agenda diaria 03:10 UTC (00:10 BRT). Remove job antigo antes, se existir.
select cron.unschedule('seed_stellantis_daily') where exists (select 1 from cron.job where jobname='seed_stellantis_daily');
select cron.schedule('seed_stellantis_daily','10 3 * * *', $$select public.seed_stellantis();$$);

-- 5) conferencia
select count(*) total, min(timestamp) primeira, max(timestamp) ultima,
  round((avg(visit_time_seconds)/60.0)::numeric,1) visita_min, round((avg(contact_time_seconds)/60.0)::numeric,1) atencao_min
from visitor_analytics where client_id='8b32886d-9cda-4423-b075-62c868254526';
