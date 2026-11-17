import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="placeholder">
      <h1>Secure Live Messaging</h1>
      <p>End-to-end encrypted live text sharing. Coming soon.</p>
    </main>
  `,
  styles: `
    .placeholder {
      max-width: 40rem;
      margin: 0 auto;
      padding: 3rem 1.5rem;
    }
  `,
})
export class App {}
