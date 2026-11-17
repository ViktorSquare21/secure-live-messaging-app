import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, linkedSignal, viewChild } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatChip, MatChipSet } from '@angular/material/chips';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { PeerState } from '@slm/shared';
import { SenderSessionService } from '../session/sender-session.service';
import { CLIPBOARD } from '../session/session-env';
import { lastSentView, nextPeerPhase, senderErrorView, senderPeerLabel, type PeerPhase } from './page-view';

@Component({
  selector: 'app-sender-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatButton, MatChip, MatChipSet, MatFormField, MatHint, MatInput, MatLabel, RouterLink],
  providers: [SenderSessionService],
  template: `
    @if (notResumable()) {
      <div class="error" role="alert" aria-label="Session error">
        <p>This session can't be resumed here.</p>
        <a routerLink="/">Start a new session</a>
      </div>
    } @else {
      <h1>Sender</h1>
      <div class="link-row">
        <mat-form-field class="link-field">
          <mat-label>Receiver link</mat-label>
          <input #linkInput matInput readonly [value]="receiverLink() ?? ''" />
          <mat-hint>Send this link to your receiver</mat-hint>
        </mat-form-field>
        <button mat-stroked-button type="button" [disabled]="receiverLink() === null" (click)="copyLink()">Copy link</button>
      </div>

      <div class="status-row">
        <div role="status" aria-label="Receiver status">
          <mat-chip-set>
            <mat-chip>{{ peerLabel() }}</mat-chip>
          </mat-chip-set>
        </div>
        <p role="status" aria-label="Last sent">@switch (lastSent().kind) {
            @case ('sending') {Sending…}
            @case ('sent') {Sent at {{ lastSentAt() | date: 'mediumTime' }}}
            @default {Not sent yet}
          }</p>
      </div>

      @if (error(); as error) {
        <div class="error" role="alert" aria-label="Session error">
          <p>{{ error.message }}</p>
          @if (error.fatal) {
            <a routerLink="/">Start a new session</a>
          }
        </div>
      }
      @if (tooLong()) {
        <p class="error" role="alert" aria-label="Text too long">Your text is too long to send. Shorten it to keep the receiver up to date.</p>
      }

      <mat-form-field class="text-field">
        <mat-label>Your text</mat-label>
        <textarea
          matInput
          rows="12"
          [disabled]="inputDisabled()"
          (input)="textChanged($event)"
        ></textarea>
      </mat-form-field>
    }
  `,
  styles: `
    .link-row,
    .status-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 1rem;
    }
    .link-row button {
      margin-bottom: 1.25rem;
    }
    .link-field {
      flex: 1 1 24rem;
    }
    .text-field {
      width: 100%;
      margin-top: 1rem;
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
})
export class SenderPage {
  private readonly session = inject(SenderSessionService);
  private readonly clipboard = inject(CLIPBOARD);
  private readonly snackBar = inject(MatSnackBar);
  private readonly linkInput = viewChild<ElementRef<HTMLInputElement>>('linkInput');

  protected readonly receiverLink = this.session.receiverLink;
  protected readonly notResumable = this.session.notResumable;
  protected readonly tooLong = this.session.tooLong;
  protected readonly lastSentAt = this.session.lastSentAt;
  protected readonly error = computed(() => senderErrorView(this.session.error()));
  protected readonly inputDisabled = computed(() => this.error()?.fatal === true);
  protected readonly lastSent = computed(() => lastSentView(this.session.sending(), this.session.lastSentAt()));
  private readonly peerPhase = linkedSignal<PeerState | null, PeerPhase>({
    source: this.session.peer,
    computation: (peer, previous) => nextPeerPhase(previous?.value ?? 'waiting', peer),
  });
  protected readonly peerLabel = computed(() => senderPeerLabel(this.session.connection(), this.peerPhase()));

  constructor() {
    const sessionId = inject(ActivatedRoute).snapshot.paramMap.get('sessionId') ?? '';
    void this.session.resume(sessionId);
  }

  protected textChanged(event: Event): void {
    this.session.textChanged((event.target as HTMLTextAreaElement).value);
  }

  protected async copyLink(): Promise<void> {
    const link = this.receiverLink();
    if (link === null) return;
    try {
      if (this.clipboard === null) throw new Error('clipboard_unavailable');
      await this.clipboard(link);
      this.snackBar.open('Link copied', undefined, { duration: 2000 });
    } catch {
      this.linkInput()?.nativeElement.select();
    }
  }
}
