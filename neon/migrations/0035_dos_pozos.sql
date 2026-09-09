-- El gacha se parte en dos pozos: imágenes y títulos.
--
-- ── El pozo único estaba torcido, y no por un error ──
--
-- La 0031 unificó los dos artículos de la tienda argumentando que un pozo común
-- los volvía innecesarios. Su queja de verdad era otra —los dos artículos cobraban
-- 150 puntos y no entregaban nada— y eso quedó arreglado. Pero el pozo único trajo
-- una distorsión que se puede calcular:
--
-- De los 269 cosméticos sorteables, 189 son imágenes y **todas son comunes**. Como
-- la rareza se sortea primero con los pesos y después uniforme dentro de ella, el
-- resultado real es que común es 30% de las tiradas y dentro de común el 95% es
-- imagen. Es decir: ~71% de las tiradas entregaban título y ~29% imagen, y ninguna
-- imagen podía salir con brillo. Épica, legendaria y mítica eran siempre títulos.
--
-- Con dos pozos, el alumno elige en qué colección quiere avanzar, y cada pozo
-- reparte sus seis rarezas.
--
-- ── Una sola moneda, y el pozo se elige al tirar ──
--
-- `movimientos_tiradas` no se toca: la tirada sigue siendo una y se gasta donde el
-- alumno quiera. La alternativa —una moneda por pozo— obligaría a repartir los 30
-- niveles del pase entre los dos, a migrar los saldos que ya existen y a duplicar
-- el artículo de la tienda. Y peor: al que completó las imágenes le quedarían
-- tiradas muertas de un pozo que ya no le sirve. Con una moneda decide él.
--
-- ── Las imágenes dejan de ser todas comunes ──
--
-- Esto revierte a propósito una decisión que la 0024 dejó escrita: que las 220
-- compartieran rareza era lo que les daba la misma probabilidad entre sí. Con el
-- pozo aparte, esa misma decisión deja el sorteo sin nada que anunciar —cada
-- tirada de imagen saldría en gris, y la animación de la pantalla existe para
-- anunciar la rareza antes de mostrar el premio—. Así que ahora cada imagen tiene
-- la suya.
--
-- El reparto es **al azar y no curado**: un personaje secundario puede quedar
-- mítico y el protagonista común. Es lo que se pidió; curarlo por prominencia
-- necesita al docente, y son 220.
--
-- ── Por qué la rareza se deriva del código y no se sortea una vez ──
--
-- `subir-cosmeticos.mjs` se corre muchas veces mientras se arma la colección y hace
-- `set rareza = excluded.rareza` en cada corrida. Un `order by random()` de una sola
-- vez se lo llevaría a la primera subida, y —peor— la segunda corrida le cambiaría
-- la etiqueta a imágenes que el alumno ya tiene en su colección.
--
-- Por eso la rareza es una **función del código**: `rareza_de_imagen`. Estable para
-- siempre por ítem, y una imagen nueva nace con la suya sin que nadie decida nada.
--
-- ── Y por qué el pozo tiene omisión nula ──
--
-- `p_pozo` nulo es el pozo completo, como antes. No es una comodidad: es lo que
-- permite aplicar esta migración **antes** del despliegue sin que el sitio
-- publicado —que llama con un solo argumento— se caiga en el medio.

-- ============================== La rareza de una imagen ==============================
--
-- Los cortes están puestos sobre `md5 % 100`, que reparte parejo. No son números
-- redondos: están elegidos para que las 189 imágenes sacables de hoy caigan en
-- 62 / 49 / 39 / 24 / 11 / 4, que es el reparto que se quiere. Con tramos redondos
-- —34/26/20/12/6/2— el azar de estos 189 códigos dejaba **una sola** imagen mítica,
-- y una rareza con un ítem se agota en la primera tirada y desaparece del pozo: el
-- peso se reparte entre las demás y la promesa de la pantalla deja de cumplirse a
-- mitad de semestre.
--
-- Las funciones van calificadas con `pg_catalog` en vez de llevar `set search_path`:
-- así la función se puede seguir insertando en las consultas que la usan, que es lo
-- que hace que el `update` de más abajo y las consultas de la prueba sean baratos.

create or replace function public.rareza_de_imagen(p_codigo text)
returns text
language sql
immutable
as $$
  select case
           when n <  31 then 'comun'
           when n <  60 then 'poco_comun'
           when n <  79 then 'rara'
           when n <  92 then 'epica'
           when n <  96 then 'legendaria'
           else              'mitica'
         end
    from (select (('x' || pg_catalog.substr(pg_catalog.md5(p_codigo), 1, 8))
                    ::bit(32)::bigint % 100) as n) t;
$$;

comment on function public.rareza_de_imagen(text) is
  'La rareza que le toca a una imagen, derivada de su código. Estable: una imagen '
  'conserva la suya para siempre, y volver a correr subir-cosmeticos.mjs no la mueve.';

-- ============================== Repartir las que ya están ==============================
--
-- Las del pase quedan como están. La rareza es la etiqueta con que se anuncia un
-- sorteo, y lo del pase no se sortea: se puso a mano —René Puente es legendaria por
-- ser el premio final del semestre— y recalcularla sería pisarla.

update public.cosmeticos c
   set rareza = public.rareza_de_imagen(c.codigo)
 where c.activo
   and c.tipo = 'avatar'
   and not exists (select 1 from public.pase_recompensas pr where pr.cosmetico_id = c.id)
   and c.rareza <> public.rareza_de_imagen(c.codigo);

-- ============================== Tirar, en el pozo que se pida ==============================
--
-- Igual que la versión de la 0025 más el filtro por pozo, que entra en los dos
-- lugares donde se mira el pozo y no en uno: en el sorteo de **rareza** y en la
-- elección del ítem. Si entrara solo en el segundo, se sortearía «mítica» mirando
-- los dos pozos y después no habría mítica de ese tipo que entregar.
--
-- Se borra la de un argumento antes de crear la nueva. No es aseo: dejar las dos
-- convive mal —una llamada con un solo argumento calzaría con ambas y Postgres la
-- rechazaría por ambigua—, así que la compatibilidad viene de la omisión nula y no
-- de una sobrecarga.

drop function if exists public.gacha_tirar(uuid);

create or replace function public.gacha_tirar(p_matricula uuid, p_pozo text default null)
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

  if p_pozo is not null and p_pozo not in ('imagen', 'titulo') then
    raise exception 'Ese pozo no existe: %', p_pozo;
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
       and (p_pozo is null
            or (p_pozo = 'imagen' and c.tipo = 'avatar')
            or (p_pozo = 'titulo' and c.tipo = 'titulo'))
       and not exists (select 1 from public.alumno_cosmeticos ac
                        where ac.matricula_id = p_matricula and ac.cosmetico_id = c.id)
       -- Lo del pase se gana subiendo de nivel, no por suerte.
       and not exists (select 1 from public.pase_recompensas pr
                        where pr.cosmetico_id = c.id)
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

  -- Cada pozo se vacía por su cuenta, así que el aviso nombra el otro: si no, el
  -- alumno con veinte tiradas lee «ya tienes todo» y deja de tirar teniendo medio
  -- pozo por delante.
  if v_rareza is null then
    raise exception '%', case p_pozo
      when 'imagen' then 'Ya tienes todas las imágenes que se pueden sacar: lo que '
                         'falta es del pase. Prueba en los títulos.'
      when 'titulo' then 'Ya tienes todos los títulos que se pueden sacar: lo que '
                         'falta es del pase. Prueba en las imágenes.'
      else 'Ya tienes todo lo que se puede sacar acá: lo que falta es del pase'
    end;
  end if;

  select c.* into v_c
    from public.cosmeticos c
   where c.activo and c.rareza = v_rareza
     and (p_pozo is null
          or (p_pozo = 'imagen' and c.tipo = 'avatar')
          or (p_pozo = 'titulo' and c.tipo = 'titulo'))
     and not exists (select 1 from public.alumno_cosmeticos ac
                      where ac.matricula_id = p_matricula and ac.cosmetico_id = c.id)
     and not exists (select 1 from public.pase_recompensas pr
                      where pr.cosmetico_id = c.id)
   order by random()
   limit 1;

  insert into public.alumno_cosmeticos (matricula_id, cosmetico_id, origen)
  values (p_matricula, v_c.id, 'gacha');

  -- La tirada se gasta **después** de que hay algo que entregar, y acá **nunca se
  -- toca `movimientos_puntos`**: el gacha no reparte puntos.
  insert into public.movimientos_tiradas (matricula_id, cantidad, motivo)
  values (p_matricula, -1, 'Tirada: ' || v_c.nombre);

  return jsonb_build_object(
    'id', v_c.id, 'codigo', v_c.codigo, 'tipo', v_c.tipo, 'nombre', v_c.nombre,
    'descripcion', v_c.descripcion, 'valor', v_c.valor, 'rareza', v_c.rareza,
    'restantes', public.mis_tiradas(p_matricula));
end;
$$;

-- Borrar la función se llevó su grant, y reponerlo no es opcional: sin esto el
-- gacha deja de funcionar para el alumno en cuanto esto se aplica.
grant execute on function public.gacha_tirar(uuid, text) to pulso_app;

-- ============================== La tienda lo dice ==============================
-- El artículo sigue siendo uno —una moneda— pero su texto prometía «puede salir un
-- ícono o un título», que era la descripción del pozo único. Ahora el alumno elige.

update public.articulos
   set descripcion = 'Una tirada en el gacha. La gastas en el pozo que quieras: el de '
                     'imágenes o el de títulos, de cualquier rareza y de todo lo que '
                     'todavía no tengas. Lo del pase no entra: eso se gana subiendo de nivel.'
 where codigo = 'gacha-tirada';

-- ============================== Comprobación, en la misma transacción ==============================
-- Si algo de arriba no calzó, esto revienta y no queda a medias.

do $$
declare
  v_flacas text; v_desalineadas integer; v_rene text; v_viejas integer;
begin
  -- Ninguna rareza del pozo de imágenes puede quedar con menos de tres: con una o
  -- dos se agota en la primera tirada y desaparece del sorteo.
  select string_agg(g.nombre || ': ' || coalesce(x.n, 0), ', ' order by g.orden)
    into v_flacas
    from public.gacha_rarezas g
    left join (
      select c.rareza, count(*)::integer as n
        from public.cosmeticos c
       where c.activo and c.tipo = 'avatar'
         and not exists (select 1 from public.pase_recompensas pr where pr.cosmetico_id = c.id)
       group by c.rareza) x on x.rareza = g.rareza
   where coalesce(x.n, 0) < 3;
  if v_flacas is not null then
    raise exception 'El pozo de imágenes quedó con rarezas flacas: %', v_flacas;
  end if;

  select count(*) into v_desalineadas
    from public.cosmeticos c
   where c.activo and c.tipo = 'avatar'
     and not exists (select 1 from public.pase_recompensas pr where pr.cosmetico_id = c.id)
     and c.rareza <> public.rareza_de_imagen(c.codigo);
  if v_desalineadas > 0 then
    raise exception '% imágenes no quedaron con la rareza que les toca', v_desalineadas;
  end if;

  -- Y las del pase conservan la suya.
  select rareza into v_rene from public.cosmeticos where codigo = 'avatar-loco-rene';
  if v_rene is not null and v_rene <> 'legendaria' then
    raise exception 'El premio final del pase dejó de ser legendario: quedó %', v_rene;
  end if;

  -- La de un argumento no puede quedar viva: una llamada con un solo argumento
  -- calzaría con las dos y Postgres la rechazaría por ambigua.
  select count(*) into v_viejas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'gacha_tirar' and p.pronargs = 1;
  if v_viejas > 0 then
    raise exception 'Quedó viva la gacha_tirar de un argumento: la llamada corta sería ambigua';
  end if;
end $$;
