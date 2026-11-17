import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { Router } from '@angular/router';
import { exhaustMap, finalize, Subject } from 'rxjs';
import { SenderSessionService } from '../session/sender-session.service';
import { homeErrorMessage } from './page-view';

@Component({
  selector: 'app-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton],
  providers: [SenderSessionService],
  template: `
    <h1>Share text live, end-to-end encrypted</h1>
    <p>Start a session, send the link to one receiver, and they see what you type as you type it.</p>
    <button mat-flat-button type="button" [disabled]="busy()" (click)="newSession.next()">New session</button>
    @if (errorMessage(); as message) {
      <p class="error" role="alert" aria-label="Session error">{{ message }}</p>
    }
  `,
  styles: `
    .error {
      color: var(--mat-sys-error);
    }
  `,
})
export class HomePage {
  private readonly session = inject(SenderSessionService);
  private readonly router = inject(Router);
  private readonly busySignal = signal(false);

  protected readonly busy = this.busySignal.asReadonly();
  protected readonly errorMessage = computed(() => (this.busy() ? null : homeErrorMessage(this.session.error())));
  protected readonly newSession = new Subject<void>();

  constructor() {
    this.newSession
      .pipe(
        exhaustMap(() => {
          this.busySignal.set(true);
          return this.session.createSession().pipe(finalize(() => this.busySignal.set(false)));
        }),
        takeUntilDestroyed(),
      )
      .subscribe((sessionId) => {
        if (sessionId !== null) void this.router.navigate(['/s', sessionId]);
      });
  }
}
