import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { DatosService } from './datos.service';

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
      { path: 'inicio', loadComponent: () => import('./inicio.component').then(m => m.InicioComponent) },
      { path: 'perfil', loadComponent: () => import('./perfil.component').then(m => m.PerfilComponent) },
      { path: 'puntos', loadComponent: () => import('./puntos.component').then(m => m.PuntosComponent) },
      { path: '', pathMatch: 'full', redirectTo: 'inicio' },
    ],
  },

  { path: '**', redirectTo: 'inicio' },
];
