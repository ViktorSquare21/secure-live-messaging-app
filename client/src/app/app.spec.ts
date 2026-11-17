import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import * as shared from '@slm/shared';
import { App } from './app';
import { routes } from './app.routes';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('shows the app name in the toolbar, linking home', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const brand = (fixture.nativeElement as HTMLElement).querySelector('mat-toolbar a');

    expect(brand?.textContent).toBe('Secure Live Messaging');
    expect(brand?.getAttribute('href')).toBe('/');
  });

  it('routes home, sender and receiver pages, and sends unknown paths home', () => {
    expect(routes.map((route) => route.path)).toEqual(['', 's/:sessionId', 'r/:sessionId', '**']);
    expect(routes.at(-1)?.redirectTo).toBe('');
  });

  it('resolves the shared workspace by its package name', () => {
    expect(shared).toBeTypeOf('object');
  });
});
