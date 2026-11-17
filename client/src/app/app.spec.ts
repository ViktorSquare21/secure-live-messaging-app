import { TestBed } from '@angular/core/testing';
import * as shared from '@slm/shared';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('renders the placeholder page', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent).toBe('Secure Live Messaging');
  });

  it('resolves the shared workspace by its package name', () => {
    expect(shared).toBeTypeOf('object');
  });
});
