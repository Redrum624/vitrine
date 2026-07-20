/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/?(*.)+(spec|test).+(ts|tsx|js)'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      useESM: false,
      tsconfig: {
        module: 'commonjs',
        moduleResolution: 'node',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true
      }
    }]
  },
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '\\.(jpg|jpeg|png|gif|webp|svg)$': '<rootDir>/src/__mocks__/fileMock.js',
    // The worker factory uses a Vite `?worker&url` import, which ts-jest cannot
    // resolve. Stub it: tests never construct a real Worker, they exercise the
    // config→pipeline translation directly. See src/workers/createPipelineWorker.ts.
    '^.*/workers/createPipelineWorker$': '<rootDir>/src/__mocks__/createPipelineWorkerMock.js',
    // Stub the createEnhanceWorker function which uses import.meta.url.
    // Tests inject a FakeWorker via workerFactory parameter.
    '^.*/utils/createEnhanceWorker$': '<rootDir>/src/__mocks__/createEnhanceWorkerMock.js'
  },
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/main.tsx',
    '!src/vite-env.d.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/']
};
