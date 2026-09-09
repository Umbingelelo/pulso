-- «Del pase» es global, y la colección lo decía por ramo.
--
-- ── La cuenta que no cuadraba ──
--
-- `gacha_tirar` excluye del pozo **todo** lo que sea recompensa de un pase, de
-- cualquier asignatura: el `not exists` sobre `pase_recompensas` no mira el ramo.
-- Es lo correcto —un cosmético que es premio del pase en Cloud Native no puede
-- salir por suerte en Arquitectura, o deja de ser un premio para el que lo ganó—.
--
-- Pero `mis_cosmeticos` calculaba `del_pase` **por ramo**: el `left join lateral`
-- filtra por `p.asignatura_id = s.asignatura_id`, así que un premio del pase de la
-- otra asignatura llegaba a la pantalla con `del_pase = false`. Medido contra la
-- base, para el alumno de prueba en DSY1107:
--
--   la pantalla decía que podía sacar   204 imágenes y 94 títulos
--   el gacha podía entregar de verdad   189 imágenes y 80 títulos
--
-- Son 15 imágenes y 14 títulos que la colección ofrecía y el pozo no tenía. Y no
-- falla en ninguna parte: el alumno filtra por «Puedo sacarlo», ve 204, tira
-- doscientas veces y nunca le salen esos quince. Es justo lo que ese filtro
-- existía para evitar.
--
-- ── El arreglo separa las dos preguntas, que no son la misma ──
--
-- «¿Esto sale tirando?» es **global**: si está en la escalera de cualquier pase,
-- no está en el pozo. «¿En qué nivel me toca?» es **por ramo**, y eso se queda
-- como estaba: el mismo cosmético puede estar en otro nivel en otra asignatura, y
-- decirle a alguien de DSY1107 el nivel que tiene en ITY1102 sería mentirle.
--
-- Así que `del_pase` pasa a ser un `exists` global y `nivel_pase` sigue saliendo
-- del lateral por ramo. Cuando el premio es de otro pase, la pieza queda marcada
-- «Pase» sin nivel — que es exactamente lo que la pantalla ya hace con un nivel
-- nulo, así que no hay que tocar el componente.
--
-- La forma que devuelve no cambia, así que va con `create or replace` y no hay que
-- reponer grants: es un `drop` lo que se los lleva.

create or replace function public.mis_cosmeticos(p_matricula uuid)
returns table (
  id uuid, codigo text, tipo text, nombre text, descripcion text, valor text,
  rareza text, rareza_nombre text, rareza_orden integer,
  tengo boolean, equipado boolean, del_pase boolean, nivel_pase integer
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
         end,
         -- Global, igual que el filtro de `gacha_tirar`: si está en la escalera de
         -- cualquier pase, no sale tirando. Que la pantalla y el sorteo usen la
         -- misma condición es lo que hace que la cuenta cuadre.
         exists (select 1 from public.pase_recompensas pr where pr.cosmetico_id = c.id),
         -- El nivel sí es el del pase de **su** ramo. Nulo cuando el premio es de
         -- otra asignatura: ahí se sabe que no sale tirando, pero no en qué nivel
         -- le tocaría, porque en este ramo no le toca en ninguno.
         pr.nivel
    from public.cosmeticos c
    join public.gacha_rarezas g on g.rareza = c.rareza
    join public.matriculas mt on mt.id = p_matricula
    join public.perfiles   pf on pf.id = mt.perfil_id
    join public.secciones   s on s.id = mt.seccion_id
    left join public.alumno_cosmeticos ac
           on ac.cosmetico_id = c.id and ac.matricula_id = p_matricula
    left join lateral (
      select min(pr.nivel) as nivel
        from public.pase_recompensas pr
        join public.pases p on p.id = pr.pase_id
       where pr.cosmetico_id = c.id
         and p.asignatura_id = s.asignatura_id and p.periodo_id = s.periodo_id
    ) pr on true
   where c.activo
     and (public.mi_matricula(p_matricula) or public.docente_ve_matricula(p_matricula))
   order by g.orden desc, c.tipo, c.nombre;
$$;
