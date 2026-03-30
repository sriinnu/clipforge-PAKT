import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

declare global {
  // React checks this flag before allowing async act() in tests.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
});
