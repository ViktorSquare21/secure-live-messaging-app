import { ChangeDetectionStrategy, Component, computed, DOCUMENT, inject } from '@angular/core';
import { MatChip, MatChipSet } from '@angular/material/chips';
import { ActivatedRoute } from '@angular/router';
import { ReceiverSessionService } from '../session/receiver-session.service';
import { receiverErrorMessage, receiverStatusLabel } from './page-view';

@Component({
  selector: 'app-receiver-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatChip, MatChipSet],
  providers: [ReceiverSessionService],
  template: `
    <h1>Receiver</h1>
    @if (errorMessage(); as message) {
      <p class="error" role="alert" aria-label="Session error">{{ message }}</p>
    } @else {
      <div role="status" aria-label="Session status">
        <mat-chip-set>
          <mat-chip [class.rejected]="rejectedStatus()">{{ statusLabel() }}</mat-chip>
        </mat-chip-set>
      </div>
      @if (integrityWarning()) {
        <p class="banner" role="alert" aria-label="Integrity warning">
          An update could not be verified and was ignored. Showing the last verified text.
        </p>
      }
      <section class="received" role="region" aria-label="Received text">
        <p class="text">{{ text() }}</p>
      </section>
    }
  `,
  styles: `
    .received {
      margin-top: 1rem;
      padding: 1rem;
      min-height: 12rem;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 4px;
    }
    .text {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .banner {
      padding: 0.75rem 1rem;
      border-radius: 4px;
      background: var(--mat-sys-error);
      color: var(--mat-sys-on-error);
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
})
export class ReceiverPage {
  private readonly session = inject(ReceiverSessionService);

  protected readonly text = computed(() => this.session.state().text);
  protected readonly rejectedStatus = computed(() => this.session.state().status === 'integrity_error');
  protected readonly integrityWarning = computed(() => this.session.state().integrityWarning);
  protected readonly statusLabel = computed(() => receiverStatusLabel(this.session.state().status));
  protected readonly errorMessage = computed(() => receiverErrorMessage(this.session.error()));

  constructor() {
    const sessionId = inject(ActivatedRoute).snapshot.paramMap.get('sessionId') ?? '';
    void this.session.open(sessionId, inject(DOCUMENT).location.hash);
  }
}
