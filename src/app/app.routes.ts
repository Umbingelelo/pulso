import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { DatosService } from './datos.service';
import { PerfilStore } from './perfil.store';

/** Espera a que se resuelva la sesión guardada antes de decidir. */
async function sesionResuelta(datos: DatosService): Promise<void> {
  if (datos.listo()) return;
  await new Promise<void>(listo => {
    const t = setInterval(() => {
      if (datos.listo()) { clearInterval(t); listo(); }
    }, 30);
  });
}

const soloConSesion: CanActivateFn = async () => {
  const datos = inject(DatosService);
  const router = inject(Router);
  await sesionResuelta(datos);
  if (datos.usuario()) return true;
  router.navigate(['/ingresar']);
  return false;
};

const soloSinSesion: CanActivateFn = async () => {
  const datos = inject(DatosService);
  const router = inject(Router);
  await sesionResuelta(datos);
  if (!datos.usuario()) return true;
  router.navigate(['/inicio']);
  return false;
};

/** Las páginas de alumno no tienen sentido para un docente: no tiene sección. */
const soloAlumno: CanActivateFn = async () => {
  const perfil = inject(PerfilStore);
  const router = inject(Router);
  await perfil.cargar();
  if (!perfil.esDocente()) return true;
  router.navigate(['/curso']);
  return false;
};

const soloDocente: CanActivateFn = async () => {
  const perfil = inject(PerfilStore);
  const router = inject(Router);
  await perfil.cargar();
  if (perfil.esDocente()) return true;
  router.navigate(['/inicio']);
  return false;
};

export const routes: Routes = [
  // Acceso: pantallas centradas, sin barra lateral
  {
    path: 'registro',
    canActivate: [soloSinSesion],
    loadComponent: () => import('./registro.component').then(m => m.RegistroComponent),
  },
  {
    path: 'ingresar',
    canActivate: [soloSinSesion],
    loadComponent: () => import('./login.component').then(m => m.LoginComponent),
  },

  // Con sesión: todo vive dentro del marco con barra lateral
  {
    path: '',
    canActivate: [soloConSesion],
    loadComponent: () => import('./marco.component').then(m => m.MarcoComponent),
    children: [
      {
        path: 'inicio', canActivate: [soloAlumno],
        loadComponent: () => import('./inicio.component').then(m => m.InicioComponent),
      },
      {
        path: 'perfil', canActivate: [soloAlumno],
        loadComponent: () => import('./perfil.component').then(m => m.PerfilComponent),
      },
      {
        path: 'ramos', canActivate: [soloAlumno],
        loadComponent: () => import('./ramos.component').then(m => m.RamosComponent),
      },
      {
        path: 'clases', canActivate: [soloAlumno],
        loadComponent: () => import('./clases.component').then(m => m.ClasesComponent),
      },
      {
        path: 'pase', canActivate: [soloAlumno],
        loadComponent: () => import('./pase.component').then(m => m.PaseComponent),
      },
      {
        path: 'misiones', canActivate: [soloAlumno],
        loadComponent: () => import('./misiones.component').then(m => m.MisionesComponent),
      },
      {
        path: 'actividades', canActivate: [soloAlumno],
        loadComponent: () => import('./actividades.component').then(m => m.ActividadesComponent),
      },
      {
        // Por código y no por id: el alumno llega desde su lista de actividades,
        // y «/laboratorio/L1» es una dirección que se puede dictar en voz alta en
        // clase. Cuál L1 es depende del ramo que tenga elegido.
        path: 'laboratorio/:codigo', canActivate: [soloAlumno],
        loadComponent: () => import('./laboratorio.component').then(m => m.LaboratorioComponent),
      },
      {
        path: 'diagnostico', canActivate: [soloAlumno],
        loadComponent: () => import('./diagnostico.component').then(m => m.DiagnosticoComponent),
      },
      {
        path: 'puntos', canActivate: [soloAlumno],
        loadComponent: () => import('./puntos.component').then(m => m.PuntosComponent),
      },
      {
        path: 'tienda', canActivate: [soloAlumno],
        loadComponent: () => import('./tienda.component').then(m => m.TiendaComponent),
      },
      {
        path: 'curso', canActivate: [soloDocente],
        loadComponent: () => import('./docente.component').then(m => m.DocenteComponent),
      },
      {
        path: 'curso/clases', canActivate: [soloDocente],
        loadComponent: () =>
          import('./docente-clases.component').then(m => m.DocenteClasesComponent),
      },
      {
        path: 'curso/actividades', canActivate: [soloDocente],
        loadComponent: () =>
          import('./docente-actividades.component').then(m => m.DocenteActividadesComponent),
      },
      {
        path: 'curso/alumnos', canActivate: [soloDocente],
        loadComponent: () =>
          import('./docente-alumnos.component').then(m => m.DocenteAlumnosComponent),
      },
      // La ficha es de los dos: el docente llega con el id de la matrícula desde
      // la nómina, el alumno entra sin id y ve la de su ramo elegido. Quién puede
      // ver cuál lo decide `ficha_alumno()` en la base, no un guard de acá.
      {
        path: 'ficha/:matriculaId',
        loadComponent: () => import('./ficha.component').then(m => m.FichaComponent),
      },
      {
        path: 'ficha', canActivate: [soloAlumno],
        loadComponent: () => import('./ficha.component').then(m => m.FichaComponent),
      },
      { path: '', pathMatch: 'full', redirectTo: 'inicio' },
    ],
  },

  { path: '**', redirectTo: 'inicio' },
];
