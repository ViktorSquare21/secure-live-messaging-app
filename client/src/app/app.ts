import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatToolbar } from '@angular/material/toolbar';
import { RouterLink, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatToolbar, RouterLink, RouterOutlet],
  template: `
    <mat-toolbar>
      <a class="brand" routerLink="/">Secure Live Messaging</a>
    </mat-toolbar>
    <main class="page">
      <router-outlet />
    </main>
  `,
  styles: `
    .brand {
      color: inherit;
      text-decoration: none;
    }
    .page {
      max-width: 48rem;
      margin: 0 auto;
      padding: 2rem 1.5rem;
    }
  `,
})
export class App {}
