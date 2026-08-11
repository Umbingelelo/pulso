-- Catálogo inicial de la tienda, para las dos asignaturas de 2026-2.
--
-- Todos entran con `precio = null`: se ven en la vitrina como «próximamente» y
-- `solicitar_canje()` los rechaza. Ponerles precio es un `update` cuando decidas
-- cuánto vale cada uno. El catálogo sí va al repositorio: no tiene nada reservado.
--
-- `requiere_aprobacion = false` solo en lo que no cambia una nota ni un plazo:
-- una pista, una plantilla, saltarse un micro-ejercicio. Todo lo demás entra como
-- solicitud y espera tu visto bueno.

do $cat$
declare
  r record;
begin
  for r in
    select a.id as asignatura_id, p.id as periodo_id
      from public.asignaturas a, public.periodos p
     where a.sigla in ('DSY1107', 'ITY1102') and p.codigo = '2026-2'
  loop
    insert into public.articulos
      (asignatura_id, periodo_id, codigo, nombre, descripcion, detalle,
       categoria, icono, precio, requiere_aprobacion, limite_por_alumno, orden)
    values
      -- ---------- Nota ----------
      (r.asignatura_id, r.periodo_id, 'decima-evaluacion',
       'Una décima', 'Suma 0,1 a la nota de una evaluación del semestre, la que tú elijas.',
       'Se pide antes de que la evaluación se cierre, no después de ver la nota. Se aplica donde el instrumento de evaluación lo permite.',
       'nota', '🎯', null, true, 3, 10),

      (r.asignatura_id, r.periodo_id, 'tres-decimas',
       'Tres décimas de una vez', 'Suma 0,3 a la nota de una evaluación. Sale mejor que pedir tres por separado.',
       'Misma condición que la décima suelta: se pide con la evaluación todavía abierta.',
       'nota', '🎖️', null, true, 1, 20),

      -- ---------- Evaluación ----------
      (r.asignatura_id, r.periodo_id, 'desbloquear-pregunta',
       'Desbloquear una pregunta', 'Conoces una de las preguntas de la prueba con anticipación.',
       'Se entrega el enunciado, no la respuesta. Se pide hasta tres días antes de la evaluación.',
       'evaluacion', '🔓', null, true, 1, 30),

      (r.asignatura_id, r.periodo_id, 'descartar-alternativa',
       'Descartar una alternativa', 'En una pregunta de selección múltiple, se elimina una alternativa incorrecta.',
       'Se usa durante la prueba, levantando la mano. Vale para una pregunta.',
       'evaluacion', '✂️', null, true, 2, 40),

      (r.asignatura_id, r.periodo_id, 'tiempo-extra',
       'Quince minutos extra', 'Quince minutos más de plazo en una evaluación escrita.',
       'Se pide el día anterior, para poder organizar la sala.',
       'evaluacion', '⏱️', null, true, 1, 50),

      (r.asignatura_id, r.periodo_id, 'hoja-de-apuntes',
       'Una plana de apuntes', 'Entras a la evaluación con una hoja escrita a mano, por un lado.',
       'Escrita a mano y tuya. Se revisa al entrar.',
       'evaluacion', '📝', null, true, 1, 60),

      -- ---------- Plazo ----------
      (r.asignatura_id, r.periodo_id, 'prorroga-48h',
       'Prórroga de 48 horas', 'Entrega un laboratorio hasta dos días después del plazo, sin descuento.',
       'Se pide **antes** de que venza el plazo. Después ya no corre.',
       'plazo', '📅', null, true, 2, 70),

      (r.asignatura_id, r.periodo_id, 'reentrega',
       'Reentrega sin descuento', 'Vuelves a entregar un laboratorio corregido y se evalúa la segunda versión.',
       'Sobre un laboratorio ya revisado, dentro de la semana siguiente a la devolución.',
       'plazo', '🔁', null, true, 1, 80),

      -- ---------- Apoyo ----------
      (r.asignatura_id, r.periodo_id, 'pista-laboratorio',
       'Una pista', 'El siguiente paso del laboratorio en el que estás atascado.',
       'Es una pista, no la solución. Se entrega al instante: escríbeme y te respondo.',
       'apoyo', '💡', null, false, null, 90),

      (r.asignatura_id, r.periodo_id, 'revision-anticipada',
       'Revisión anticipada', 'Te reviso el avance antes de la entrega y te digo qué corregir.',
       'Al menos 48 horas antes del plazo, con lo que tengas hecho.',
       'apoyo', '🔍', null, true, 2, 100),

      (r.asignatura_id, r.periodo_id, 'consulta-1a1',
       'Veinte minutos conmigo', 'Una consulta uno a uno, fuera del horario de clases, sobre lo que necesites.',
       'Se coordina por correo. Si no llegas, se consume igual.',
       'apoyo', '🗣️', null, true, 2, 110),

      (r.asignatura_id, r.periodo_id, 'andamio',
       'Esqueleto de partida', 'La plantilla base de un entregable, con la estructura ya armada.',
       'Te ahorra el formato, no el contenido. Se entrega al instante.',
       'apoyo', '🧱', null, false, 1, 120),

      (r.asignatura_id, r.periodo_id, 'ejemplo-en-clase',
       'Tu ejemplo en la clase', 'Propones el caso con el que se explica un tema en clases.',
       'Si calza con la materia de la semana, se usa y se dice de quién salió.',
       'apoyo', '🌟', null, true, 1, 130),

      -- ---------- Equipo ----------
      (r.asignatura_id, r.periodo_id, 'elegir-equipo',
       'Elegir con quién trabajas', 'Escoges tu pareja o tu equipo, en vez de que salga por sorteo.',
       'Antes de que se arme el equipo, y con el otro de acuerdo.',
       'equipo', '🤝', null, true, 1, 140),

      (r.asignatura_id, r.periodo_id, 'orden-presentacion',
       'Elegir cuándo presentas', 'Escoges tu lugar en el orden de las defensas.',
       'Por orden de llegada: el primero que lo canjea, elige primero.',
       'equipo', '🎤', null, true, 1, 150),

      -- ---------- Comodín ----------
      (r.asignatura_id, r.periodo_id, 'saltar-microejercicio',
       'Saltar un micro-ejercicio', 'Te saltas un micro-ejercicio de la clase sin que cuente en contra.',
       'No aplica a laboratorios ni a evaluaciones. Se entrega al instante.',
       'comodin', '⏭️', null, false, 2, 160)

    on conflict (asignatura_id, periodo_id, codigo) do nothing;
  end loop;
end
$cat$;
