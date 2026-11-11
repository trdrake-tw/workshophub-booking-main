/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  setupFiles: ['<rootDir>/tests/setup.ts'],
  // Integration suites share one SQLite file and clean up rows by email prefix,
  // so run test files serially to stop suites deleting each other's rows.
  maxWorkers: 1,
  globals: {
    'ts-jest': {
      tsconfig: {
        module: 'commonjs',
      },
    },
  },
}

module.exports = config
