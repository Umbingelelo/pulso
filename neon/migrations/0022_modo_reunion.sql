-- Modo reunión: el docente está ocupado y la sección lo sabe.
--
-- Hay bloques en que el profesor está en reunión y no puede atender consultas.
-- Antes eso se avisaba de viva voz o no se avisaba, y el alumno lo descubría
-- levantando la mano. Ahora se declara: se enciende para una sección, a los
-- alumnos de esa sección les aparece en la barra que está en reunión, y **la
-- tienda de esa sección queda con 30% de descuento mientras dure**, como
-- compensación por la hora que no van a poder preguntar.
--
-- ── Por sección y no por asignatura ──
--
-- Una reunión ocurre en un bloque, y en un bloque hay una sección en sala. El
-- resto de las secciones de la misma asignatura está en su casa o en otro
-- horario, así que apagarles la tienda —o regalarles el descuento— no tendría
-- nada que ver con lo que les pasa. La sección ya determina la asignatura y el
-- periodo, así que con `seccion_id` alcanza para las dos cosas.
--
-- ── Por qué el descuento se guarda en la fila ──
--
-- `descuento` no es una constante del código: es un dato de **esta** reunión. Si
-- el semestre que viene el número cambia, las reuniones de este semestre siguen
-- diciendo lo que de verdad se cobró. Un canje viejo tiene que poder explicarse
-- con lo que había ese día, no con lo que hay hoy.
--
-- ── Lo que esto NO hace ──
--
-- No apaga nada. No bloquea la app, ni las clases, ni las misiones. Es un aviso
-- más un descuento: la parte de «no hagan ruido» la sostiene la sala, no el
-- software. Bloquear pantallas mientras el profesor no está disponible castigaría
-- justo a quien quiere seguir trabajando solo.

create table if not exists public.reuniones (
  id          bigserial primary key,
  seccion_id  uuid not null references public.secciones(id) on delete cascade,
  -- Porcentaje de descuento en la tienda mientras dure.
  descuento   integer not null default 30,
  inicio      timestamptz not null default now(),
  -- Nula mientras está en curso. Es la única marca de «abierta».
  fin         timestamptz,
  abierta_por uuid references public.usuarios(id),
  constraint reuniones_descuento_sano check (descuento between 0 and 90),
  constraint reuniones_fin_despues check (fin is null or fin >= inicio)
);

-- Una sola reunión abierta por sección. Sin esto, dos clics seguidos —o dos
-- pestañas— dejan dos filas abiertas y «terminar» cierra una sola: la sección
-- se queda con el descuento puesto y nadie entiende por qué.
create unique index if not exists ux_reunion_abierta
  on public.reuniones (seccion_id) where fin is null;

create index if not exists ix_reuniones_seccion on public.reuniones (seccion_id, inicio desc);

-- ============================== El descuento vigente ==============================
-- Una sola fuente de verdad para «cuánto se descuenta en esta sección ahora
-- mismo», que es lo que consultan la tienda y el canje.

create or replace function public.reunion_descuento(p_seccion uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(max(descuento), 0)::integer
    from public.reuniones
   where seccion_id = p_seccion and fin is null;
$$;

-- El precio que de verdad se cobra. Vive acá para que la tienda y `solicitar_canje`
-- no puedan discrepar: si la pantalla dice 70 y el cobro dice 100, el alumno
-- tiene razón en reclamar y nadie sabe cuál de los dos está mal.
--
-- Se redondea **hacia abajo**, a favor del alumno, y nunca baja de 1: un artículo
-- gratis por redondeo no es un descuento, es un error.
create or replace function public.precio_con_descuento(p_precio integer, p_descuento integer)
returns integer
language sql
immutable
as $$
  select case
           when p_precio is null then null
           when coalesce(p_descuento, 0) <= 0 then p_precio
           else greatest(1, floor(p_precio * (100 - p_descuento) / 100.0)::integer)
         end;
$$;

-- ============================== Lo que ve el alumno ==============================

create or replace function public.mi_reunion(p_matricula uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_seccion uuid; v_codigo text; v_r public.reuniones;
begin
  if not public.mi_matricula(p_matricula) and not public.docente_ve_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  select s.id, s.codigo into v_seccion, v_codigo
    from public.matriculas mt
    join public.secciones  s on s.id = mt.seccion_id
   where mt.id = p_matricula;
  if v_seccion is null then return null; end if;

  select * into v_r from public.reuniones
   where seccion_id = v_seccion and fin is null;

  return jsonb_build_object(
    'seccion',    v_codigo,
    'en_reunion', v_r.id is not null,
    'descuento',  coalesce(v_r.descuento, 0),
    'desde',      v_r.inicio);
end;
$$;

-- ============================== Encender y apagar ==============================

create or replace function public.reunion_iniciar(p_seccion uuid, p_descuento integer default 30)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_r public.reuniones;
begin
  if not public.docente_ve_seccion(p_seccion) then
    raise exception 'Esa sección no es de un ramo que dictes';
  end if;

  -- Encender dos veces no es un error del docente, es un doble clic. Se responde
  -- con lo que ya estaba en vez de reventar: reventar lo obligaría a averiguar si
  -- quedó encendida o no, en el minuto en que menos tiempo tiene.
  select * into v_r from public.reuniones where seccion_id = p_seccion and fin is null;
  if v_r.id is not null then
    return jsonb_build_object('en_reunion', true, 'ya_estaba', true,
                              'descuento', v_r.descuento, 'desde', v_r.inicio);
  end if;

  insert into public.reuniones (seccion_id, descuento, abierta_por)
  values (p_seccion, coalesce(p_descuento, 30), public.usuario_actual())
  returning * into v_r;

  return jsonb_build_object('en_reunion', true, 'ya_estaba', false,
                            'descuento', v_r.descuento, 'desde', v_r.inicio);
end;
$$;

create or replace function public.reunion_terminar(p_seccion uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_r public.reuniones;
begin
  if not public.docente_ve_seccion(p_seccion) then
    raise exception 'Esa sección no es de un ramo que dictes';
  end if;

  update public.reuniones set fin = now()
   where seccion_id = p_seccion and fin is null
  returning * into v_r;

  -- Igual que al encender: apagar algo que ya estaba apagado es el resultado que
  -- el docente quería, no una falla.
  if v_r.id is null then
    return jsonb_build_object('en_reunion', false, 'no_habia', true);
  end if;

  return jsonb_build_object('en_reunion', false, 'no_habia', false,
                            'desde', v_r.inicio, 'hasta', v_r.fin,
                            'minutos', round(extract(epoch from (v_r.fin - v_r.inicio)) / 60)::integer);
end;
$$;

-- ============================== Lo que ve el docente ==============================
-- Sus secciones con el estado de reunión de cada una, que es lo que dibuja los
-- botones de encender y apagar.

create or replace function public.reuniones_que_dicto(p_asignatura uuid, p_periodo uuid)
returns table (
  seccion_id uuid, codigo text, matriculados integer,
  en_reunion boolean, descuento integer, desde timestamptz, minutos integer
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.codigo,
         (select count(*)::integer from public.matriculas mt
           where mt.seccion_id = s.id and mt.activa),
         r.id is not null,
         coalesce(r.descuento, 0),
         r.inicio,
         case when r.id is null then null
              else round(extract(epoch from (now() - r.inicio)) / 60)::integer end
    from public.secciones s
    left join public.reuniones r on r.seccion_id = s.id and r.fin is null
   where s.asignatura_id = p_asignatura and s.periodo_id = p_periodo
     and public.docente_ve_seccion(s.id)
   order by s.codigo;
$$;

-- ============================== El canje, con el descuento ==============================
-- Igual que antes salvo el precio: se calcula con `precio_con_descuento` y ese es
-- el que se compara contra el saldo, el que se guarda en `precio_pagado` y el que
-- se descuenta. Guardar el precio ya rebajado es lo que hace que la devolución de
-- `resolver_canje` y `cancelar_canje` siga siendo correcta sin tocarlas: devuelven
-- lo que la fila dice que se pagó.
--
-- Y el motivo del movimiento deja constancia del descuento. Sin eso, el alumno
-- mira «Mis puntos» un mes después, ve que un artículo de 100 le costó 70, y no
-- hay nada en la pantalla que lo explique.

create or replace function public.solicitar_canje(
  p_matricula uuid, p_articulo uuid, p_nota text default null)
returns bigint language plpgsql volatile security definer set search_path = public as $$
declare
  a public.articulos%rowtype; v_saldo integer; v_mios integer; v_todos integer;
  v_estado text; v_canje bigint;
  v_seccion uuid; v_desc integer; v_precio integer;
begin
  if not public.mi_matricula(p_matricula) then
    raise exception 'Esa matrícula no es tuya';
  end if;

  select * into a from public.articulos where id = p_articulo;
  if a.id is null or not a.activo then
    raise exception 'Ese artículo no está disponible';
  end if;

  select s.id into v_seccion
    from public.matriculas mt join public.secciones s on s.id = mt.seccion_id
   where mt.id = p_matricula and mt.activa
     and s.asignatura_id = a.asignatura_id and s.periodo_id = a.periodo_id;
  if v_seccion is null then
    raise exception 'Ese artículo no es de este ramo';
  end if;

  if a.precio is null then
    raise exception 'Ese artículo todavía no tiene precio';
  end if;

  v_desc   := public.reunion_descuento(v_seccion);
  v_precio := public.precio_con_descuento(a.precio, v_desc);

  select coalesce(sum(puntos), 0) into v_saldo
    from public.movimientos_puntos where matricula_id = p_matricula;
  if v_saldo < v_precio then
    raise exception 'No te alcanzan los puntos: cuesta % y tienes %', v_precio, v_saldo;
  end if;

  select count(*) into v_mios from public.canjes
   where articulo_id = p_articulo and matricula_id = p_matricula
     and estado in ('solicitado','aprobado','entregado');
  if a.limite_por_alumno is not null and v_mios >= a.limite_por_alumno then
    raise exception 'Ya alcanzaste el máximo de % para este artículo', a.limite_por_alumno;
  end if;

  if a.stock is not null then
    select count(*) into v_todos from public.canjes
     where articulo_id = p_articulo and estado in ('solicitado','aprobado','entregado');
    if v_todos >= a.stock then raise exception 'Se agotó'; end if;
  end if;

  v_estado := case when a.requiere_aprobacion then 'solicitado' else 'entregado' end;

  insert into public.canjes (articulo_id, matricula_id, estado, precio_pagado, nota_alumno, resuelto_en)
  values (p_articulo, p_matricula, v_estado, v_precio, nullif(trim(p_nota), ''),
          case when v_estado = 'entregado' then now() end)
  returning id into v_canje;

  -- Se descuenta al solicitar, no al aprobar: así nadie compromete el mismo
  -- saldo dos veces mientras espera respuesta.
  insert into public.movimientos_puntos (matricula_id, puntos, motivo)
  values (p_matricula, -v_precio,
          'Canje: ' || a.nombre ||
          case when v_desc > 0 then ' (−' || v_desc || '% por reunión)' else '' end);

  return v_canje;
end;
$$;

-- ============================== Permisos ==============================

alter table public.reuniones enable row level security;

-- Sin política de select y sin grant sobre la tabla, a propósito: el alumno la lee
-- por `mi_reunion()` y el docente por `reuniones_que_dicto()`, las dos con su
-- comprobación adentro. Una tabla sin grant es una tabla que un error de la API no
-- puede filtrar ni tocar.

grant execute on function
  public.reunion_descuento(uuid),
  public.precio_con_descuento(integer, integer),
  public.mi_reunion(uuid),
  public.reunion_iniciar(uuid, integer),
  public.reunion_terminar(uuid),
  public.reuniones_que_dicto(uuid, uuid)
  to pulso_app;
