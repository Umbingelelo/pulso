-- La tabla de posiciones no puede mirar `usuarios`.
--
-- La vista se unía a `usuarios` para excluir la cuenta de prueba por su correo, y
-- `usuarios` es la tabla de credenciales: RLS activo, ninguna política, ningún
-- grant. Sellada a propósito, porque ahí viven los hashes. Con `security_invoker`
-- la vista corre como `pulso_app` y recibía `permission denied`.
--
-- La respuesta correcta no es abrir esa tabla —jamás— sino marcar en el perfil a
-- quién no hay que mostrar. Es además más útil: sirve para la cuenta de prueba,
-- para un docente que se matricule, y para cualquiera que pida no aparecer.

alter table public.perfiles
  add column if not exists oculto_en_ranking boolean not null default false;

update public.perfiles p
   set oculto_en_ranking = true
  from public.usuarios u
 where u.id = p.id
   and (u.correo ilike '%prueba%' or exists (select 1 from public.docentes d where d.id = p.id));

drop view if exists public.posiciones;
create view public.posiciones with (security_invoker = true) as
  with xp as (
    select mt.id as matricula_id, s.asignatura_id, s.periodo_id, s.codigo as seccion,
           pf.nombre, pf.avatar, mt.titulo_id, mt.marco_id,
           coalesce(sum(me.xp), 0)::integer as xp,
           max(me.creado_en) as ultimo
      from public.matriculas mt
      join public.perfiles   pf on pf.id = mt.perfil_id
      join public.secciones  s  on s.id  = mt.seccion_id
      left join public.movimientos_experiencia me on me.matricula_id = mt.id
     where mt.activa
       and not pf.oculto_en_ranking
     group by mt.id, s.asignatura_id, s.periodo_id, s.codigo, pf.nombre, pf.avatar,
              mt.titulo_id, mt.marco_id)
  select xp.*,
         t.valor as titulo,
         rank() over (partition by xp.asignatura_id, xp.periodo_id order by xp.xp desc) as lugar,
         row_number() over (partition by xp.asignatura_id, xp.periodo_id
                            order by xp.xp desc, xp.ultimo asc nulls last) as orden
    from xp
    left join public.cosmeticos t on t.id = xp.titulo_id;

grant select on public.posiciones to pulso_app;
