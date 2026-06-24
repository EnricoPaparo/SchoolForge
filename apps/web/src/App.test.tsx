import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App.js';

describe('App', () => {
  it('renders SchoolForge', () => {
    render(<App />);
    expect(screen.getByText('SchoolForge')).toBeTruthy();
  });
});
