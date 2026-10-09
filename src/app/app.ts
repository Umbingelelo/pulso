import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TemaService } from './tema.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html'
})
export class App {
  protected readonly title = signal('pulso');
  // Se instancia acá para que el tema se aplique y se siga al sistema en todas las pantallas.
  private readonly tema = inject(TemaService);
}
