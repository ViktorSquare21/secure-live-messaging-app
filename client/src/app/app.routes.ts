import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', loadComponent: () => import('./pages/home.page').then((m) => m.HomePage) },
  { path: 's/:sessionId', loadComponent: () => import('./pages/sender.page').then((m) => m.SenderPage) },
  { path: 'r/:sessionId', loadComponent: () => import('./pages/receiver.page').then((m) => m.ReceiverPage) },
  { path: '**', redirectTo: '' },
];
