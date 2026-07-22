import js from '@eslint/js';
import globals from 'globals';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
        API: 'readonly',
        Toast: 'readonly',
        Auth: 'readonly',
        App: 'readonly',
        Router: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-console': 'off',
      'no-undef': 'error',
      'no-empty': 'off',
      'no-useless-escape': 'off',
      'preserve-caught-error': 'off',
    },
  },
  {
    ignores: [
      'node_modules/**',
      'public/css/**',
      'certs/**',
      'logs/**',
      'coverage/**',
      '.playwright-mcp/**',
      'patch_*.js',
      'test-ui.js',
      'test_mcp*.js',
      'test_tool.mjs',
    ],
  },
];
