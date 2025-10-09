const config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.test.ts"],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
};

export default config;
