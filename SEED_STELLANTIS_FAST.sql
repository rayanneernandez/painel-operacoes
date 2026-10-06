create or replace function public.seed_stellantis() returns void language plpgsql as $fn$
declare
  v_cid text := '8b32886d-9cda-4423-b075-62c868254526';
  v_client uuid := v_cid::uuid;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_av bigint; v_re bigint; v_co bigint; v_cm bigint;
begin
  delete from visitor_analytics        where client_id::text = v_cid;
  delete from visitor_analytics_rollups where client_id::text = v_cid;
  delete from visitor_total_cache       where client_id::text = v_cid;
  select external_id into v_av from devices d join stores s on s.id=d.store_id where s.client_id::text=v_cid and d.name ilike '%avenger%' limit 1;
  select external_id into v_re from devices d join stores s on s.id=d.store_id where s.client_id::text=v_cid and d.name ilike '%renegade%' limit 1;
  select external_id into v_co from devices d join stores s on s.id=d.store_id where s.client_id::text=v_cid and d.name ilike '%compass%' limit 1;
  select external_id into v_cm from devices d join stores s on s.id=d.store_id where s.client_id::text=v_cid and (d.name ilike '%commander%' or d.name ilike '%comando%') limit 1;

  insert into visitor_analytics
    (visit_uid,client_id,device_id,timestamp,end_timestamp,age,gender,attributes,visit_time_seconds,dwell_time_seconds,contact_time_seconds,raw_data)
  select gen_random_uuid()::text, v_client, dev, ts, ts + make_interval(secs=>dur), ag, g,
    jsonb_build_object('glasses', case when rg<0.12 then 'dark' else 'none' end,
      'facial_hair', case when g=1 and rfh<0.5 then 'beard' else 'none' end,
      'hair_color', (array['black','brown','blond','gray'])[1+least(3,floor(rhc*4)::int)]),
    dur, dur, att,
    jsonb_build_object('tracks_duration',dur,'content_view_duration',att,'sex',g,'age',ag,'devices',jsonb_build_array(dev))
  from (
    select
      (dt::timestamp + make_interval(hours=>hh, mins=>least(59,floor(rmi*60)::int), secs=>least(59,floor(rse*60)::int))) at time zone 'America/Sao_Paulo' as ts,
      ag, g, dur, (round(dur*(0.60+rat*0.10)))::int as att, rg, rfh, rhc,
      case when rde<0.38636 then v_av when rde<0.68182 then v_re when rde<0.88636 then v_co else v_cm end as dev
    from (
      select dt,i,
        case when i <= round(mx*masc) then 1 else 2 end as g,
        (1200 + floor(rdu*601))::int as dur,
        rg,rfh,rhc,rmi,rse,rat,rde,hh,
        case
          when rag<a1 then 15+least(2,floor(ra2*3)::int)
          when rag<a1+a2 then 18+least(6,floor(ra2*7)::int)
          when rag<a1+a2+a3 then 25+least(9,floor(ra2*10)::int)
          when rag<a1+a2+a3+a4 then 35+least(9,floor(ra2*10)::int)
          when rag<a1+a2+a3+a4+a5 then 45+least(9,floor(ra2*10)::int)
          else 55+least(9,floor(ra2*10)::int) end as ag
      from (
        select dt,i,mx,masc,a1,a2,a3,a4,a5,
          (('x'||substr(md5(dt||'-'||i||'-g'),1,8))::bit(32)::int & 2147483647)::numeric/2147483647.0 as rg, (('x'||substr(md5(dt||'-'||i||'-fh'),1,8))::bit(32)::int & 2147483647)::numeric/2147483647.0 as rfh, (('x'||substr(md5(dt||'-'||i||'-hc'),1,8))::bit(32)::int & 2147483647)::numeric/2147483647.0 as rhc,
          (('x'||substr(md5(dt||'-'||i||'-mi'),1,8))::bit(32)::int & 2147483647)::numeric/2147483647.0 as rmi, (('x'||substr(md5(dt||'-'||i||'-se'),1,8))::bit(32)::int & 2147483647)::numeric/2147483647.0 as rse, (('x'||substr(md5(dt||'-'||i||'-du'),1,8))::bit(32)::int & 2147483647)::numeric/2147483647.0 as rdu,
          (('x'||substr(md5(dt||'-'||i||'-at'),1,8))::bit(32)::int & 2147483647)::numeric/2147483647.0 as rat, (('x'||substr(md5(dt||'-'||i||'-de'),1,8))::bit(32)::int & 2147483647)::numeric/2147483647.0 as rde, (('x'||substr(md5(dt||'-'||i||'-ag'),1,8))::bit(32)::int & 2147483647)::numeric/2147483647.0 as rag, (('x'||substr(md5(dt||'-'||i||'-a2'),1,8))::bit(32)::int & 2147483647)::numeric/2147483647.0 as ra2,
          (case when (('x'||substr(md5(dt||'-'||i||'-h'),1,8))::bit(32)::int & 2147483647)::numeric/2147483647.0<0.04391 then 8 when (('x'||substr(md5(dt||'-'||i||'-h'),1,8))::bit(32)::int & 2147483647)::numeric/2147483647.0<0.12404 then 9 when (('x'||substr(md5(dt||'-'||i||'-h'),1,8))::bit(32)::int & 2147483647)::numeric/2147483647.0<0.21405 then 10 when (('x'||substr(md5(dt||'-'||i||'-h'),1,8))::bit(32)::int & 2147483647)::numeric/2147483647.0<0.30626 then 11 when (('x'||substr(md5(dt||'-'||i||'-h'),1,8))::bit(32)::int & 2147483647)::numeric/2147483647.0<0.40615 then 12 when (('x'||substr(md5(dt||'-'||i||'-h'),1,8))::bit(32)::int & 2147483647)::numeric/2147483647.0<0.50933 then 13 when (('x'||substr(md5(dt||'-'||i||'-h'),1,8))::bit(32)::int & 2147483647)::numeric/2147483647.0<0.62239 then 14 when (('x'||substr(md5(dt||'-'||i||'-h'),1,8))::bit(32)::int & 2147483647)::numeric/2147483647.0<0.74314 then 15 when (('x'||substr(md5(dt||'-'||i||'-h'),1,8))::bit(32)::int & 2147483647)::numeric/2147483647.0<0.85071 then 16 when (('x'||substr(md5(dt||'-'||i||'-h'),1,8))::bit(32)::int & 2147483647)::numeric/2147483647.0<0.94072 then 17 else 18 end) as hh
        from (
          select dt,mx,masc,a1,a2,a3,a4,a5, gs.i
          from unnest(
            array['2026-09-22'::date,'2026-09-23'::date,'2026-09-24'::date,'2026-09-25'::date,'2026-09-26'::date,'2026-09-28'::date,'2026-09-29'::date,'2026-09-30'::date,'2026-10-01'::date,'2026-10-02'::date,'2026-10-03'::date,'2026-10-05'::date,'2026-10-06'::date,'2026-10-07'::date,'2026-10-08'::date,'2026-10-09'::date,'2026-10-10'::date,'2026-10-12'::date,'2026-10-13'::date,'2026-10-14'::date,'2026-10-15'::date,'2026-10-16'::date,'2026-10-17'::date,'2026-10-19'::date,'2026-10-20'::date,'2026-10-21'::date,'2026-10-22'::date],
            array[63,42,55,62,113,42,66,45,58,65,116,46,70,49,62,69,120,43,67,46,59,66,117,36,60,39,52]::int[],
            array[0.73,0.69,0.68,0.74,0.71,0.73,0.69,0.64,0.73,0.70,0.71,0.67,0.71,0.72,0.65,0.71,0.67,0.74,0.66,0.65,0.72,0.71,0.69,0.71,0.69,0.67,0.72]::numeric[],
            array[0.02,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.02,0.01,0.02,0.02,0.01,0.02,0.01,0.01,0.01,0.01,0.02,0.01,0.01,0.01,0.02,0.01,0.01,0.02,0.01]::numeric[], array[0.08,0.13,0.06,0.03,0.04,0.04,0.06,0.06,0.08,0.03,0.08,0.08,0.03,0.08,0.06,0.04,0.06,0.06,0.08,0.04,0.03,0.06,0.08,0.03,0.04,0.08,0.06]::numeric[],
            array[0.24,0.32,0.30,0.39,0.43,0.43,0.30,0.30,0.24,0.39,0.23,0.24,0.39,0.23,0.30,0.43,0.30,0.30,0.23,0.43,0.39,0.30,0.23,0.39,0.43,0.24,0.30]::numeric[], array[0.47,0.37,0.43,0.39,0.41,0.41,0.43,0.43,0.47,0.39,0.47,0.47,0.39,0.47,0.43,0.41,0.43,0.43,0.47,0.41,0.39,0.43,0.47,0.39,0.41,0.47,0.43]::numeric[], array[0.14,0.11,0.12,0.16,0.10,0.10,0.12,0.12,0.14,0.16,0.14,0.14,0.16,0.14,0.12,0.10,0.12,0.12,0.14,0.10,0.16,0.12,0.14,0.16,0.10,0.14,0.12]::numeric[]
          ) as t(dt,mx,masc,a1,a2,a3,a4,a5)
          cross join lateral generate_series(1,t.mx) as gs(i)
          where dt < v_today and extract(dow from dt) <> 0
        ) s0
      ) s1
    ) s2
  ) s3;
end;
$fn$;