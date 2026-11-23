module.exports = {
  preset: 'jest-expo',
  watchman: false,
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(.pnpm|.*(?:(jest-)?react-native|@react-native|expo|@expo|react-navigation|@react-navigation|@shopify/flash-list|zustand)))',
  ],
};
