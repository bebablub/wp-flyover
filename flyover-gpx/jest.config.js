/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/tests/js/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/js/setup.js'],
};
