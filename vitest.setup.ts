// Global test setup for Vitest
// Import custom matchers from jest-dom
import "@testing-library/jest-dom";

// (Optional) MSW setup placeholder. Uncomment when you add handlers.
// import { setupServer } from 'msw/node';
// import { handlers } from './src/test/mocks/handlers';
// const server = setupServer(...handlers);
// beforeAll(() => server.listen());
// afterEach(() => server.resetHandlers());
// afterAll(() => server.close());

// Additional global configuration (e.g., mock for matchMedia) can be added here.
if (!window.matchMedia) {
  // @ts-ignore
  window.matchMedia = () => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
  });
}
