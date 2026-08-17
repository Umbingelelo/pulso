-- El gacha: gastar una tirada y sacar un cosmético.
--
-- El pase ya entregaba tiradas y no había dónde gastarlas —«todavía no hay
-- gacha», decía la 0014—. Acá está.
--
-- ── El sorteo es en dos pasos, y esa es la decisión que importa ──
--
-- Primero se sortea **la rareza** con los pesos de `gacha_rarezas`, y después se
-- elige **uniforme entre los cosméticos de esa rareza** que al alumno le faltan.
--
-- La alternativa —un peso por ítem y un solo sorteo— parece más simple y está
-- mal: hay 220 avatares comunes y 4 títulos míticos, así que el mítico saldría
-- una vez cada dos mil tiradas y no lo vería nadie en todo el semestre. Con dos
-- pasos, mítico es exactamente 1 de cada 100, sin importar cuántos avatares se
-- suban después.
--
-- Y de paso resuelve lo que se pidió para las imágenes: como dentro de la rareza
-- el sorteo es uniforme, **las 220 tienen exactamente la misma probabilidad entre
-- sí**, y seguirán teniéndola cuando sean 400.
--
-- ── Sin repetidos ──
--
-- Se sortea solo entre lo que al alumno le falta. Un gacha con repetidos necesita
-- algo que hacer con ellos —fragmentos, conversión a moneda— y eso es un sistema
-- entero. Con 320 cosméticos y las tiradas que reparte el pase, nadie va a
-- vaciar el pozo; y si alguien lo hace, se le dice y no se le gasta la tirada.
--
-- Por eso también la rareza se sortea **solo entre las que todavía tienen algo**:
-- si no, al que ya tiene los cuatro míticos le saldría «rareza mítica» un 1% de
-- las veces y no habría nada que entregarle.

-- ============================== La sexta rareza ==============================
-- Los títulos venían con «Mítico» y la tabla solo conocía cinco.

alter table public.cosmeticos drop constraint if exists cosmeticos_rareza_check;
alter table public.cosmeticos add constraint cosmeticos_rareza_check
  check (rareza in ('comun', 'poco_comun', 'rara', 'epica', 'legendaria', 'mitica'));

-- ============================== Los pesos ==============================
-- En tabla y no en un CASE dentro de la función, por lo mismo que los cosméticos
-- están en tabla: ajustar cuánto sale un legendario no puede pedir un despliegue.

create table if not exists public.gacha_rarezas (
  rareza text primary key
           check (rareza in ('comun', 'poco_comun', 'rara', 'epica', 'legendaria', 'mitica')),
  peso   integer not null check (peso > 0),
  -- Para la pantalla: el nombre y el color con que se muestra.
  nombre text not null,
  orden  integer not null
);

insert into public.gacha_rarezas (rareza, peso, nombre, orden) values
  ('comun',      30, 'Común',      1),
  ('poco_comun', 28, 'Poco común', 2),
  ('rara',       25, 'Rara',       3),
  ('epica',      12, 'Épica',      4),
  ('legendaria',  4, 'Legendaria', 5),
  ('mitica',      1, 'Mítica',     6)
on conflict (rareza) do update
  set peso = excluded.peso, nombre = excluded.nombre, orden = excluded.orden;

-- ============================== Cuántas tiradas tiene ==============================

create or replace function public.mis_tiradas(p_matricula uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(cantidad), 0)::integer
    from public.movimientos_tiradas where matricula_id = p_matricula;
$$;

-- ============================== Tirar ==============================

create or replace function public.gacha_tirar(p_matricula uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_saldo integer; v_dado numeric; v_rareza text; v_c public.cosmeticos;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  v_saldo := public.mis_tiradas(p_matricula);
  if v_saldo < 1 then
    raise exception 'No te quedan tiradas';
  end if;

  -- Un solo `random()` para el sorteo de rareza: llamarlo dentro de la comparación
  -- lo evaluaría una vez por fila y el sorteo dejaría de respetar los pesos.
  v_dado := random();

  with faltan as (
    select c.rareza, count(*)::integer as n
      from public.cosmeticos c
     where c.activo
       and not exists (select 1 from public.alumno_cosmeticos ac
                        where ac.matricula_id = p_matricula and ac.cosmetico_id = c.id)
     group by c.rareza
  ),
  acum as (
    select f.rareza, g.orden,
           sum(g.peso) over (order by g.orden)::numeric as hasta,
           sum(g.peso) over ()::numeric                 as total
      from faltan f join public.gacha_rarezas g on g.rareza = f.rareza
  )
  select a.rareza into v_rareza
    from acum a
   where v_dado * a.total < a.hasta
   order by a.orden
   limit 1;

  if v_rareza is null then
    raise exception 'Ya tienes todos los cosméticos: no queda nada que sacar';
  end if;

  select c.* into v_c
    from public.cosmeticos c
   where c.activo and c.rareza = v_rareza
     and not exists (select 1 from public.alumno_cosmeticos ac
                      where ac.matricula_id = p_matricula and ac.cosmetico_id = c.id)
   order by random()
   limit 1;

  insert into public.alumno_cosmeticos (matricula_id, cosmetico_id, origen)
  values (p_matricula, v_c.id, 'gacha');

  -- La tirada se gasta **después** de que hay algo que entregar. Si se gastara
  -- antes, un pozo vacío le costaría una tirada a cambio de nada.
  insert into public.movimientos_tiradas (matricula_id, cantidad, motivo)
  values (p_matricula, -1, 'Tirada: ' || v_c.nombre);

  return jsonb_build_object(
    'id', v_c.id, 'codigo', v_c.codigo, 'tipo', v_c.tipo, 'nombre', v_c.nombre,
    'descripcion', v_c.descripcion, 'valor', v_c.valor, 'rareza', v_c.rareza,
    'restantes', public.mis_tiradas(p_matricula));
end;
$$;

-- ============================== La colección ==============================
-- Todo el pozo, con lo que el alumno tiene marcado. Se muestra completo a
-- propósito: saber qué falta es la mitad de la gracia.

create or replace function public.mis_cosmeticos(p_matricula uuid)
returns table (
  id uuid, codigo text, tipo text, nombre text, descripcion text, valor text,
  rareza text, rareza_nombre text, rareza_orden integer, tengo boolean, equipado boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.codigo, c.tipo, c.nombre, c.descripcion, c.valor,
         c.rareza, g.nombre, g.orden,
         ac.matricula_id is not null,
         case c.tipo
           when 'titulo' then mt.titulo_id = c.id
           when 'marco'  then mt.marco_id  = c.id
           when 'avatar' then pf.avatar    = c.valor
           else false
         end
    from public.cosmeticos c
    join public.gacha_rarezas g on g.rareza = c.rareza
    join public.matriculas mt on mt.id = p_matricula
    join public.perfiles   pf on pf.id = mt.perfil_id
    left join public.alumno_cosmeticos ac
           on ac.cosmetico_id = c.id and ac.matricula_id = p_matricula
   where c.activo
     and (public.mi_matricula(p_matricula) or public.docente_ve_matricula(p_matricula))
   order by g.orden desc, c.tipo, c.nombre;
$$;

-- ============================== Equipar, ahora también avatares ==============================
--
-- El avatar vive en `perfiles` —es la cara de la persona, no del ramo— mientras
-- que los cosméticos se ganan por matrícula. Así que basta con haberlo ganado en
-- **cualquiera** de sus ramos: sería absurdo que la cara que se ganó en Cloud
-- Native no la pueda usar en Arquitectura.
--
-- Los títulos siguen siendo por ramo, que es lo correcto: el título habla de lo
-- que hizo en ese curso.

create or replace function public.equipar_cosmetico(p_matricula uuid, p_cosmetico uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_tipo text; v_valor text; v_perfil uuid;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  if p_cosmetico is null then
    update public.matriculas set titulo_id = null where id = p_matricula;
    return;
  end if;

  select tipo, valor into v_tipo, v_valor from public.cosmeticos where id = p_cosmetico;
  if v_tipo is null then raise exception 'Ese cosmético no existe'; end if;

  select perfil_id into v_perfil from public.matriculas where id = p_matricula;

  if v_tipo = 'avatar' then
    if not exists (
      select 1 from public.alumno_cosmeticos ac
        join public.matriculas m2 on m2.id = ac.matricula_id
       where ac.cosmetico_id = p_cosmetico and m2.perfil_id = v_perfil) then
      raise exception 'Todavía no has ganado eso';
    end if;
    update public.perfiles set avatar = v_valor where id = v_perfil;
    return;
  end if;

  if not exists (select 1 from public.alumno_cosmeticos
                  where matricula_id = p_matricula and cosmetico_id = p_cosmetico) then
    raise exception 'Todavía no has ganado eso';
  end if;

  if v_tipo = 'titulo' then
    update public.matriculas set titulo_id = p_cosmetico where id = p_matricula;
  elsif v_tipo = 'marco' then
    update public.matriculas set marco_id = p_cosmetico where id = p_matricula;
  else
    raise exception 'Ese cosmético no se equipa';
  end if;
end;
$$;

-- ============================== El avatar deja de elegirse a mano ==============================
--
-- Hasta ahora el alumno elegía un dibujo de DiceBear y la app escribía
-- `perfiles.avatar` directo por la Data API. Desde ahora la cara **se gana**, así
-- que ese camino se cierra donde no se puede rodear: **un grant por columna**.
--
-- No es una validación del cliente ni una pantalla escondida. `pulso_app` deja de
-- poder escribir esa columna, punto; el único camino que queda es
-- `equipar_cosmetico`, que es `security definer` y comprueba que se haya ganado.
-- Es el mismo mecanismo con que `clases.archivo` y `clases.pauta` quedan fuera del
-- alcance de la API.
--
-- El resto de `perfiles` se sigue escribiendo igual: el nombre es suyo.

revoke update on public.perfiles from pulso_app;
grant  update (nombre) on public.perfiles to pulso_app;

grant select on public.gacha_rarezas to pulso_app;

grant execute on function
  public.mis_tiradas(uuid),
  public.gacha_tirar(uuid),
  public.mis_cosmeticos(uuid)
  to pulso_app;
